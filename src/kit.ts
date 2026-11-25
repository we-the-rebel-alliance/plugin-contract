/**
 * `kit`: the `plugin-kit` binary and the conformance host harness, for a plugin's development and CI.
 *
 * This is a dev export. A plugin installs plugin-contract as a devDependency and runs the binary from
 * `node_modules/.bin/plugin-kit`; it never bundles the kit into its own `dist/`. The runtime modules a plugin imports
 * come from their own entries (`./manifest`, `./events`, `./register`, …).
 *
 * The host harness lives in `src/internal/host/`, beside the conformance host that uses it. The kit re-exports it with
 * the same public names and keeps no second implementation. The binary's commands are documented in `docs/kit.md`.
 */
export { COMMANDS, HELP, main } from "./kit/cli.ts"
export { KIT_BUNDLE_MARKER } from "./kit/bundled.ts"
export type { Command, MainOptions } from "./kit/cli.ts"
export type { ConformanceOptions, ConformanceReport, ConformanceRunner, Finding, Git, GitResult, Io } from "./kit/types.ts"
export { KitError } from "./kit/types.ts"
export { checkPlugin } from "./kit/check.ts"
export { forbiddenFindings } from "./kit/forbidden.ts"
export type { ForbiddenOptions } from "./kit/forbidden.ts"
export { redactText, redactValue } from "./kit/record.ts"
export { loadConformance } from "./kit/conformance.ts"
export {
  automationApi,
  connectMcpServer,
  createAutomation,
  createCodeMode,
  createHost,
  mcpAddress,
  TurnLog,
  waitForActivation,
} from "./internal/host/index.ts"
export type {
  ActivationOptions,
  AssertResult,
  AutomationAction,
  AutomationApi,
  AutomationClient,
  AutomationHost,
  AutomationResult,
  AutomationSpec,
  AutomationTrigger,
  CodeModeHarness,
  CodeModeSession,
  HostKind,
  HostOptions,
  HostRun,
  McpConnection,
  McpProtocol,
  McpServerConfig,
  McpTransport,
  ToolCall,
  ToolCallInput,
  ToolCallLike,
  TurnEvent,
} from "./internal/host/index.ts"
