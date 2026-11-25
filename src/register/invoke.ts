/**
 * One call through one handler, with the contract's checks around it (contract §6, §9 and §12).
 *
 * The register resolves the account, validates the input, refuses a commit that carries anything but a `planId`, runs
 * the handler, checks the answer (a plan's shape included), and maps a refusal. The same path runs behind every door,
 * so an agent tool, Code Mode and RPC cannot disagree about what a method accepts or answers.
 */
import { DEFAULT_ALIAS } from "../accounts/alias.ts"
import { resolveAccount, type AccountProfile } from "../accounts.ts"
import { manifestHash, type Manifest } from "../manifest.ts"
import { planStore, type PlanStore } from "./plans.ts"
import { refusal, refusalOf, refuse, RegisterError, reasonOf, type Refusal } from "./errors.ts"
import { methodEntries, type Door, type HandlerTable, type MethodCall, type MethodEntry } from "./handlers.ts"
import { validate, validateCommitInput, validatePlan } from "./validate.ts"

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The environment one call runs in, resolved once by `register`. */
export interface CallEnvironment {
  readonly name: string
  readonly manifest: Manifest
  /** The manifest's hash, as a grant stores it. */
  readonly hash: string
  readonly entries: readonly MethodEntry[]
  readonly accounts: readonly AccountProfile[]
  /** The plans this plugin instance made: a commit runs as the account its plan recorded. */
  readonly plans: PlanStore
}

/** The handler table and account set, validated once at setup. */
export function prepare(manifest: Manifest, handlers: HandlerTable, accounts: readonly AccountProfile[]): CallEnvironment {
  return { name: manifest.plugin.name, manifest, hash: manifestHash(manifest), entries: methodEntries(manifest, handlers), accounts, plans: planStore() }
}

/**
 * The handler's input: the account selector removed, then checked against the method's schema. A commit is checked
 * against `{ planId }` alone, whatever the handler's own schema says.
 */
function checkedInput(entry: MethodEntry, raw: unknown): { readonly input: Record<string, unknown>; readonly account: unknown } {
  if (!plain(raw)) refuse("INPUT_INVALID", `${entry.name} takes an object as its input`, "Pass the input its schema describes.")
  const input = { ...raw }
  const account = input["account"]
  if (entry.item.commits !== undefined) {
    if (Object.hasOwn(input, "account")) {
      throw new RegisterError(refusal("PLAN_INVALID", `${entry.name} commits a plan and takes only { planId }; the grant names the account`, "Remove account from the commit input."))
    }
    const checked = validateCommitInput(input)
    if (!checked.ok) throw new RegisterError(refusal("PLAN_INVALID", `${entry.name} commits a plan and takes only { planId }: ${checked.problems.join("; ")}`, "Call the planning method, then pass the planId it answers."))
    return { input: checked.value, account: undefined }
  }
  if (Object.hasOwn(input, "account")) {
    if (entry.item.accounts !== "optional") refuse("INPUT_INVALID", `${entry.name} takes no account`, "Remove account from the input; only a method declared accounts: optional takes one.")
    delete input["account"]
  }
  const checked = validate(entry.input, input)
  if (!checked.ok) throw new RegisterError(refusal("INPUT_INVALID", `${entry.name}'s input breaks its schema: ${checked.problems.join("; ")}`, "Pass only the input the method's schema describes."))
  return { input: checked.value as Record<string, unknown>, account }
}

/** A call's input and the account it resolves to, before any handler runs. */
export interface PreparedCall {
  readonly input: Record<string, unknown>
  readonly account: string
}

/**
 * The input checked and the account resolved, or a contract refusal. A commit takes no account: its account is the one
 * a verified grant names, or the plugin's only account, or `default` for the handler to read from the plan.
 */
export function prepareCall(entry: MethodEntry, raw: unknown, accounts: readonly AccountProfile[], plans: PlanStore): PreparedCall {
  const { input, account } = checkedInput(entry, raw)
  if (entry.item.commits !== undefined) {
    const planId = typeof input["planId"] === "string" ? input["planId"] : ""
    const plan = plans.accountOf(planId)
    if (!plan.ok) throw new RegisterError(refusal("PLAN_INVALID", plan.problems.join("; "), "Plan again, then commit with the planId it answers."))
    const resolved = accounts.length === 0 ? { ok: true as const, alias: plan.value } : resolveAccount(accounts, { account: plan.value })
    if (!resolved.ok) throw new RegisterError(refusal("ACCOUNT_UNKNOWN", resolved.what, resolved.next))
    return { input, account: resolved.alias }
  }
  // A method declared `accounts: "none"` takes no account: it runs as the internal default even when the plugin has
  // several aliases. Only an `accounts: "optional"` method resolves one, and then a missing account is ACCOUNT_REQUIRED.
  const resolved = entry.item.accounts === "optional" ? resolveAccount(accounts, { account }) : { ok: true as const, alias: DEFAULT_ALIAS }
  if (!resolved.ok) throw new RegisterError(refusal(resolved.code, resolved.what, resolved.next))
  return { input, account: resolved.alias }
}

/** The answer, checked; a plan must name the method that commits it. */
export function checkedOutput(entry: MethodEntry, value: unknown): unknown {
  if (entry.item.plans === true) {
    const plan = validatePlan(value)
    if (!plan.ok) throw new RegisterError(refusal("PLAN_INVALID", `${entry.name} must answer { planId, method }: ${plan.problems.join("; ")}`, "Answer the plan's id and the method that commits it."))
    if (entry.commit !== undefined && plan.value.method !== entry.commit) {
      throw new RegisterError(refusal("PLAN_INVALID", `${entry.name} answers ${plan.value.method} as the method that commits it, but ${entry.commit} does`, `Answer method: "${entry.commit}".`))
    }
    return plan.value
  }
  const checked = validate(entry.output, value)
  if (!checked.ok) throw new RegisterError(refusal("SCHEMA_VIOLATION", `${entry.name} answered something its schema does not describe: ${checked.problems.join("; ")}`, "Report it to the plugin's maintainers."))
  return checked.value
}

/** The failure a handler's error maps to: its contract refusal, or `UNAVAILABLE` with a redacted line. */
function failureOf(entry: MethodEntry, error: unknown): Refusal {
  const own = refusalOf(error)
  if (own) return own
  return refusal("UNAVAILABLE", `${entry.name} failed: ${reasonOf(error)}`, "Try again; if it keeps failing, check the plugin's status.")
}

/** Run a prepared call's handler, checking its answer and mapping its failure. */
export async function execute(entry: MethodEntry, prepared: PreparedCall, call: Omit<MethodCall, "account">, plans: PlanStore): Promise<unknown> {
  try {
    const value = checkedOutput(entry, await entry.handler.run(prepared.input, { ...call, account: prepared.account }))
    if (entry.item.plans === true) plans.record((value as { planId: string }).planId, prepared.account)
    return value
  } catch (error) {
    if (error instanceof RegisterError) throw error
    throw new RegisterError(failureOf(entry, error))
  }
}

/** The door's call context from an OpenCode tool context. */
export function toolCall(
  context: {
    readonly sessionID: string
    readonly agent: string
    readonly messageID: string
    readonly id: string
    readonly signal: AbortSignal
    readonly progress: (update: Readonly<Record<string, unknown>>) => Promise<void>
  },
  door: Exclude<Door, "rpc">,
): Omit<MethodCall, "account"> {
  return { sessionID: context.sessionID, agent: context.agent, messageID: context.messageID, id: context.id, signal: context.signal, progress: context.progress, door }
}
