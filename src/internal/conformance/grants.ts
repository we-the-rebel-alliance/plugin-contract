/**
 * Grants and the RPC confirmation (contract §8, §13, §16; issue #40; LD-5).
 *
 * A non-`read` method over RPC runs only with an OpenCode permission ask that was answered, or a valid action grant
 * verified by the `grant` module. T1 calls every non-read RPC handler with the ask denied and requires a refusal; this
 * module checks the grant verifier itself over recorded cases, including the four disagreements the old per-plugin
 * copies had: the wrong audience, a replay, an expired grant and a digest mismatch (issue #40).
 *
 * The recording is the plugin's own: a host public key, compact tokens and the exact input each was signed for. The
 * verifier does no I/O and reads no clock, so a recorded case replays exactly.
 */
import { verifyGrant, type GrantCode, type GrantRequest } from "../../grant.ts"
import type { Manifest } from "../../manifest.ts"
import { error, warning, type Finding } from "./report.ts"

/** One recorded grant case. */
export interface RecordedGrantCase {
  readonly name?: string | undefined
  readonly token?: unknown
  readonly input?: unknown
  readonly request?: Readonly<Record<string, unknown>> | undefined
  readonly store?: { readonly used?: readonly string[] | undefined } | undefined
  readonly expect?: { readonly ok?: unknown; readonly code?: unknown } | undefined
}

/** What a plugin records about grants. */
export interface RecordedGrants {
  readonly publicKey?: unknown
  readonly cases?: readonly RecordedGrantCase[] | undefined
}

/** What a plugin records about the RPC door. */
export interface RecordedRpc {
  readonly inputs?: Readonly<Record<string, unknown>> | undefined
  readonly calls?: readonly { readonly method?: unknown; readonly ask?: unknown; readonly grant?: unknown; readonly expect?: unknown }[] | undefined
}

/** The four refusals #40 asks every adopter to prove, and one success. */
export const REQUIRED_GRANT_CODES: readonly GrantCode[] = ["GRANT_AUDIENCE_MISMATCH", "GRANT_DIGEST_MISMATCH", "GRANT_EXPIRED", "GRANT_REPLAYED"]

/** The `kid` a compact token's header names. */
function kidOf(token: string): string | undefined {
  const [encoded] = token.split(".")
  if (encoded === undefined) return undefined
  try {
    const header = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { kid?: unknown }
    return typeof header.kid === "string" ? header.kid : undefined
  } catch {
    return undefined
  }
}

