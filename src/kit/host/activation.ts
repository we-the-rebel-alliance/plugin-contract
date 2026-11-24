/**
 * The first of the six OpenCode 2.4 behaviours: plugins load in the background, so a host test waits, with a bound, for
 * the plugin to become active before its first RPC call.
 *
 * A test that calls sooner sees `rpc.method_not_found` or an empty tool list, and learns nothing about the plugin. The
 * wait is bounded so a plugin that never activates fails with a next step instead of hanging CI.
 */
import { KitError } from "../types.ts"

/** What activation needs from the host: a predicate, a bound, and the clock and sleep a test can replace. */
export interface ActivationOptions {
  /** The host's answer for "is the plugin's setup done?". */
  readonly isActive: () => boolean | Promise<boolean>
  /** The most time to wait, in milliseconds. Default 10_000. */
  readonly timeoutMs?: number | undefined
  /** How long to wait between checks, in milliseconds. Default 25. */
  readonly pollMs?: number | undefined
  readonly now?: (() => number) | undefined
  readonly sleep?: ((ms: number) => Promise<void>) | undefined
}

const sleepFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Wait until the plugin is active, and throw `KIT_TIMEOUT` at the bound. */
export async function waitForActivation(options: ActivationOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const pollMs = options.pollMs ?? 25
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? sleepFor
  const started = now()
  for (;;) {
    if (await options.isActive()) return
    if (now() - started >= timeoutMs) {
      throw new KitError(
        "KIT_TIMEOUT",
        `the plugin did not become active within ${timeoutMs} ms`,
        "read the host log for a setup error; T1 cannot call a plugin before it finishes setup",
      )
    }
    await sleep(Math.min(pollMs, Math.max(1, timeoutMs - (now() - started))))
  }
}
