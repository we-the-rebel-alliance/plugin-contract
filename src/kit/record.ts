/**
 * `plugin-kit record`: record conformance fixtures, then remove the secrets and personal data they carry.
 *
 * The recording itself belongs to the plugin's conformance calls: `runConformance(pluginDir, { record: true })` writes
 * the provider answers. This module does the second half, the half CI must prove: every JSON fixture is read, every
 * credential and every personal value is replaced, and a fixture that still needs a redaction fails a check.
 *
 * Redaction is deterministic and idempotent: a placeholder contains no pattern, so a second run changes nothing. It never
 * reorders keys, so a diff shows only the values that were replaced.
 */
import { join, resolve } from "node:path"
import { eventHash } from "../events.ts"
import { secretKinds } from "../internal/secrets.ts"
import { readText, relativePath, writeJsonIfChanged } from "./files.ts"
import type { CommandContext, Finding } from "./types.ts"
import { hasError, KitError, sortFindings } from "./types.ts"
import { printFinding } from "./output.ts"

const PLACEHOLDER = {
  secret: "<redacted:secret>",
  email: "<redacted:email>",
  phone: "<redacted:phone>",
  home: "<redacted:home>",
  personal: "<redacted:personal>",
  query: "<redacted>",
} as const

/** A key whose value is a credential, whatever it holds. */
const SECRET_KEY = /(?:(?:^|[_.-])(?:token|secret|password|passwd|pwd|apikey|api_key|api-key|authorization|cookie|credential|credentials|private_key|private-key|client_secret|client-secret|access_token|refresh_token)(?:$|[_.-])|^(?:accessToken|refreshToken|idToken|apiKey|clientSecret|privateKey|sessionToken|botToken)$)/i

/** A key whose value is personal data: an address, a phone number, a person's name. */
const PERSONAL_KEY = /^(?:e?mail|phone|phone_number|phoneNumber|mobile|address|username|user_name|login|display_name|displayName|real_name|realName|full_name|fullName|first_name|firstName|name)$/i

/**
 * Replace the patterns in one string: a credential gives the whole string up, because a token's neighbours may be as
 * revealing as the token; an email, a phone number, a home path and a sensitive query value are replaced in place.
 */
export function redactText(text: string): string {
  if (secretKinds(text).length > 0) return PLACEHOLDER.secret
  let result = text
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, PLACEHOLDER.email)
    // An E.164 number starts with + and has 8–15 digits. A timestamp or a plain account id has no leading +, so it is
    // not a phone number; a phone-shaped value under a phone key is redacted by key, not by this pattern.
    .replace(/(?<![\w+])\+\d[\d ().-]{5,}\d(?![\w])/g, (match) => {
      const digits = match.replace(/\D/g, "").length
      return digits >= 8 && digits <= 15 ? PLACEHOLDER.phone : match
    })
    .replace(/\/(?:home|Users)\/[A-Za-z0-9._/-]+/g, PLACEHOLDER.home)
  result = result.replace(/([?&](?:access_token|refresh_token|token|key|api_key|apikey|secret|client_secret|signature|sig|password|email|code)=)[^&#\s]+/gi, `$1${PLACEHOLDER.query}`)
  return result
}

/** Recompute an event's hash after redaction, so a redacted fixture still satisfies the page check. */
function rehash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rehash)
  if (typeof value !== "object" || value === null) return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) result[key] = rehash(item)
  if (typeof result["external_id"] === "string" && typeof result["hash"] === "string" && Array.isArray(result["actors"])) {
    try {
      result["hash"] = eventHash(result as never)
    } catch {
      // A malformed event is the conformance check's finding, not a reason to make record throw.
    }
  }
  return result
}

/** Replace credentials and personal data in a JSON value, preserving its keys and their order. */
export function redactValue(value: unknown, path: readonly string[] = []): unknown {
  // A conformance fixture's `grants` are signed test cases: their names, inputs and tokens are fixture data, not secrets.
  if (path[0] === "grants") return value
  if (typeof value === "string") return redactText(value)
  if (Array.isArray(value)) return value.map((item) => redactValue(item, path))
  if (typeof value !== "object" || value === null) return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      result[key] = PLACEHOLDER.secret
      continue
    }
    // `events.status.name` is the plugin's name, which status is checked against; every other name in a fixture is a
    // person's or an account's and is personal data.
    const keepsStatusName = key === "name" && path.length === 2 && path[0] === "events" && path[1] === "status"
    if (PERSONAL_KEY.test(key) && !keepsStatusName) {
      result[key] = PLACEHOLDER.personal
      continue
    }
    result[key] = redactValue(item, [...path, key])
  }
  return result
}

