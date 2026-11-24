/**
 * The fourth OpenCode 2.4 behaviour: an MCP server with no `protocol` is probed with `server/discover` first, and a 401
 * ends the attempt: no `initialize` follows.
 *
 * The harness models the transport as one request function. It records the methods it sent, so a test can assert that a
 * rejected discovery was final rather than followed by a legacy handshake. Both 401 and 403 are final: OpenCode 2.4.1
 * treats them the same way (`core/src/mcp/client.ts`).
 */
import { KitError } from "../types.ts"

/** The protocols OpenCode 2.4's MCP config names. `auto` is the same as saying nothing: discover first. */
export type McpProtocol = "legacy" | "auto" | "2026-07-28"

/** The part of an MCP server's config the probe reads. It is structurally `Mcp.ServerConfig`'s protocol and address. */
export interface McpServerConfig {
  readonly type?: "local" | "remote" | string | undefined
  readonly url?: string | undefined
  readonly command?: readonly string[] | undefined
  readonly protocol?: McpProtocol | undefined
}

/** One request to an MCP server, as a test's fake transport answers it. */
export interface McpTransport {
  request(method: string, params?: unknown): Promise<{ readonly status: number; readonly body?: unknown }>
}

/** What the probe did and what it learned. */
export interface McpConnection {
  /** `discovered`: `server/discover` answered; `initialized`: the legacy handshake answered; `failed`: neither did. */
  readonly status: "discovered" | "initialized" | "failed"
  /** The protocol the server selected, when it said. */
  readonly protocol?: string | undefined
  /** Which HTTP status ended the attempt, when it failed. */
  readonly code?: number | undefined
  /** Why it failed, one sentence. */
  readonly reason?: string | undefined
  /** Every method sent, in order: the proof that a 401 was final. */
  readonly sent: readonly string[]
}

/** The protocol the server's discovery answer selects, or the 2026 draft when it does not say. */
const discoveredProtocol = (body: unknown): string => {
  if (typeof body === "object" && body !== null) {
    const protocol = (body as Record<string, unknown>)["protocol"]
    if (typeof protocol === "string" && protocol !== "") return protocol
  }
  return "2026-07-28"
}

/**
 * Connect to a server the way OpenCode 2.4 does.
 *
 * - `protocol: "legacy"`: `initialize` directly.
 * - no protocol, or `"auto"`: `server/discover`; a 2xx is the connection, a 401 or 403 ends it, and any other failure
 *   falls back to `initialize`.
 * - `protocol: "2026-07-28"`: `server/discover`; a 401, a 403 or another failure ends it, because the server was told
 *   which protocol to speak.
 */
export async function connectMcpServer(config: McpServerConfig, transport: McpTransport): Promise<McpConnection> {
  const sent: string[] = []
  const initialize = async (): Promise<McpConnection> => {
    sent.push("initialize")
    const answer = await transport.request("initialize", { protocolVersion: "legacy" })
    if (answer.status >= 200 && answer.status < 300) return { status: "initialized", protocol: "legacy", sent }
    return { status: "failed", code: answer.status, reason: `initialize answered ${answer.status}`, sent }
  }
  if (config.protocol === "legacy") return initialize()

  sent.push("server/discover")
  const discovered = await transport.request("server/discover")
  if (discovered.status >= 200 && discovered.status < 300) {
    return { status: "discovered", protocol: discoveredProtocol(discovered.body), sent }
  }
  if (discovered.status === 401 || discovered.status === 403) {
    return {
      status: "failed",
      code: discovered.status,
      reason: `the server rejected server/discover with ${discovered.status}; a ${discovered.status} ends the attempt and no initialize follows`,
      sent,
    }
  }
  if (config.protocol === "2026-07-28") {
    return { status: "failed", code: discovered.status, reason: `server/discover answered ${discovered.status}`, sent }
  }
  // A server that does not know discovery yet: the legacy handshake is the fallback.
  return initialize()
}

/** Refuse an MCP config the harness cannot probe, so a test fails on its fixture rather than on a blank answer. */
export function mcpAddress(config: McpServerConfig): string {
  const address = config.url ?? config.command?.join(" ")
  if (address === undefined) throw new KitError("KIT_MCP", "the MCP server has no url and no command", "give the server a url, or a command for a local server")
  return address
}
