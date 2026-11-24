/**
 * `bus`: typed nudges from a plugin to every app (contract §10), as one entry point.
 *
 * A plugin merges `busEvents(name)` into its single `ctx.rpc.register` call, then wraps that registration with
 * `createBus(name, registration)` and emits `changed`, `status` or `account`. An app passes an `/api/event` payload to
 * `readBusEvent(payload, { name })` and re-reads through the plugin's RPC methods. The host publishes each event as
 * `rpc.<name>.<event>` on `/api/event`. A nudge carries no content. `docs/bus.md` has the full guide.
 */
export { assertPluginName, BUS_EVENTS, BUS_STATES, capabilityPattern, isPluginName, REASON_MAX } from "./bus/definition.js";
export type { AccountData, BusEventData, BusEventName, BusEvents, BusSchema, BusState, ChangedData, StatusData } from "./bus/definition.js";
export { busEventType, readBusEvent } from "./bus/reader.js";
export type { BusEvent, BusReadReason, BusReadResult, ReadBusOptions } from "./bus/reader.js";
export { busEvents } from "./bus/schema.js";
export { createBus } from "./bus/writer.js";
export type { Bus, BusEmitResult, BusRegistration } from "./bus/writer.js";