/** The fixture file a plugin records, beside its package. */
export const FIXTURE_FILE = "fixtures/conformance.json"

/** One parsed fixture, or undefined for a missing or malformed file (the finding names which). */
function fixtureAt(path: string, display: string): { readonly text: string; readonly value: Record<string, unknown> } | { readonly finding: Finding } {
  const text = readText(path)
  if (text === undefined) {
    return { finding: { id: "RECORD.missing-file", level: "error", path: display, message: `${display} is missing`, fix: "the plugin's recorder must write fixtures/conformance.json before record can redact it" } }
  }
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return { text, value: value as Record<string, unknown> }
  } catch {
    // The finding below names the file and the next step.
  }
  return { finding: { id: "RECORD.invalid-json", level: "error", path: display, message: `${display} is not a JSON object`, fix: "record the fixture again; a recording writes a JSON object" } }
}

/** The aliases a fixture records, or none when it records no accounts section. */
export function fixtureAliases(value: Record<string, unknown>): string[] {
  const accounts = value["accounts"]
  if (typeof accounts !== "object" || accounts === null) return []
  const aliases = (accounts as Record<string, unknown>)["aliases"]
  return Array.isArray(aliases) ? aliases.filter((alias): alias is string => typeof alias === "string") : []
}

/** `plugin-kit record`: run the recorder, then redact and write the one fixture #59 reads. */
export async function runRecord(
  context: CommandContext,
  options: { readonly account?: string | undefined; readonly fixtures: string | undefined; readonly check: boolean },
): Promise<number> {
  const file = options.fixtures === undefined ? join(context.dir, "fixtures", "conformance.json") : resolve(context.dir, options.fixtures)
  const report = options.check ? { ok: true, findings: [] } : await (await context.conformance()).runConformance(context.dir, { record: true })
  const display = relativePath(context.dir, file)
  const read = fixtureAt(file, display)
  if ("finding" in read) {
    const findings = [...report.findings, read.finding]
    printResult(context, findings, options, file, 0, report, "missing")
    return 1
  }
  const aliases = fixtureAliases(read.value)
  if (options.account !== undefined && !aliases.includes(options.account)) {
    throw new KitError("KIT_ACCOUNT_UNKNOWN", `the fixture records no account alias ${JSON.stringify(options.account)}`, `record one of ${aliases.length === 0 ? "the fixture's aliases" : aliases.join(", ")}, or pass --account with one of them`)
  }
  const redacted = rehash(redactValue(read.value))
  const output = `${JSON.stringify(redacted, null, 2)}\n`
  const changed = output !== read.text
  if (changed && !options.check) writeJsonIfChanged(file, redacted)
  const findings = [...report.findings, ...(changed && options.check ? [{ id: "RECORD.unredacted", level: "error" as const, path: display, message: "the fixture still holds a secret or personal data", fix: "run plugin-kit record without --check and commit the redacted fixture" }] : [])]
  printResult(context, findings, options, file, changed ? 1 : 0, report, changed ? (options.check ? "needs redaction" : "redacted") : "unchanged")
  return report.ok && !hasError(findings) ? 0 : 1
}

/** Print the record result, in text or JSON. */
function printResult(
  context: CommandContext,
  findings: readonly Finding[],
  options: { readonly account?: string | undefined; readonly check: boolean },
  file: string,
  changed: number,
  report: { readonly ok: boolean; readonly findings: readonly Finding[] },
  state: string,
): void {
  if (context.json) {
    context.io.stdout(`${JSON.stringify({ command: "record", ok: report.ok && !hasError(findings), account: options.account, fixture: relativePath(context.dir, file), changed, state, report, findings }, null, 2)}\n`)
    return
  }
  for (const finding of sortFindings(findings)) printFinding(context, finding)
  context.io.stdout(`record: ${relativePath(context.dir, file)} ${options.check ? "checked" : "written"}, ${state}; conformance ${options.check ? "not run (--check)" : report.ok ? "ok" : "failed"}\n`)
}
