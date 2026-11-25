/**
 * Status per account (contract §5 and §11).
 *
 * `status` lists every alias with a `state` of `ready`, `needs_sign_in` or `error`, and the owner once a probe has
 * answered. A failure reason is one line of at most 160 characters, redacted: no URL query string, no bearer token, no
 * token-shaped text, no control character. The library never echoes what a provider said.
 */
import type { JsonSchema, Owner } from "../manifest/types.ts"
import type { AccountProfile } from "./profiles.ts"

/** What an account can be. */
export const ACCOUNT_STATES = ["ready", "needs_sign_in", "error"] as const
export type AccountState = (typeof ACCOUNT_STATES)[number]

/** One alias's state, as `probe` or the sign-in reports it. */
export interface AccountSignal {
  readonly state: AccountState
  readonly owner?: Owner | undefined
  /** Why it is not ready. Cut to one line of 160 characters, and redacted. */
  readonly reason?: string | undefined
}

/** One alias as status reports it. */
export interface AccountStatus {
  readonly alias: string
  readonly state: AccountState
  readonly owner?: Owner | undefined
  readonly reason?: string | undefined
}

/** The most characters a reason takes (contract §11). */
export const REASON_MAX = 160

/** A value redacted: URL query values, authorization credentials, token-shaped words, and control characters. */
export function redactReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.length === 0) return "No reason was given."
  let text = reason
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A query string may carry a signature. Keep the key, drop the value.
    .replace(/([?&][^=\s&]+)=[^&\s]*/g, "$1=…")
    // Authorization headers, in their two common forms.
    .replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 …")
    // JWTs and other long token-shaped words.
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "…")
    .replace(/\b(?:sk|pk|rk|ghp|gho|ghs|xox[abp])[-_][A-Za-z0-9_-]{12,}\b/g, "…")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "…")
  if (text.length === 0) text = "No reason was given."
  if (text.length > REASON_MAX) {
    let end = REASON_MAX - 1
    const code = text.charCodeAt(end - 1)
    if (end > 0 && code >= 0xd800 && code <= 0xdbff) end--
    text = `${text.slice(0, end)}…`
  }
  return text
}

/** One alias's status: its state, its owner when known, and a redacted one-line reason when it is not ready. */
export function accountStatus(alias: string, signal: AccountSignal | undefined): AccountStatus {
  if (signal === undefined) return { alias, state: "needs_sign_in", reason: "Not signed in yet." }
  return {
    alias,
    state: signal.state,
    ...(signal.owner === undefined ? {} : { owner: signal.owner }),
    ...(signal.state === "ready" || signal.reason === undefined ? {} : { reason: redactReason(signal.reason) }),
  }
}

/**
 * Status for every alias the plugin has, in the order the options name them. A signal for an alias the plugin does not
 * have is ignored: status never invents an account.
 */
export function accountStatuses(accounts: readonly AccountProfile[], signals: Readonly<Record<string, AccountSignal | undefined>> = {}): readonly AccountStatus[] {
  if (accounts.length === 0) return []
  return accounts.map((account) => accountStatus(account.alias, signals[account.alias]))
}

/** The status of a plugin with no accounts: an empty list, never a `default` the person cannot sign in to. */
export const NO_ACCOUNTS: readonly AccountStatus[] = []

/**
 * The JSON Schema of `status` (contract §11): the plugin's identity, the host range it runs on, its state, every alias's
 * state and owner, the agents that lack the generated access rules, and a redacted next step. A plugin reuses this
 * constant for its `status` handler's output instead of copying the shape; `status` is required on every plugin.
 */
export const STATUS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    version: { type: "string", minLength: 1 },
    host: {
      type: "object",
      properties: {
        version: { type: "string", minLength: 1 },
        range: { type: "string", minLength: 1 },
        tested: { type: "array", minItems: 1, items: { type: "string" } },
      },
      required: ["version", "range", "tested"],
      additionalProperties: false,
    },
    state: { type: "string", enum: [...ACCOUNT_STATES] },
    accounts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          alias: { type: "string", minLength: 1 },
          state: { type: "string", enum: [...ACCOUNT_STATES] },
          owner: { type: "object", additionalProperties: true },
          reason: { type: "string", maxLength: REASON_MAX },
        },
        required: ["alias", "state"],
        additionalProperties: false,
      },
    },
    unguardedAgents: { type: "array", items: { type: "string" } },
    nextStep: {},
  },
  required: ["name", "version", "host", "state", "accounts", "unguardedAgents", "nextStep"],
  additionalProperties: false,
}
