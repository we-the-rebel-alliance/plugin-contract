/**
 * `act`: the consumer-side call for a declared write. It mirrors `read`:
 *
 * 1. the manifest comes from the installed package, and the grant must be for the same manifest hash, consumer,
 *    action and account;
 * 2. the caller's input is checked against the act's input schema before anything is called;
 * 3. the call runs in a session fenced by exactly that phase's rules (`actSessionRules`);
 * 4. a commit whose effect is not `local` is refused unless the caller passes a confirmation the host issued.
 *    This package does not issue a token and does not draw a confirm. A host with no issuer cannot confirm one.
 *
 * Preview writes nothing: its session allows the preview action and not the commit action. The answer may carry
 * `reaches`, `changes` and `cost`, so a host can render one confirm for every act.
 */
import * as z from "zod"
import { MAX_BYTES_DEFAULT, findAction, type ActionEffect, type ActionItem, type InstalledManifest } from "./manifest.ts"
import type { Checked } from "./internal/checked.ts"
import { failure, failureFromError, type ReadFailure } from "./internal/failure.ts"
import { problemsOf } from "./internal/validator.ts"
import { actSessionRules, type ActGrant, type ActPhase, type PermissionRule } from "./permission.ts"
import type { ReadHost } from "./read.ts"

export type { ReadFailure } from "./internal/failure.ts"
export type { ActGrant, ActPhase } from "./permission.ts"

/** What a project's host does for `act`: a read host, plus a confirmation check when it can issue one. */
export interface ActHost extends ReadHost {
  /**
   * True when `token` is a confirmation this host issued for this act, account and consumer. Absent when the host
   * has no issuer: a non-local commit is then refused. The contract never issues a token.
   */
  issuedConfirmation?(check: {
    readonly token: string
    readonly act: string
    readonly effect: ActionEffect
    readonly account: string
    readonly consumer: string
  }): boolean | Promise<boolean>
}

/** One preview or commit of an act. */
export interface ActRequest {
  readonly installed: InstalledManifest
  readonly act: string
  readonly grant: ActGrant
  readonly consumer: string
  readonly phase: ActPhase
  /** The caller's input, checked against the act's input schema. The library adds `account`. */
  readonly input?: Readonly<Record<string, unknown>>
  /**
   * A confirmation the host issued. Required to commit an act whose effect is not `local`. Ignored for a preview
   * and for a local commit. An empty token is not a confirmation.
   */
  readonly confirmation?: string
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

export type ActOutcome =
  | { readonly ok: true; readonly phase: "preview"; readonly preview: ActAnswer }
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
  if (confirm.length > 0) return failure("SCHEMA_VIOLATION", `${act.id}'s preview cannot be shown: ${confirm.join("; ")}`, "Report it to the plugin's maintainers.")
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

/**
 * Refuses a non-local commit that has no confirmation the host issued. A preview is not a commit, and a local commit
 * needs no confirmation. A token the host cannot verify is not a confirmation: this package does not issue one.
 */
async function confirmationProblem(host: ActHost, act: ActionItem, request: ActRequest): Promise<ActOutcome | undefined> {
  if (request.phase !== "commit" || act.effect === "local") return undefined
  const token = request.confirmation?.trim() ?? ""
  if (token.length === 0) {
    return refused(
      "PERMISSION_DENIED",
      `committing ${act.id} (${act.effect}) needs a confirmation the host issued`,
      "Preview the act, ask the person, and pass the confirmation the host issued. The contract does not issue one.",
    )
  }
  if (host.issuedConfirmation === undefined) {
    return refused(
      "PERMISSION_DENIED",
      `the host has no confirmation issuer, so ${act.id} (${act.effect}) cannot be committed`,
      "The host must issue the confirmation. The contract does not issue one, and a caller-supplied token is not enough.",
    )
  }
  let issued = false
  try {
    issued = (await host.issuedConfirmation({ token, act: act.id, effect: act.effect, account: request.grant.account, consumer: request.consumer })) === true
  } catch {
    issued = false
  }
  if (!issued) {
    return refused("PERMISSION_DENIED", `the confirmation was not issued for ${act.id}`, "Ask the person again, and pass the confirmation the host issued for this act.")
  }
  return undefined
}

/** Previews or commits an act under a grant, in a session fenced by that phase's rules. Never throws for a refusal. */
export async function act(host: ActHost, request: ActRequest): Promise<ActOutcome> {
  const { installed, grant } = request
  const declared = findAction(installed.manifest, request.act)
  if (!declared) return refused("UNAVAILABLE", `${installed.package} ${installed.version} declares no act ${request.act}`, "Check the act id against the installed plugin's sources.")
  if (request.phase !== "preview" && request.phase !== "commit") {
    return refused("SCHEMA_VIOLATION", "an act is previewed or committed", "Pass phase preview or commit.")
  }
  if (grant.disabled) return refused("SOURCE_DISABLED", `${declared.id} is turned off for ${grant.consumer}`, "Turn the act on again to preview or commit it.")
  if (grant.consumer !== request.consumer) return refused("PERMISSION_DENIED", `the grant is ${grant.consumer}'s, not ${request.consumer}'s`, "Ask the person to grant this consumer the act.")
  if (grant.action !== declared.id) return refused("PERMISSION_DENIED", `the grant is for ${grant.action}, not ${declared.id}`, "Use the grant for this act.")
  if (grant.manifestHash !== installed.hash) {
    return refused("PERMISSION_DENIED", `${declared.id}'s manifest changed since the person consented`, "Ask the person to review the action and consent again.")
  }
  const confirmed = await confirmationProblem(host, declared, request)
  if (confirmed) return confirmed
  if (request.input !== undefined && !plain(request.input)) {
    return refused("SCHEMA_VIOLATION", "an act's input must be an object", "Pass the input the act's schema describes.")
  }
  const inputProblems = schemaProblems(declared.input, request.input ?? {})
  if (inputProblems.length > 0) return refused("SCHEMA_VIOLATION", inputProblems.join("; "), "Pass only the input the act's schema describes.")
  const called = await fencedCall(
    host,
    actSessionRules(installed.manifest, declared, grant, request.phase),
    {
      package: installed.package,
      method: request.phase === "preview" ? declared.preview : declared.commit,
      input: { ...(request.input ?? {}), account: grant.account },
      ...(request.signal ? { signal: request.signal } : {}),
    },
    `${request.consumer} ${request.phase === "preview" ? "previews" : "commits"} ${declared.id}`,
  )
  if (!called.ok) return { ok: false, failure: called.failure }
  const problem = checkAnswer(declared, grant.account, called.answer)
  if (problem) return { ok: false, failure: problem }
  const answer = answerOf(called.answer as Record<string, unknown>)
  return request.phase === "preview" ? { ok: true, phase: "preview", preview: answer } : { ok: true, phase: "commit", result: answer }
}
