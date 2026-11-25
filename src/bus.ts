/**
 * `bus`: typed nudges from a plugin to every app (contract §10), as one entry point.
 *
 * `register` merges `busEvents(name)` into its one `ctx.rpc.register` call and wraps that registration with the typed
 * writer, which it returns as `registration.bus` and gives every handler call as `call.bus`. A plugin emits `changed`,
 * `status` or `account` there. An app passes an `/api/event` payload to `readBusEvent(payload, { name })` and re-reads
 * through the plugin's RPC methods. The host publishes each event as `rpc.<name>.<event>` on `/api/event`. A nudge
 * carries no content. `docs/bus.md` has the full guide.
 */
export { assertPluginName, BUS_EVENTS, BUS_STATES, capabilityPattern, isPluginName, REASON_MAX } from "./bus/definition.ts"
export type { AccountData, BusEventData, BusEventName, BusEvents, BusSchema, BusState, ChangedData, StatusData } from "./bus/definition.ts"
export { busEventType, readBusEvent } from "./bus/reader.ts"
export type { BusEvent, BusReadReason, BusReadResult, ReadBusOptions } from "./bus/reader.ts"
export { busEvents } from "./bus/schema.ts"
export type { Bus, BusEmitResult } from "./bus/writer.ts"
