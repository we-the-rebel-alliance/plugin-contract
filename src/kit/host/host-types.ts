/**
 * The structural shapes the host harness shares with OpenCode 2.4.1.
 *
 * The kit publishes its own declarations with no host import (`npm run check:dist`), so a host type is not named in a
 * `.d.ts`. These interfaces are what the real types satisfy: a `Tool.Context` has a call id, a session, an agent, a
 * message and an optional `codemode`; the harness accepts one without a cast. A test passes the real types in and lets
 * the compiler prove the fit.
 */

/** The fields of a tool call the harness reads, matching `Tool.Context` in 2.4.1. */
export interface ToolCallLike {
  readonly id: string
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  /** True when the call comes from inside Code Mode; absent on a top-level call. */
  readonly codemode?: boolean | undefined
}
