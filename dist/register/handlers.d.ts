/**
 * The one handler table the register wires every door from (contract §9).
 *
 * A handler is written once: its input schema, its answer schema, a description for the agent tool, and the function
 * that does the work. The manifest says how risky the method is; the handler says what it looks like. The register
 * checks that every declared method has a handler and every handler is declared, so a manifest and its code cannot
 * drift apart.
 */
import type { Bus } from "../bus.js";
import type { JsonSchema, Manifest, MethodItem } from "../manifest.js";
/** Which door a call came through. */
export type Door = "tool" | "codemode" | "rpc";
/** What a handler knows about the call it runs: the session and agent, the resolved account, and the door. */
export interface MethodCall {
    readonly sessionID: string;
    readonly agent: string;
    readonly messageID: string;
    readonly id: string;
    readonly signal: AbortSignal;
    /** Report progress to the client; a no-op when the door has none (RPC). */
    progress(update?: Readonly<Record<string, unknown>>): Promise<void>;
    /** The account alias resolved through `accounts`, always one the plugin declares. */
    readonly account: string;
    /**
     * A commit's plan: the plan handler's full answer, as the register kept it. Absent on every other call. A planId is
     * never part of it; the register mints the id the commit was called with.
     */
    readonly plan?: unknown;
    /** The bus writer, when `register` was wired with `{ bus: true }`; a handler emits its nudges here. */
    readonly bus?: Bus | undefined;
    readonly door: Door;
}
/** One method's handler: its shapes, its description and its work. */
export interface MethodHandler {
    /** The description the agent tool carries (and the Code Mode entry when the method is not in agent prompts). */
    readonly description: string;
    /** The method's own input schema, without `account`; the register adds the account selector. */
    readonly input: JsonSchema;
    /** The answer's schema. For `plans`, the register checks the answer's method and mints the planId for `PLAN_OUTPUT`. */
    readonly output: JsonSchema;
    run(input: Readonly<Record<string, unknown>>, call: MethodCall): Promise<unknown>;
}
/** Every method's handler, by the method's name in the manifest. */
export type HandlerTable = Readonly<Record<string, MethodHandler>>;
/** A declared method and its handler, with the schemas the doors use. */
export interface MethodEntry {
    readonly name: string;
    readonly item: MethodItem;
    readonly handler: MethodHandler;
    /** The tool's input schema: the handler's, with `account` for a method that takes one. */
    readonly input: JsonSchema;
    /** The door's answer schema: the handler's, or the contract's plan shape. */
    readonly output: JsonSchema;
    /** For a planning method: the one declared method that commits its plan. */
    readonly commit?: string | undefined;
}
/**
 * The declared methods and their handlers, checked. A declared method with no handler, a handler with no declaration,
 * or a pass-through MCP method with a handler is refused: this module does not write door code for a vendor's server.
 */
export declare function methodEntries(manifest: Manifest, handlers: HandlerTable): readonly MethodEntry[];
