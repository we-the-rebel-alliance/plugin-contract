/**
 * `kit`: the `plugin-kit` binary and the host harness, for a plugin's development and CI.
 *
 * This is a dev export. A plugin installs plugin-contract as a devDependency and runs the binary from
 * `node_modules/.bin/plugin-kit`; it never bundles the kit into its own `dist/`. The runtime modules a plugin imports
 * come from their own entries (`./manifest`, `./events`, `./register`, …).
 *
 * The binary's commands are documented in `docs/kit.md`. The host harness handles the six OpenCode 2.4 behaviour changes
 * of plugin standard §8; each has a test beside it.
 */
export { COMMANDS, HELP, main } from "./kit/cli.ts"
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
  legacySchedule,
  mcpAddress,
  TurnLog,
  waitForActivation,
} from "./kit/host.ts"
export type {
  ActivationOptions,
  AutomationAction,
  AutomationApi,
  AutomationClient,
  AutomationHost,
  AutomationResult,
  AutomationSpec,
  AutomationTrigger,
  CodeModeHarness,
  CodeModeSession,
  HostHarness,
  HostKind,
  HostOptions,
  McpConnection,
  McpProtocol,
  McpServerConfig,
  McpTransport,
  ToolCall,
  ToolCallInput,
  ToolCallLike,
  TurnEvent,
} from "./kit/host.ts"
