/**
 * OpenCode 2.4 behaviour 1: plugins load in the background, so a test waits, with a bound, for the plugin to become
 * active before its first RPC. A call made sooner sees `rpc.unavailable` or an empty tool list and learns nothing.
 *
 * `createHost` below uses this against the real `@opencode/sdk` host: a session's prompt makes the SDK acquire the
 * location's plugin instance, and the plugin list reports `active` when setup has finished. The wait is bounded so a
 * plugin that never activates fails with a next step instead of hanging CI.
 */
import { HostError } from "./errors.ts"

/** What activation needs: a predicate, a bound, and a clock and sleep a test can replace. */
export interface ActivationOptions {
  readonly isActive: () => boolean | Promise<boolean>
  readonly timeoutMs?: number | undefined
  readonly pollMs?: number | undefined
  readonly now?: (() => number) | undefined
  readonly sleep?: ((ms: number) => Promise<void>) | undefined
}

const sleepFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Wait until the plugin is active, and refuse at the bound. */
export async function waitForActivation(options: ActivationOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const pollMs = options.pollMs ?? 25
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? sleepFor
  const started = now()
  for (;;) {
    if (await options.isActive()) return
    const elapsed = now() - started
    if (elapsed >= timeoutMs) {
      throw new HostError("HOST_TIMEOUT", `the plugin did not become active within ${timeoutMs} ms`, "read the host log for a setup error; T1 cannot call a plugin before it finishes setup")
    }
    await sleep(Math.min(pollMs, Math.max(1, timeoutMs - elapsed)))
  }
}
