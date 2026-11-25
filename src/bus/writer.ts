/**
 * The writer side of the bus: `register` registers the three events inside its one RPC registration and answers nudges
 * (contract §10).
 *
 *   const rpc = await installRpc(context, environment, level, grant)
 *   const bus = createBus(name, rpc)
 *   await bus.emit("changed", { capability: "slack.mentions", account: "work", reason: "write" })
 *
 * This module is internal: `register` is the only caller, and a plugin reaches the writer as `registration.bus` and
 * `call.bus`. `createBus` never registers anything. OpenCode keeps a list of registrations per RPC id and resolves a
 * call to the last one, so a second registration with id `<name>` would hide the plugin's methods and every call would
 * answer `rpc.method_not_found`. The plugin therefore registers once, with `busEvents(name)` merged into its methods,
 * and this module only wraps the events emitter of that registration.
 *
 * The host publishes each accepted emit as `rpc.<name>.<event>` on `/api/event`. A payload is checked before it leaves
 * the plugin: a malformed one is refused with its field paths, and one holding a secret is refused with reason
 * `secret` (contract §13). Neither throws, and neither echoes a value.
 */
import { holdsSecret, serialise } from "./data.ts"
import { assertPluginName, BUS_EVENTS, type BusEventData, type BusEventName } from "./definition.ts"
import { checkBusData } from "./schema.ts"

/** What `emit` answers: accepted, or refused with one reason. */
export type BusEmitResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "invalid"; readonly problems: readonly string[] }
  | { readonly ok: false; readonly reason: "secret" }
  | { readonly ok: false; readonly reason: "unavailable" }

/** The typed writer a plugin holds. */
export interface Bus {
  /** The plugin's name, as the events are named. */
  readonly name: string
  /** Emit one event. It never throws: a refusal is the answer. */
  emit<K extends BusEventName>(event: K, data: BusEventData[K]): Promise<BusEmitResult>
}

/**
 * The slice of a registration the bus uses. Kept structural and plain, so OpenCode's `RpcRegistration` is assignable
 * without this package naming a host type in its published declarations.
 */
export interface BusRegistration {
  readonly events: {
    emit(name: BusEventName, data: BusEventData[BusEventName]): Promise<void>
  }
}

/**
 * Wrap the events emitter of a plugin's single RPC registration with the typed writer.
 *
 * A plugin name that is not contract §3's is a programming error and throws at setup, before any event is named. Every
 * payload refusal afterwards is returned, never thrown.
 */
export function createBus(name: string, registration: BusRegistration): Bus {
  assertPluginName(name)
  return {
    name,
    async emit(event, data) {
      if (!(BUS_EVENTS as readonly string[]).includes(event)) {
        return { ok: false, reason: "invalid", problems: ["event: must be one of changed, status, account"] }
      }
      const text = serialise(data)
      if (text !== undefined && holdsSecret(text)) return { ok: false, reason: "secret" }
      const checked = checkBusData(name, event, data)
      if (!checked.ok) return { ok: false, reason: "invalid", problems: checked.problems }
      if (text === undefined) return { ok: false, reason: "invalid", problems: ["data: must be JSON"] }
      try {
        await registration.events.emit(event, checked.value)
      } catch {
        // The host may have disposed the registration, or the transport may be down. The nudge is best effort: the
        // app's next pull is the truth (contract §1 principle 5), so a failure is reported, not thrown.
        return { ok: false, reason: "unavailable" }
      }
      return { ok: true }
    },
  }
}
