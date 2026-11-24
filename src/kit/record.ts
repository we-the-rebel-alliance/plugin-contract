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
import { statSync } from "node:fs"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { secretKinds } from "../internal/secrets.ts"
import { readText, relativePath, walkFiles, writeJsonIfChanged } from "./files.ts"
import type { CommandContext, Finding } from "./types.ts"
import { hasError, sortFindings } from "./types.ts"
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

/** Replace credentials and personal data in a JSON value, preserving its keys and their order. */
export function redactValue(value: unknown, path: readonly string[] = []): unknown {
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

/** One file's redaction, as `record` reports it. */
export interface RedactedFile {
  readonly path: string
  readonly changed: boolean
}

/** Redact every JSON file under `dir`; with `write`, rewrite the files that changed. */
export function redactDirectory(dir: string, options: { readonly write: boolean }): { readonly files: RedactedFile[]; readonly findings: Finding[] } {
  const files: RedactedFile[] = []
  const findings: Finding[] = []
  if (!existsSync(dir) || !isDirectory(dir)) {
    return { files, findings: [{ id: "RECORD.missing-directory", level: "error", message: `the fixture directory ${dir} does not exist`, fix: "record the fixtures first, or pass --fixtures <path>" }] }
  }
  for (const path of walkFiles(dir)) {
    if (!path.toLowerCase().endsWith(".json")) continue
    const relative = relativePath(dir, path)
    const text = readText(path)
    if (text === undefined) {
      findings.push({ id: "RECORD.unreadable", level: "error", path: relative, message: "the fixture cannot be read", fix: "check the file and run plugin-kit record again" })
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      findings.push({ id: "RECORD.invalid-json", level: "error", path: relative, message: "the fixture is not JSON, so it cannot be redacted", fix: "record the fixture again; a recording writes JSON" })
      continue
    }
    const redacted = redactValue(parsed)
    const output = `${JSON.stringify(redacted, null, 2)}\n`
    const changed = output !== text
    if (changed && options.write) writeJsonIfChanged(path, redacted)
    if (changed) {
      files.push({ path: relative, changed })
      if (!options.write) {
        findings.push({ id: "RECORD.unredacted", level: "error", path: relative, message: "the fixture still holds a secret or personal data", fix: "run plugin-kit record without --check and commit the redacted fixture" })
      }
    } else {
      files.push({ path: relative, changed: false })
    }
  }
  return { files, findings: sortFindings(findings) }
}

/** `plugin-kit record`: run the recorder, redact every fixture, and fail when a check still finds one. */
export async function runRecord(
  context: CommandContext,
  options: { readonly account?: string | undefined; readonly fixtures: string | undefined; readonly check: boolean },
): Promise<number> {
  const report = options.check ? { ok: true, findings: [] } : await (await context.conformance()).runConformance(context.dir, { record: true })
  const root = options.fixtures === undefined ? join(context.dir, "test", "conformance") : resolve(context.dir, options.fixtures)
  const scoped = options.account !== undefined && isDirectory(join(root, options.account)) ? join(root, options.account) : root
  const redaction = redactDirectory(scoped, { write: !options.check })
  const findings = [...report.findings, ...redaction.findings]
  const changed = redaction.files.filter((file) => file.changed).length
  if (context.json) {
    context.io.stdout(`${JSON.stringify({ command: "record", ok: report.ok && !hasError(redaction.findings), account: options.account, fixtures: relativePath(context.dir, scoped), recorded: redaction.files.length, changed, report, findings }, null, 2)}\n`)
  } else {
    for (const finding of sortFindings(findings)) printFinding(context, finding)
    context.io.stdout(
      `record: ${redaction.files.length} fixture${redaction.files.length === 1 ? "" : "s"} under ${relativePath(context.dir, scoped)}${options.check ? " checked" : ""}, ${changed} ${options.check ? "need redaction" : "redacted"}; conformance ${options.check ? "not run (--check)" : report.ok ? "ok" : "failed"}\n`,
    )
  }
  return report.ok && !hasError(redaction.findings) ? 0 : 1
}


function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
