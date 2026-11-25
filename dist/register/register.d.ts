import type { Manifest } from "../manifest.js";
import { type AccessContext, type AccessRegistration } from "../access/agents.js";
import { type GrantWiring, type RpcContext } from "./rpc.js";
import { type ToolContext } from "./tools.js";
import type { HandlerTable } from "./handlers.js";
import { type Bus } from "../bus.js";
/** The plugin context the register needs: `ctx`, as OpenCode passes it to `setup`, narrowed structurally. */
export interface RegisterContext {
    /** The plugin's options, from `opencode.json(c)`. */
    readonly options?: Readonly<Record<string, unknown>> | undefined;
    readonly agent: AccessContext["agent"] & RpcContext["agent"];
    readonly tool: ToolContext["tool"];
    readonly session: RpcContext["session"];
    readonly permission: RpcContext["permission"];
    readonly rpc: RpcContext["rpc"];
}
/** What a plugin may wire into the register beyond the host context: the action-grant verifier, and the bus. */
export interface RegisterWiring {
    readonly grant?: GrantWiring | undefined;
    /**
     * Create the bus writer from the registration's events and attach it to every handler call as `call.bus`. One step,
     * so a plugin needs no mutable placeholder between `register` and `createBus`.
     */
    readonly bus?: boolean | undefined;
}
/** The live registration: the bus wraps it when wired, and disposing it removes the tools, the RPC id and the rules. */
export interface Registration {
    readonly name: string;
    readonly access: AccessRegistration;
    readonly events: {
        emit(name: string, data: unknown): Promise<void>;
    };
    /** The typed bus writer, when `wiring.bus` is `true`. */
    readonly bus?: Bus | undefined;
    dispose(): Promise<void>;
}
/**
 * Wire the plugin's methods through doors 1–3 and generate its access rules.
 *
 * The table and the manifest must name the same methods; a declared method without a handler is refused at setup, as
 * is a handler the manifest does not declare. `{ bus: true }` returns the writer as `registration.bus`.
 */
export declare function register(context: RegisterContext, manifest: Manifest, handlers: HandlerTable, wiring?: RegisterWiring): Promise<Registration>;
