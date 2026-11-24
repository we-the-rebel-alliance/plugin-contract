import type { Manifest } from "../manifest.js";
import type { PermissionRule } from "./fences.js";
import { type AccessLevel } from "./rules.js";
/** An agent as the transforms and status see it: its id and its ordered rules. */
export interface AgentLike {
    readonly id: string;
    readonly permissions: readonly PermissionRule[];
}
/** The editor inside `ctx.agent.transform`, as this module uses it. The host's editor is wider. */
export interface AgentEditor {
    list(): readonly AgentLike[];
    update(id: string, update: (agent: {
        permissions: PermissionRule[];
    }) => void): void;
}
/** The part of the plugin context access uses: the agent transform. */
export interface AccessContext {
    readonly agent: {
        readonly transform: (callback: (editor: AgentEditor) => void) => Promise<unknown>;
    };
}
/** What access generates for one plugin. */
export interface AccessRegistration {
    /** The level the `access` option names, or `all`. */
    readonly level: AccessLevel;
    /** The declared aliases the MCP rules cover, in the options' order. */
    readonly aliases: readonly string[];
    /** The generated rules, one per method (and one per alias for pass-through MCP tools). */
    readonly rules: readonly PermissionRule[];
    /** Why the rules could not be generated, one sentence each. Empty when they were. */
    readonly problems: readonly string[];
    /** Gives the transform back to OpenCode. */
    dispose(): Promise<void>;
}
/** What `applyAccess` reads: the manifest and the plugin's options (which carry `access` and `accounts`). */
export interface AccessRequest {
    readonly manifest: Manifest;
    readonly options?: Readonly<Record<string, unknown>> | undefined;
}
/**
 * The rules with `additions` inserted after the base allow and before the agent's own rules. An addition the agent
 * already holds for the same action, resource and effect is not added twice.
 */
export declare function withRules(permissions: readonly PermissionRule[], additions: readonly PermissionRule[]): PermissionRule[];
/**
 * The agent ids that do not hold every generated rule. An agent registered after the plugin loaded, or one whose rules
 * an app replaced, is named here; status reports it and the plugin never patches it.
 */
export declare function unguardedAgents(agents: readonly AgentLike[], rules: readonly PermissionRule[]): readonly string[];
/**
 * Generates the rules from `access` and `methods`, then inserts them into every agent the host has. Never throws for a
 * bad option or a failing transform: the problems are returned for status, and `register` refuses to start when they
 * are not empty.
 */
export declare function applyAccess(context: AccessContext, request: AccessRequest): Promise<AccessRegistration>;
