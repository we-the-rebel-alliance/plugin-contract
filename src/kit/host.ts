/**
 * The host harness a plugin's host test uses: the six behaviours OpenCode 2.4 changed, handled in one place.
 *
 * A plugin does not copy these rules into its tests. It creates a host for the release it runs (`server` or the embedded
 * `sdk`), waits for activation, creates automations through 2.4's API, probes an MCP server, makes nested Code Mode calls
 * and reads a turn's events through the log. Each rule is tested here, against the real 2.4.1 types in a type test.
 */
import type { ActivationOptions } from "./host/activation.ts"
import { waitForActivation } from "./host/activation.ts"

export { KIT_BUNDLE_MARKER } from "./bundled.ts"
export type { ActivationOptions } from "./host/activation.ts"
export { waitForActivation } from "./host/activation.ts"
export type { AutomationAction, AutomationApi, AutomationClient, AutomationHost, AutomationResult, AutomationSpec, AutomationTrigger } from "./host/automation.ts"
export { automationApi, createAutomation } from "./host/automation.ts"
export type { CodeModeHarness, CodeModeSession, ToolCall, ToolCallInput } from "./host/codemode.ts"
export { createCodeMode } from "./host/codemode.ts"
export type { ToolCallLike } from "./host/host-types.ts"
export type { McpConnection, McpProtocol, McpServerConfig, McpTransport } from "./host/mcp.ts"
export { connectMcpServer, mcpAddress } from "./host/mcp.ts"
export type { TurnEvent } from "./host/turn.ts"
export { TurnLog } from "./host/turn.ts"

/** The two OpenCode hosts a plugin's tests run on. */
export type HostKind = "server" | "sdk"

/** What a host test gives the harness: which host, what activation means, and the bound. */
export interface HostOptions extends ActivationOptions {
  readonly kind: HostKind
  /** The plugin's name, for a timeout message a CI log can act on. */
  readonly plugin: string
}

/** A host, ready to wait for activation and to make its first call through the wait. */
export interface HostHarness {
  readonly kind: HostKind
  readonly plugin: string
  /** Wait, bounded, until the plugin's setup is done. Repeated calls wait once. */
  activate(): Promise<void>
  /** The first RPC call: it waits for activation, then calls. */
  call<A>(what: string, call: () => Promise<A>): Promise<A>
}

/**
 * Create the harness for one host. `isActive` is the host's own answer (its tool list, its RPC registry, its plugin
 * state); the harness does not invent one.
 */
export function createHost(options: HostOptions): HostHarness {
  let activation: Promise<void> | undefined
  const activate = (): Promise<void> => {
    activation ??= waitForActivation(options)
    return activation
  }
  return {
    kind: options.kind,
    plugin: options.plugin,
    activate,
    async call<A>(what: string, call: () => Promise<A>): Promise<A> {
      await activate()
      try {
        return await call()
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`KIT_HOST_CALL: ${options.plugin} failed its first call, ${what}, on the ${options.kind} host: ${reason}. Next step: wait for activation, then read the host log.`)
      }
    },
  }
}