/** Every grant finding: the verifier over the recorded cases, and the cases #40 requires. */
export async function grantFindings(manifest: Manifest, recorded: RecordedGrants | undefined, options: { readonly record?: boolean | undefined } = {}): Promise<Finding[]> {
  const findings: Finding[] = []
  const nonLocal = manifest.actions.filter((action) => action.effect !== "local")
  if (nonLocal.length === 0) return findings
  if (recorded === undefined || (recorded.cases ?? []).length === 0) {
    findings.push(
      options.record === true
        ? warning("grants.recorded", `${manifest.plugin.name} has non-local actions and records no grant case yet`, { path: "fixtures/conformance.json" })
        : error("grants.recorded", `${manifest.plugin.name} has non-local actions and records no grant case`, {
            path: "fixtures/conformance.json",
            fix: "Record a valid grant and the four refusals #40 names, then verify them with the grant module.",
          }),
    )
    return findings
  }
  const publicKey = recorded.publicKey
  if (typeof publicKey !== "string" || publicKey.trim() === "") {
    findings.push(error("grants.key", "the grant recording names no host public key", { path: "fixtures/conformance.json", fix: "Record the host's public key, never its private key." }))
    return findings
  }
  const codes = new Set<string>()
  let succeeded = false
  for (const [index, item] of (recorded.cases ?? []).entries()) {
    const where = `grant(${item.name ?? `case ${index + 1}`})`
    if (typeof item.token !== "string") {
      findings.push(error("grants.case", `${where} has no token`, { path: "fixtures/conformance.json" }))
      continue
    }
    if (item.request === undefined) {
      findings.push(error("grants.case", `${where} has no request: the action, consumer, account, scope and manifest it was signed for`, { path: "fixtures/conformance.json" }))
      continue
    }
    if (item.expect === undefined || typeof item.expect.ok !== "boolean") {
      findings.push(error("grants.case", `${where} says neither that the grant verifies nor that it is refused`, { path: "fixtures/conformance.json" }))
      continue
    }
    const act = item.request["act"]
    if (typeof act === "string" && !manifest.actions.some((action) => action.id === act)) {
      findings.push(error("grants.action", `${where} is signed for ${act}, which capabilities.actions does not declare`, { path: "fixtures/conformance.json" }))
    }
    const kid = kidOf(item.token) ?? "host"
    const used = new Set(item.store?.used ?? [])
    const request = {
      ...item.request,
      grant: item.token,
      input: item.input,
      keys: { keys: { [kid]: publicKey } },
      store: {
        consume: async (claims: { jti: string }) => {
          if (used.has(claims.jti)) return false
          used.add(claims.jti)
          return true
        },
      },
    } as unknown as GrantRequest
    const outcome = await verifyGrant(request)
    if (item.expect.ok === true) {
      if (!outcome.ok) {
        findings.push(error("grants.verdict", `${where} does not verify: ${outcome.code} (${outcome.reason})`, { path: "fixtures/conformance.json" }))
        continue
      }
      succeeded = true
      continue
    }
    const expected = typeof item.expect.code === "string" ? item.expect.code : undefined
    if (outcome.ok) {
      findings.push(error("grants.verdict", `${where} verifies, and the recording says it is refused${expected === undefined ? "" : ` (${expected})`}`, { path: "fixtures/conformance.json" }))
      continue
    }
    codes.add(outcome.code)
    if (expected !== undefined && outcome.code !== expected) findings.push(error("grants.verdict", `${where} is refused with ${outcome.code}, not the recorded ${expected}`, { path: "fixtures/conformance.json" }))
  }
  if (!succeeded) findings.push(error("grants.cases", "no recorded grant verifies: a verifier that only refuses is not proven", { path: "fixtures/conformance.json" }))
  const missing = REQUIRED_GRANT_CODES.filter((code) => !codes.has(code))
  if (missing.length > 0) {
    findings.push(
      error("grants.cases", `the recording proves no ${missing.join(", ")}: #40's negative cases settle where the per-plugin copies disagreed`, {
        path: "fixtures/conformance.json",
        fix: "Record one case for each required refusal.",
      }),
    )
  }
  return findings
}

/** The RPC confirmation, when a plugin records its calls: a non-read method with the ask denied is refused. */
export function rpcConfirmationFindings(manifest: Manifest, recorded: RecordedRpc | undefined, options: { readonly record?: boolean | undefined } = {}): Finding[] {
  const calls = recorded?.calls ?? []
  if (calls.length === 0) return []
  const findings: Finding[] = []
  for (const [index, call] of calls.entries()) {
    const method = typeof call.method === "string" ? call.method : ""
    const item = manifest.methods[method]
    if (item === undefined) {
      findings.push(error("rpc.method", `rpc.calls[${index}] names ${String(call.method)}, which is not a declared method`, { path: "fixtures/conformance.json" }))
      continue
    }
    if (item.class === "read") continue
    const expect = call.expect !== null && typeof call.expect === "object" ? (call.expect as Record<string, unknown>) : {}
    if (call.ask === "denied") {
      const refused = expect["code"] === "PERMISSION_DENIED"
      if (!refused) findings.push(error("rpc.confirmation", `${method} is class ${item.class}, and its recorded RPC call with the ask denied answers ${String(expect["code"])}, not PERMISSION_DENIED`, { path: "fixtures/conformance.json", fix: "Refuse a non-read method over RPC without an answered ask or a valid grant." }))
      continue
    }
    if (call.grant !== undefined && call.ask === "none" && expect["ok"] !== true) {
      findings.push(error("rpc.grant", `${method}'s RPC call presents a grant and answers ${String(expect["code"] ?? expect["ok"])}, not success`, { path: "fixtures/conformance.json" }))
    }
  }
  return findings
}
