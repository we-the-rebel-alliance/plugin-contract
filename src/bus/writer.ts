/**
 * The writer side of the bus: a plugin registers the three events once and emits nudges (contract §10).
 *
 *   const bus = await createBus(ctx, "slack")
 *   await bus.emit("changed", { capability: "slack.mentions", account: "work", reason: "write" })
 *
 * `createBus` registers a `Rpc.PortableDefinition` with id `<name>`, no methods and the three events, and returns a
 * typed writer. The host publishes each accepted emit as `rpc.<name>.<event>` on `/api/event`. A payload is checked
 * before it leaves the plugin: a malformed one is refused with its field paths, and one holding a secret is refused
 * with reason `secret` (contract §13). Neither throws, and neither echoes a value.
 */
import { checkBusData, holdsSecret, serialise } from "./data.ts"
import { assertPluginName, BUS_EVENTS, busDefinition, type BusDefinition, type BusEventData, type BusEventName } from "./definition.ts"

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

/** The slice of `ctx` the bus uses: `ctx.rpc.register` (OpenCode 2.4.1). Kept structural so no host type ships. */
export interface BusHost {
  readonly rpc: {
    register(definition: BusDefinition, handlers: Readonly<Record<string, never>>): Promise<BusRegistration>
  }
}

/** What `ctx.rpc.register` answers; only the event emitter is used. */
export interface BusRegistration {
  readonly events: {
    emit(...args: [name: BusEventName, data: BusEventData[BusEventName]]): Promise<void>
  }
}

/**
 * Register the bus for one plugin and return its writer.
 *
 * A plugin name that is not contract §3's is a programming error and throws at setup, before any event is named. Every
 * payload refusal afterwards is returned, never thrown.
 */
export async function createBus(host: BusHost, name: string): Promise<Bus> {
  assertPluginName(name)
  const registration = await host.rpc.register(busDefinition(name), {})
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
