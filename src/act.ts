/**
 * `act`: the consumer-side call for a declared write. It mirrors `read`:
 *
 * 1. the manifest comes from the installed package, and the grant must be for the same manifest hash, consumer,
 *    act and account;
 * 2. a preview checks the caller's input against the act's input schema, reads the plugin's status for the aliases a
 *    fence may name, and calls the action's preview method (the one declared `plans: true`) in the preview's fence. The
 *    answer carries the register-minted plan's id and the method that commits it;
 * 3. the person confirms. The host signs an action grant for the commit method and the exact `{ planId }`;
 * 4. a commit calls the action's commit method (declared `commits: "<preview>"`) with exactly `{ planId }` in the
 *    commit's own fence, carrying that grant and its consumer in the RPC envelope. The plugin's `register` verifies the
 *    grant and runs the commit, so `act` never verifies it: the grant is the confirmation, and the fence is the access.
 *
 * Preview writes nothing. The answer may carry `reaches`, `changes` and `cost`, so a host can render one confirm for
 * every act. A commit without a plan id and a grant is refused before any call.
 */
import * as z from "zod"
import { MAX_BYTES_DEFAULT, findAction, findMethod, type ActionItem, type InstalledManifest } from "./manifest.ts"
import type { Checked } from "./internal/checked.ts"
import { failure, failureFromError, type ReadFailure } from "./internal/failure.ts"
import { problemsOf } from "./internal/validator.ts"
import { actSessionRules, type ActGrant, type ActPhase, type PermissionRule } from "./access.ts"
import { statusAliases, type ReadHost } from "./read.ts"

export type { ReadFailure } from "./internal/failure.ts"
export type { ActGrant, ActPhase } from "./access.ts"

/** What a project's host does for `act`: the same host as `read`, whose call may carry a commit's grant. */
export type ActHost = ReadHost

/** One preview or commit of an act. */
export interface ActRequest {
  readonly installed: InstalledManifest
  readonly action: string
  readonly grant: ActGrant
  readonly consumer: string
  readonly phase: ActPhase
  /** Preview only: the caller's input, checked against the act's input schema. A commit with an input is refused. */
  readonly input?: Readonly<Record<string, unknown>>
  /** Commit only: the `planId` the preview answered. */
  readonly planId?: string
  /** Commit only: the host-signed action grant `register` verifies. */
  readonly grantToken?: string
  readonly signal?: AbortSignal
}

/** Who a commit would reach, as the preview names them. A host shows this on the one confirm. */
export interface ActParty {
  readonly id: string
  readonly label?: string
}

/**
 * What a preview or a commit answers. `output` is the act's declared output. `reaches`, `changes` and `cost` are
 * optional, so a host can render one confirm without knowing the act.
 */
export interface ActAnswer {
  readonly trust: "untrusted"
  readonly output: unknown
  readonly reaches?: readonly ActParty[]
  readonly changes?: readonly string[]
  readonly cost?: unknown
  readonly account?: string
}

/** A preview's answer: the confirm fields, and the plan the commit carries. */
export interface ActPreview extends ActAnswer {
  readonly planId: string
  /** The act's commit method, as the preview named it. */
  readonly method: string
}

export type ActOutcome =
  | { readonly ok: true; readonly phase: "preview"; readonly preview: ActPreview }
  | { readonly ok: true; readonly phase: "commit"; readonly result: ActAnswer }
  | { readonly ok: false; readonly failure: ReadFailure }

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const refused = (code: Parameters<typeof failure>[0], what: string, next: string): ActOutcome => ({ ok: false, failure: failure(code, what, next) })
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

/** The most parties or changes one answer may carry, so a confirm stays one screen. */
const CONFIRM_LIMIT = 20

/** Why `value` is not the act's JSON Schema, or the problems of checking `data` against it. */
function schemaProblems(schema: Readonly<Record<string, unknown>>, data: unknown): string[] {
  let checked: ReturnType<z.ZodType["safeParse"]>
  try {
    checked = z.fromJSONSchema(schema as z.core.JSONSchema.JSONSchema).safeParse(data)
  } catch {
    return ["the act's schema is not a JSON Schema this package can check"]
  }
  return checked.success ? [] : problemsOf(checked.error).slice(0, 3)
}

/** Why a confirm field is not one a host can render, or an empty list when it is. */
function confirmProblems(answer: Record<string, unknown>): string[] {
  const problems: string[] = []
  const reaches = answer["reaches"]
  if (reaches !== undefined) {
    if (!Array.isArray(reaches) || reaches.length > CONFIRM_LIMIT) {
      problems.push(`reaches must be a list of at most ${CONFIRM_LIMIT}`)
    } else {
      for (const [index, party] of reaches.entries()) {
        if (!plain(party) || typeof party["id"] !== "string" || party["id"].length === 0 || party["id"].length > 320) {
          problems.push(`reaches[${index}].id must be 1 to 320 characters`)
        } else if (party["label"] !== undefined && (typeof party["label"] !== "string" || party["label"].length > 200)) {
          problems.push(`reaches[${index}].label must be at most 200 characters`)
        }
      }
    }
  }
  const changes = answer["changes"]
  if (changes !== undefined) {
    if (!Array.isArray(changes) || changes.length > CONFIRM_LIMIT || changes.some((change) => typeof change !== "string" || change.length === 0 || change.length > 500)) {
      problems.push(`changes must be a list of at most ${CONFIRM_LIMIT} sentences, each 1 to 500 characters`)
    }
  }
  return problems
}

