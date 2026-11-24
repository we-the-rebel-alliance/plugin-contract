/**
 * `bus`: typed nudges from a plugin to every app (contract §10), as one entry point.
 *
 * A plugin uses `createBus(ctx, "<name>")` from this entry, then emits `changed`, `status` or `account` with the typed
 * writer. An app passes an `/api/event` payload to `readBusEvent(payload, { name })` and re-reads through the plugin's
 * RPC methods. The host publishes each event as `rpc.<name>.<event>` on `/api/event`. A nudge carries no content.
 * `docs/bus.md` has the full guide.
 */
export { BUS_EVENTS, BUS_STATES, REASON_MAX, assertPluginName, busDefinition, capabilityPattern, isPluginName } from "./bus/definition.ts"
export type { AccountData, BusDefinition, BusEventData, BusEventName, BusSchema, BusState, ChangedData, StatusData } from "./bus/definition.ts"
export { busEventType, readBusEvent } from "./bus/reader.ts"
export type { BusEvent, BusReadReason, BusReadResult, ReadBusOptions } from "./bus/reader.ts"
export { createBus } from "./bus/writer.ts"
export type { Bus, BusEmitResult, BusHost, BusRegistration } from "./bus/writer.ts"
