/**
 * The reader side of the bus: an app takes one `/api/event` payload and gets either a typed event or one reason it is
 * not one (contract §10). It is pure and needs no OpenCode SDK: the host-neutral shape of an event payload is enough.
 *
 *   for await (const payload of events) {
 *     const read = readBusEvent(payload, { name: "slack" })
 *     if (read.ok && read.event.event === "changed") await reread(read.event.data.capability)
 *   }
 *
 * A bus event is a nudge, never the data itself: the app re-reads through door 3 after it.
 */
import { checkBusData, holdsSecret, serialise } from "./data.ts"
import { BUS_EVENTS, type BusEventData, type BusEventName } from "./definition.ts"

/** One decoded bus event: its full type, the plugin's name, the event's name and the event's own data. */
export type BusEvent = {
  readonly [K in BusEventName]: {
    readonly type: `rpc.${string}.${K}`
    readonly name: string
    readonly event: K
    readonly data: BusEventData[K]
  }
}[BusEventName]

/** The five ways a payload is not this plugin's bus event. */
export type BusReadReason = "not-a-bus-event" | "unknown-plugin" | "unknown-event" | "secret" | "invalid"

/** What `readBusEvent` found: the event, or the first reason it is not one. */
export type BusReadResult =
  | { readonly ok: true; readonly event: BusEvent }
  | { readonly ok: false; readonly reason: BusReadReason; readonly problems: readonly string[] }

/** The plugin whose events the app reads. */
export interface ReadBusOptions {
  readonly name: string
}

/** `rpc.<name>.<event>`: the derivation the host uses (contract §3, §10). */
export function busEventType<const K extends BusEventName>(name: string, event: K): `rpc.${string}.${K}` {
  return `rpc.${name}.${event}`
}

const RPC_TYPE = /^rpc\.([a-z0-9]{2,31})\.([a-z0-9_]+)$/

/**
 * Read one `/api/event` payload as one of `name`'s bus events.
 *
 * The reasons come in the order an app checks them: a payload that is not an RPC event at all, an RPC event of another
 * plugin, one of this plugin's RPC events with a name the bus does not have, data that holds a secret, and finally data
 * that breaks the schema. Nothing throws, whatever the payload is.
 */
export function readBusEvent(payload: unknown, options: ReadBusOptions): BusReadResult {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return { ok: false, reason: "not-a-bus-event", problems: [] }
  const record = payload as Readonly<Record<string, unknown>>
  const type = record["type"]
  if (typeof type !== "string") return { ok: false, reason: "not-a-bus-event", problems: [] }
  const match = RPC_TYPE.exec(type)
  if (match === null) return { ok: false, reason: "not-a-bus-event", problems: [] }
  const name = match[1]!
  const event = match[2]!
  if (name !== options.name) return { ok: false, reason: "unknown-plugin", problems: [] }
  if (!(BUS_EVENTS as readonly string[]).includes(event)) return { ok: false, reason: "unknown-event", problems: [] }
  const text = serialise(record["data"])
  if (text !== undefined && holdsSecret(text)) return { ok: false, reason: "secret", problems: [] }
  const data = checkBusData(name, event as BusEventName, record["data"])
  if (!data.ok) return { ok: false, reason: "invalid", problems: data.problems }
  return { ok: true, event: { type: type as `rpc.${string}.${BusEventName}`, name, event: event as BusEventName, data: data.value } as BusEvent }
}
