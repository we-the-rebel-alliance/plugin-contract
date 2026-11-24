/**
 * `fixtures/conformance.json`: what a plugin's own tests recorded, and the kit replays.
 *
 * The file is the plugin's evidence. It is read from the installed package beside `package.json`, never from RPC, and
 * every section is optional so a plugin can adopt the checks it can prove first:
 *
 *   plugin     the package name the fixture was recorded for
 *   accounts   the aliases, ACCOUNT_REQUIRED, ACCOUNT_UNKNOWN and a cursor another account may not use
 *   sources    per source id: events cases, probe, details, suggest, snapshot and the reasons a page check does not apply
 *   events     the bus events a recorded test emitted, and the status answer
 *   grants     a host public key and the recorded grant cases (#40)
 *   rpc        the inputs whose non-read calls were refused without an ask (LD-5)
 *   pinned     the session evidence for a pinned method (standard §0.2)
 *
 * A section a fixture omits is not silently passed: the check that needs it says so, or `record: true` turns it into a
 * warning while the fixture is being written.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { RecordedAccounts } from "./accounts.ts"
import type { RecordedSource } from "../events-conformance.ts"
import type { RecordedEvents } from "./status.ts"
import type { RecordedGrants, RecordedRpc } from "./grants.ts"

/** One recorded action: the preview it answered and the commit it ran. */
export interface RecordedAction {
  readonly id: string
  readonly preview?: { readonly answer?: unknown } | undefined
  readonly commit?: { readonly answer?: unknown } | undefined
}

/** The whole fixture. */
export interface Fixture {
  readonly plugin?: string | undefined
  readonly accounts?: RecordedAccounts | undefined
  readonly sources?: Readonly<Record<string, RecordedSource>> | undefined
  readonly events?: RecordedEvents | undefined
  readonly actions?: readonly RecordedAction[] | undefined
  readonly grants?: RecordedGrants | undefined
  readonly rpc?: RecordedRpc | undefined
  readonly pinned?: Readonly<Record<string, unknown>> | undefined
}

/** The fixture, or why it cannot be read. `absent` is not an error: a check says what it needs. */
export function readFixture(directory: string): { readonly fixture?: Fixture; readonly problem?: string } {
  let text: string
  try {
    text = readFileSync(join(directory, "fixtures", "conformance.json"), "utf8")
  } catch {
    return {}
  }
  try {
    const value = JSON.parse(text) as unknown
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { problem: "fixtures/conformance.json is not an object" }
    return { fixture: value as Fixture }
  } catch (cause) {
    return { problem: `fixtures/conformance.json is not JSON: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
}