/** The answer's problems against the act, as a failure; undefined when it keeps the contract. */
function checkAnswer(act: ActionItem, account: string, answer: unknown): ReadFailure | undefined {
  let size: number
  try {
    size = bytes(answer)
  } catch {
    return failure("SCHEMA_VIOLATION", `${act.id} answered a value that is not JSON`, "Report it to the plugin's maintainers.")
  }
  const limit = MAX_BYTES_DEFAULT
  if (size > limit) return failure("TOO_LARGE", `${act.id} answered ${size} bytes, over its ${limit}`, "Ask the plugin to answer a smaller preview.")
  if (!plain(answer)) return failure("SCHEMA_VIOLATION", `${act.id} answered something that is not an object`, "Report it to the plugin's maintainers.")
  if (answer["trust"] !== "untrusted") return failure("SCHEMA_VIOLATION", `${act.id}'s answer is not marked trust: "untrusted"`, "Report it to the plugin's maintainers.")
  if (answer["account"] !== undefined && answer["account"] !== account) {
    return failure("ACCOUNT_MISMATCH", `${act.id} answered for another account than the one granted`, "Sign the plugin in to the granted account, or ask the person to grant this one.")
  }
  if (!Object.hasOwn(answer, "output")) return failure("SCHEMA_VIOLATION", `${act.id}'s answer has no output`, "Report it to the plugin's maintainers.")
  const output = schemaProblems(act.output, answer["output"])
  if (output.length > 0) return failure("SCHEMA_VIOLATION", `${act.id}'s output breaks its schema: ${output.join("; ")}`, "Report it to the plugin's maintainers.")
  const confirm = confirmProblems(answer)
  if (confirm.length > 0) return failure("SCHEMA_VIOLATION", `${act.id}'s answer cannot be shown: ${confirm.join("; ")}`, "Report it to the plugin's maintainers.")
  return undefined
}

/** The plan a preview answered, as the host carries it to the commit; undefined when the answer is not that plan. */
function planProblems(act: ActionItem, answer: Record<string, unknown>): ReadFailure | undefined {
  const planId = answer["planId"]
  if (typeof planId !== "string" || planId.length === 0) {
    return failure("SCHEMA_VIOLATION", `${act.id}'s preview answered no planId`, "Report it to the plugin's maintainers.")
  }
  const method = answer["method"]
  if (method !== act.commit) {
    return failure(
      "SCHEMA_VIOLATION",
      `${act.id}'s preview names ${typeof method === "string" ? `"${method}"` : "no method"} as the method that commits it, and ${act.commit} does`,
      "Report it to the plugin's maintainers.",
    )
  }
  return undefined
}

/** The fields a host reads, and nothing the answer did not carry. */
function answerOf(value: Record<string, unknown>): ActAnswer {
  return {
    trust: "untrusted",
    output: value["output"],
    ...(value["reaches"] === undefined ? {} : { reaches: value["reaches"] as ActParty[] }),
    ...(value["changes"] === undefined ? {} : { changes: value["changes"] as string[] }),
    ...(value["cost"] === undefined ? {} : { cost: value["cost"] }),
    ...(value["account"] === undefined ? {} : { account: value["account"] as string }),
  }
}

/** Runs one call in a fenced session, and always closes the session. The same fence as `read`. */
async function fencedCall(host: ActHost, rules: Checked<readonly PermissionRule[]>, call: Omit<Parameters<ActHost["call"]>[0], "sessionID">, title: string): Promise<{ ok: true; answer: unknown } | { ok: false; failure: ReadFailure }> {
  if (!rules.ok) return { ok: false, failure: failure("PERMISSION_DENIED", rules.problems.join("; "), "Fix the act's declaration or the grant.") }
  let session: Awaited<ReturnType<ActHost["openSession"]>> | undefined
  try {
    session = await host.openSession({ rules: rules.value, title })
    return { ok: true, answer: await host.call({ ...call, sessionID: session.sessionID }) }
  } catch (error) {
    return { ok: false, failure: failureFromError(error) }
  } finally {
    await session?.close().catch(() => undefined)
  }
}

