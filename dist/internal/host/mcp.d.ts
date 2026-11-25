/** The protocols OpenCode 2.4's MCP config names. `auto` is the same as saying nothing: discover first. */
export type McpProtocol = "legacy" | "auto" | "2026-07-28";
/** The part of an MCP server's config the probe reads. */
export interface McpServerConfig {
    readonly type?: "local" | "remote" | string | undefined;
    readonly url?: string | undefined;
    readonly command?: readonly string[] | undefined;
    readonly protocol?: McpProtocol | undefined;
}
/** One request to an MCP server, as a test's fake transport answers it. */
export interface McpTransport {
    request(method: string, params?: unknown): Promise<{
        readonly status: number;
        readonly body?: unknown;
    }>;
}
/** What the probe did and what it learned. */
export interface McpConnection {
    /** `discovered`: `server/discover` answered; `initialized`: the legacy handshake answered; `failed`: neither did. */
    readonly status: "discovered" | "initialized" | "failed";
    /** The protocol the server selected, when it said. */
    readonly protocol?: string | undefined;
    /** Which HTTP status ended the attempt, when it failed. */
    readonly code?: number | undefined;
    /** Why it failed, one sentence. */
    readonly reason?: string | undefined;
    /** Every method sent, in order: the proof that a 401 or 403 was final. */
    readonly sent: readonly string[];
}
/** Connect to a server the way OpenCode 2.4 does. */
export declare function connectMcpServer(config: McpServerConfig, transport: McpTransport): Promise<McpConnection>;
/** Refuse an MCP config the harness cannot probe, so a test fails on its fixture rather than on a blank answer. */
export declare function mcpAddress(config: McpServerConfig): string;
