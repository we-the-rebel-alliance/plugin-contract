import { type BusEventData, type BusEventName, type BusEvents } from "./definition.js";
/** A payload checked: the event's data, or every problem, one sentence each. */
export type CheckedData<K extends BusEventName> = {
    readonly ok: true;
    readonly value: BusEventData[K];
} | {
    readonly ok: false;
    readonly problems: readonly string[];
};
/**
 * The events block `register` merges into its single RPC registration:
 *
 *   const events = Object.fromEntries(Object.entries(busEvents(name)).filter(([event]) => Object.hasOwn(manifest.events, event)))
 */
export declare function busEvents(name: string): BusEvents;
/** Check one event's data against contract §10. The writer and the reader both use this one validator. */
export declare function checkBusData<K extends BusEventName>(name: string, event: K, value: unknown): CheckedData<K>;
