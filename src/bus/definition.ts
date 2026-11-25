/**
 * The bus events a plugin may emit (contract §10), and the one name they derive from (contract §3).
 *
 *   changed  { capability, account, reason }  a source changed: after the plugin's own write, or on a webhook
 *   status   { state }                        the plugin's state changed
 *   account  { account, state }               an account signed in, out, or needs sign-in
 *
 * The host publishes each one as `rpc.<name>.<event>` on `/api/event`. A nudge carries no content: an app reads it and
 * re-reads through the plugin's RPC methods. `register` puts the events **inside its one RPC registration** with
 * `busEvents(name)`: a second registration with the same id would shadow the first and its methods would answer
 * `rpc.method_not_found`.
 */

/** The events a plugin emits, in the order the contract lists them. */
export const BUS_EVENTS = ["changed", "status", "account"] as const
export type BusEventName = (typeof BUS_EVENTS)[number]

/** The states a plugin and its accounts report (contract §5). */
export const BUS_STATES = ["ready", "needs_sign_in", "error"] as const
export type BusState = (typeof BUS_STATES)[number]

/** The most characters a `changed.reason` takes, matching the one-line rule for status reasons (standard §4 rule 9). */
export const REASON_MAX = 160

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
 * The events block a plugin merges into its single `ctx.rpc.register` call. The plugin keeps its own `methods` and adds
 * `events: busEvents(name)`; it never registers the bus separately.
 */
export type BusEvents = {
  readonly changed: { readonly schema: BusSchema }
  readonly status: { readonly schema: BusSchema }
  readonly account: { readonly schema: BusSchema }
}

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

/** One segment of a capability id: lowercase letters, digits and hyphens, starting with a letter. */
const CAPABILITY_SEGMENT = "[a-z][a-z0-9-]*"

/** The pattern a `changed.capability` matches: one of this plugin's own capability ids, `<name>.<capability>`. */
export function capabilityPattern(name: string): string {
  return `^${name}\\.${CAPABILITY_SEGMENT}(?:\\.${CAPABILITY_SEGMENT})*$`
}
