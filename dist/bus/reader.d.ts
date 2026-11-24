import { type BusEventData, type BusEventName } from "./definition.js";
/** One decoded bus event: its full type, the plugin's name, the event's name and the event's own data. */
export type BusEvent = {
    readonly [K in BusEventName]: {
        readonly type: `rpc.${string}.${K}`;
        readonly name: string;
        readonly event: K;
        readonly data: BusEventData[K];
    };
}[BusEventName];
/** The five ways a payload is not this plugin's bus event. */
export type BusReadReason = "not-a-bus-event" | "unknown-plugin" | "unknown-event" | "secret" | "invalid";
/** What `readBusEvent` found: the event, or the first reason it is not one. */
export type BusReadResult = {
    readonly ok: true;
    readonly event: BusEvent;
} | {
    readonly ok: false;
    readonly reason: BusReadReason;
    readonly problems: readonly string[];
};
/** The plugin whose events the app reads. */
export interface ReadBusOptions {
    readonly name: string;
}
/** `rpc.<name>.<event>`: the derivation the host uses (contract §3, §10). */
export declare function busEventType<const K extends BusEventName>(name: string, event: K): `rpc.${string}.${K}`;
/**
 * Read one `/api/event` payload as one of `name`'s bus events.
 *
 * The reasons come in the order an app checks them: a payload that is not an RPC event at all, an RPC event of another
 * plugin, one of this plugin's RPC events with a name the bus does not have, data that holds a secret, and finally data
 * that breaks the schema. A bad `options.name` throws; nothing about the payload throws, whatever it is.
 */
export declare function readBusEvent(payload: unknown, options: ReadBusOptions): BusReadResult;
