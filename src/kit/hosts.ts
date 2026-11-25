/**
 * `plugin-kit hosts`: the OpenCode release matrix the kit tests on.
 *
 * The matrix is the contract's, not a plugin's: a plugin's `capabilities.plugin.host.tested` lists the releases its CI
 * ran, and every one of them must be in this matrix (D8). Today there is one release, 2.4.1, and a later 2.4.x joins
 * here first, then in each plugin's manifest.
 */
import { TESTED_OPENCODE } from "../manifest.ts"
import type { CommandContext } from "./types.ts"

/** Every OpenCode release the kit knows how to load a plugin on. */
export const HOSTS: readonly string[] = Object.freeze([TESTED_OPENCODE])

/** The matrix as `plugin-kit hosts` prints it: `[2.4.1]`. */
export function formatHosts(hosts: readonly string[] = HOSTS): string {
  return `[${hosts.join(", ")}]`
}

/** `plugin-kit hosts`: print the matrix. */
export async function runHosts(context: CommandContext): Promise<number> {
  context.io.stdout(context.json ? `${JSON.stringify(HOSTS)}\n` : `${formatHosts()}\n`)
  return 0
}
