/**
 * The bus events a plugin may emit, and the `Rpc.PortableDefinition` that declares them (contract §10).
 *
 *   changed  { capability, account, reason }  a source changed: after the plugin's own write, or on a webhook
 *   status   { state }                        the plugin's state changed
 *   account  { account, state }               an account signed in, out, or needs sign-in
 *
 * The host publishes each one as `rpc.<name>.<event>` on `/api/event` (§3, §10). A nudge carries no content: an app
 * reads it and re-reads through the plugin's RPC methods. The plugin name is validated here (§3) so every id, pattern
 * and event name derives from the one name.
 */

/** The events a plugin emits, in the order the contract lists them. */
export const BUS_EVENTS = ["changed", "status", "account"] as const
export type BusEventName = (typeof BUS_EVENTS)[number]

/** The states a plugin and its accounts report (contract §5). */
export const BUS_STATES = ["ready", "needs_sign_in", "error"] as const
export type BusState = (typeof BUS_STATES)[number]

/** `changed`: the plugin knows a source changed. `reason` is a short machine word such as `write` or `webhook`. */
export type ChangedData = {
  readonly capability: string
  readonly account: string
  readonly reason: string
}

/** `status`: the plugin's own state changed. */
export type StatusData = {
  readonly state: BusState
}

/** `account`: an account signed in, out, or needs sign-in. */
export type AccountData = {
  readonly account: string
  readonly state: BusState
}

/** Each event's data, keyed by event name, so a writer and a reader agree without a table of their own. */
export type BusEventData = {
  readonly changed: ChangedData
  readonly status: StatusData
  readonly account: AccountData
}

/** A JSON Schema object, as `Rpc.PortableEventDefinition` takes it. */
export type BusSchema = Readonly<Record<string, unknown>> & { readonly type: "object" }

/**
 * The definition a plugin registers on `ctx.rpc` (contract §10). It carries no methods: the bus only nudges, and the
 * app re-reads through door 3.
 */
export interface BusDefinition<Name extends string = string> {
  readonly id: Name
  readonly methods: Readonly<Record<string, never>>
  readonly events: {
    readonly changed: { readonly schema: BusSchema }
    readonly status: { readonly schema: BusSchema }
    readonly account: { readonly schema: BusSchema }
  }
}

/** The most characters a `changed.reason` takes, matching the one-line rule for status reasons (standard §4 rule 9). */
export const REASON_MAX = 160

/** An account alias (contract §5): lowercase letters, digits and underscores, starting with a letter, at most 32. */
const ACCOUNT_ALIAS = "^[a-z][a-z0-9_]{0,31}$"

/** One segment of a capability id: lowercase letters, digits and hyphens, starting with a letter. */
const CAPABILITY_SEGMENT = "[a-z][a-z0-9-]*"

/** Contract §3: lowercase letters and digits, 2 to 31 characters, no hyphen (a hyphen separates an account alias). */
const PLUGIN_NAME = /^[a-z0-9]{2,31}$/

/** Whether `value` is a plugin name under contract §3. */
export function isPluginName(value: unknown): value is string {
  return typeof value === "string" && PLUGIN_NAME.test(value)
}

/** Refuse a name that is not contract §3's, before it becomes an RPC id or an event name. */
export function assertPluginName(name: unknown): asserts name is string {
  if (isPluginName(name)) return
  const shown = typeof name === "string" ? `"${name}"` : typeof name
  throw new Error(`bus: ${shown} is not a plugin name. Next step: use 2 to 31 lowercase letters or digits, with no hyphen (contract §3).`)
}

/** The pattern a `changed.capability` matches: one of this plugin's own capability ids, `<name>.<capability>`. */
export function capabilityPattern(name: string): string {
  return `^${name}\\.${CAPABILITY_SEGMENT}(?:\\.${CAPABILITY_SEGMENT})*$`
}

/**
 * The three schemas. Each is an object, closed to fields the contract does not name, with every field required, so an
 * app never has to guess whether a missing field means "unknown" or "absent".
 */
function changedSchema(name: string): BusSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["capability", "account", "reason"],
    properties: {
      capability: { type: "string", pattern: capabilityPattern(name) },
      account: { type: "string", pattern: ACCOUNT_ALIAS },
      reason: { type: "string", minLength: 1, maxLength: REASON_MAX, pattern: "^[^\\r\\n]+$" },
    },
  }
}

const STATUS_SCHEMA: BusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state"],
  properties: {
    state: { type: "string", enum: [...BUS_STATES] },
  },
}

const ACCOUNT_SCHEMA: BusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["account", "state"],
  properties: {
    account: { type: "string", pattern: ACCOUNT_ALIAS },
    state: { type: "string", enum: [...BUS_STATES] },
  },
}

/**
 * The definition for one plugin: id `<name>`, no methods, and the three events with their schemas. It is a plain object
 * so it is also the shape a fake host in a test receives, with no dependency on an OpenCode type at run time.
 */
export function busDefinition<const Name extends string>(name: Name): BusDefinition<Name> {
  assertPluginName(name)
  return {
    id: name,
    methods: {},
    events: {
      changed: { schema: changedSchema(name) },
      status: { schema: STATUS_SCHEMA },
      account: { schema: ACCOUNT_SCHEMA },
    },
  }
}
