/**
 * The real OpenCode 2.4.1 host, owned by conformance and used by `plugin-kit`.
 *
 * T1 never invents a host context. It loads the plugin with the real `@opencode/plugin` resolver, puts it in the
 * embedded `@opencode/sdk` host, creates a session, prompts once so the SDK acquires the location's plugin instance,
 * waits for activation, and records what the plugin did through the real `ctx`: tools, the namespace, the RPC
 * registration, agent rules and permission asks. The six behaviours standard §8 lists are handled here:
 *
 * 1. activation is awaited before the first RPC (`activation.ts`);
 * 2. the embedded host never runs automations, and with `allowScheduler` a test can override that (`automation.ts`);
 * 3. `experimental.schedule` is gone; automations go through `ctx.experimental.automation.create` (`automation.ts`);
 * 4. MCP discovery sends `server/discover` first, and a 401 or 403 ends the attempt (`mcp.ts`);
 * 5. a nested Code Mode call has its own id and `codemode: true` (`codemode.ts`);
 * 6. a turn's first tool step can arrive before the turn start (`turn.ts`).
 *
 * `@opencode/sdk` and `@opencode/plugin` are devDependencies of a plugin repository (standard §3). They are imported
 * with a computed specifier at T1 time, not bundled into `dist/`: a plugin's own bundle and this package's `dist/` stay
 * free of runtime dependencies.
 */
import type { PermissionRule } from "../../access.js";
export { waitForActivation, type ActivationOptions } from "./activation.js";
export { createCodeMode, type CodeModeHarness, type CodeModeSession, type ToolCall, type ToolCallInput, type ToolCallLike } from "./codemode.js";
export { connectMcpServer, mcpAddress, type McpConnection, type McpProtocol, type McpServerConfig, type McpTransport } from "./mcp.js";
export { automationApi, createAutomation, type AutomationAction, type AutomationApi, type AutomationClient, type AutomationHost, type AutomationResult, type AutomationSpec, type AutomationTrigger, type HostKind } from "./automation.js";
export { TurnLog, type TurnEvent } from "./turn.js";
export { HostError } from "./errors.js";
/** The plugin definition OpenCode loads: `Plugin.define({ id, setup })`. */
export interface PluginDefinition {
    readonly id: string;
    setup(context: unknown): unknown;
}
/** One tool the real context registered, as the proxy saw it. */
export interface RecordedTool {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly namespace: string;
    readonly permission: string;
    readonly input: unknown;
    readonly output: unknown;
    readonly codemode: boolean | {
        readonly pinned?: boolean;
        readonly description?: string;
        readonly input?: unknown;
        readonly output?: unknown;
    };
}
/** The real RPC registration, as the proxy saw it. */
export interface RecordedRpc {
    readonly id: string;
    readonly methods: readonly string[];
    readonly events: readonly string[];
}
/** One agent's real rules after the plugin's transforms. */
export interface RecordedAgent {
    readonly id: string;
    readonly permissions: readonly PermissionRule[];
}
/** What one real-host run recorded. */
export interface HostRun {
    readonly host: "embedded-sdk";
    readonly version: string;
    readonly entry?: string | undefined;
    readonly definition?: PluginDefinition | undefined;
    readonly namespace?: {
        readonly name: string;
        readonly description: string;
    } | undefined;
    readonly tools: readonly RecordedTool[];
    readonly rpc?: RecordedRpc | undefined;
    readonly agents: readonly RecordedAgent[];
    readonly asks: readonly {
        readonly action: string;
        readonly resources: readonly string[];
    }[];
    /** A clean `HOST_UNTESTED` refusal, when the host is outside the plugin's range. */
    readonly refusal?: string | undefined;
    /** Any other error `setup` threw, or the host failed with. */
    readonly failure?: string | undefined;
    /** The session the host created for activation. */
    readonly sessionID?: string | undefined;
    /** Call one RPC method under a session; a refusal is returned, not thrown. */
    call(method: string, input: unknown, options?: {
        readonly sessionID?: string | undefined;
        readonly rules?: readonly PermissionRule[] | undefined;
    }): Promise<RpcAnswer>;
    /** A session whose rules are exactly `rules`; the plugin's own rules still apply through its agents. */
    session(rules: readonly PermissionRule[]): Promise<string>;
    /**
     * Assert one action through the real `ctx.permission.assert` and answer its result: `{ ok: true }` when the host
     * allowed it, or `{ ok: false, code, message }` with the contract code (`PERMISSION_DENIED` for the host's deny and
     * rejection, `UNAVAILABLE` for anything unrecognised). It never throws, so a check can bound its own wait.
     */
    assert(input: {
        readonly sessionID: string;
        readonly action: string;
        readonly resources?: readonly string[] | undefined;
    }): Promise<AssertResult>;
    close(): Promise<void>;
}
/** One RPC answer or refusal, with the contract code the host reported. */
export type RpcAnswer = {
    readonly ok: true;
    readonly output: unknown;
} | {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
};
/** What one permission assert answered: allowed, or refused with a contract code and the host's line. */
export type AssertResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
};
/** The one failure shape, with the host's own line: a secret is named by kind and never printed, and a long line is cut. */
export declare function assertFailure(error: unknown): AssertResult;
/** What `createHost` needs. */
export interface HostOptions {
    readonly directory: string;
    readonly version: string;
    readonly pluginId: string;
    /** The plugin's options, as a person's configuration would give them. */
    readonly options?: Readonly<Record<string, unknown>> | undefined;
    /** The rules of the activation session. Default: none, so the agent's rules decide. */
    readonly sessionRules?: readonly PermissionRule[] | undefined;
    /** The agent the activation session names. Default: `build`. */
    readonly agent?: string | undefined;
    readonly timeoutMs?: number | undefined;
}
/** The entry the real OpenCode resolver names, or a refusal: `./server` then `.`, never `main` or `dist/index.js`. */
export declare function pluginEntry(directory: string): Promise<{
    readonly entry: string;
    readonly module: unknown;
}>;
/** The plugin definition a loaded module exports. */
export declare function definitionOf(module: unknown): PluginDefinition | undefined;
/** Run the plugin in the real host and record what it registered. */
export declare function createHost(options: HostOptions): Promise<HostRun>;