/** The commit's plan id and grant, or the refusal that comes before any call. */
function commitValues(act: ActionItem, request: ActRequest): { readonly planId: string; readonly grantToken: string } | { readonly failure: ReadFailure } {
  if (request.input !== undefined) {
    return { failure: failure("SCHEMA_VIOLATION", `a commit of ${act.id} takes only { planId }, and this request carries input`, "Pass the planId the preview answered; the grant names the input.") }
  }
  const { planId, grantToken } = request
  if (typeof planId !== "string" || planId.length === 0 || typeof grantToken !== "string" || grantToken.length === 0) {
    return {
      failure: failure(
        "PERMISSION_DENIED",
        `committing ${act.id} needs the planId its preview answered and a host-signed action grant`,
        "Preview the act, ask the person, then commit with the planId the preview answered and the host-signed action grant for this act.",
      ),
    }
  }
  return { planId, grantToken }
}

/** Previews or commits an act under a grant. Never throws for a refusal. */
export async function act(host: ActHost, request: ActRequest): Promise<ActOutcome> {
  const { installed, grant } = request
  const declared = findAction(installed.manifest, request.action)
  if (!declared) return refused("UNAVAILABLE", `${installed.package} ${installed.version} declares no act ${request.action}`, "Check the act id against the installed plugin's manifest.")
  if (request.phase !== "preview" && request.phase !== "commit") {
    return refused("SCHEMA_VIOLATION", "an act is previewed or committed", "Pass phase preview or commit.")
  }
  if (grant.disabled) return refused("SOURCE_DISABLED", `${declared.id} is turned off for ${grant.consumer}`, "Turn the act on again to preview or commit it.")
  if (grant.consumer !== request.consumer) return refused("PERMISSION_DENIED", `the grant is ${grant.consumer}'s, not ${request.consumer}'s`, "Ask the person to grant this consumer the act.")
  if (grant.action !== declared.id) return refused("PERMISSION_DENIED", `the grant is for ${grant.action}, not ${declared.id}`, "Use the grant for this act.")
  if (grant.manifestHash !== installed.hash) {
    return refused("PERMISSION_DENIED", `${declared.id}'s manifest changed since the person consented`, "Ask the person to review the action and consent again.")
  }
  const preview = findMethod(installed.manifest, declared.preview)
  const commit = findMethod(installed.manifest, declared.commit)
  if (preview === undefined || commit === undefined) {
    const missing = preview === undefined ? declared.preview : declared.commit
    return refused("UNAVAILABLE", `${installed.package} ${installed.version} declares no method ${missing} for ${declared.id}`, "Check the act's declaration against the installed plugin's manifest.")
  }
  if (request.phase === "preview" && preview.plans !== true) {
    return refused("PLAN_INVALID", `${declared.id}'s preview method ${declared.preview} is not declared plans: true`, `Declare ${declared.preview} with plans: true so it answers the planId that commits the act.`)
  }
  if (request.phase === "commit") {
    // The commit's own checks come before any host call: a plan id and a grant, and no input.
    const values = commitValues(declared, request)
    if ("failure" in values) return { ok: false, failure: values.failure }
    const accounts = await statusAliases(host, installed)
    if (!accounts.ok) return { ok: false, failure: accounts.failure }
    const called = await fencedCall(
      host,
      actSessionRules(installed.manifest, declared, grant, "commit", accounts.value),
      {
        package: installed.package,
        method: declared.commit,
        input: { planId: values.planId },
        grant: values.grantToken,
        consumer: request.consumer,
        ...(request.signal ? { signal: request.signal } : {}),
      },
      `${request.consumer} commits ${declared.id}`,
    )
    if (!called.ok) return { ok: false, failure: called.failure }
    const problem = checkAnswer(declared, grant.account, called.answer)
    if (problem) return { ok: false, failure: problem }
    return { ok: true, phase: "commit", result: answerOf(called.answer as Record<string, unknown>) }
  }
  if (request.input !== undefined && !plain(request.input)) {
    return refused("SCHEMA_VIOLATION", "an act's input must be an object", "Pass the input the act's schema describes.")
  }
  const inputProblems = schemaProblems(declared.input, request.input ?? {})
  if (inputProblems.length > 0) return refused("SCHEMA_VIOLATION", inputProblems.join("; "), "Pass only the input the act's schema describes.")
  const accounts = await statusAliases(host, installed)
  if (!accounts.ok) return { ok: false, failure: accounts.failure }
  const called = await fencedCall(
    host,
    actSessionRules(installed.manifest, declared, grant, "preview", accounts.value),
    {
      package: installed.package,
      method: declared.preview,
      input: { ...(request.input ?? {}), ...(preview.accounts === "optional" ? { account: grant.account } : {}) },
      ...(request.signal ? { signal: request.signal } : {}),
    },
    `${request.consumer} previews ${declared.id}`,
  )
  if (!called.ok) return { ok: false, failure: called.failure }
  const problem = checkAnswer(declared, grant.account, called.answer)
  if (problem) return { ok: false, failure: problem }
  const answer = called.answer as Record<string, unknown>
  const plan = planProblems(declared, answer)
  if (plan) return { ok: false, failure: plan }
  return { ok: true, phase: "preview", preview: { ...answerOf(answer), planId: answer["planId"] as string, method: answer["method"] as string } }
}
