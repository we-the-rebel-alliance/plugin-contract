import { type BusEventData, type BusEventName } from "./definition.js";
/** What `emit` answers: accepted, or refused with one reason. */
export type BusEmitResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly reason: "invalid";
    readonly problems: readonly string[];
} | {
    readonly ok: false;
    readonly reason: "secret";
} | {
    readonly ok: false;
    readonly reason: "unavailable";
};
/** The typed writer a plugin holds. */
export interface Bus {
    /** The plugin's name, as the events are named. */
    readonly name: string;
    /** Emit one event. It never throws: a refusal is the answer. */
    emit<K extends BusEventName>(event: K, data: BusEventData[K]): Promise<BusEmitResult>;
}
/**
 * The slice of a registration the bus uses. Kept structural and plain, so OpenCode's `RpcRegistration` is assignable
 * without this package naming a host type in its published declarations.
 */
export interface BusRegistration {
    readonly events: {
        emit(name: BusEventName, data: BusEventData[BusEventName]): Promise<void>;
    };
}
/**
 * Wrap the events emitter of a plugin's single RPC registration with the typed writer.
 *
 * A plugin name that is not contract §3's is a programming error and throws at setup, before any event is named. Every
 * payload refusal afterwards is returned, never thrown.
 */
export declare function createBus(name: string, registration: BusRegistration): Bus;
