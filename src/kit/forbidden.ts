/**
 * `plugin-kit forbidden`: the patterns a committed plugin file may not carry.
 *
 * Four checks, one finding id each:
 *
 * - `FORBIDDEN.app-name`: the plugin names an app. A plugin is host-neutral; an app-only hint is an `x-<app>` key, and
 *   the `x-` prefix is the one place a name is allowed.
 * - `FORBIDDEN.main-branch`: a link points at a `main` branch of a repository under the plugin's own GitHub owner,
 *   read from its `package.json` `repository`. Every repository in the org uses `master`; a third-party repository's
 *   `main` branch is legitimate, and a package with no repository has no owner to flag.
 * - `FORBIDDEN.secret`: a credential is committed. The detector is the contract's own (`secretKinds`), so a fixture, a
 *   doc and an event are judged by one set of patterns. A conformance fixture's signed grant claims are decoded and
 *   screened too: a secret inside a signed claim is found even though the raw token is public test data.
 * - `FORBIDDEN.grant-email`: a verified grant case carries a real person's email. A fixture uses `example.test` or
 *   `example.com`; the decoded claims, the plain input and the plain request are all scanned, and the finding names the
 *   case rather than the address.
 *
 * The scan reads text files only, outside `node_modules`, `dist` and the other generated directories, and never a
 * lockfile: its registry paths and integrity hashes are not the plugin's text.
 */
import { basename, join } from "node:path"
import { secretKinds } from "../internal/secrets.ts"
import { isTextFile, readJson, readText, relativePath, walkFiles } from "./files.ts"
import { FORBIDDEN_APPS, type ForbiddenApp } from "./forbidden-apps.ts"
import { verifiedGrantTokens } from "./grant-token.ts"
import { repositoryOwner, type PackageJson } from "./plugin.ts"
import type { CommandContext, Finding } from "./types.ts"
import { hasError, sortFindings } from "./types.ts"
import { print } from "./output.ts"

/** Files a scan skips: generated from other files, and not the plugin's own text. */
const SKIPPED_FILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "composer.lock", "Cargo.lock"])

/** A link to a repository's `main` branch, in the forms a GitHub link takes; group 1 is the owner. */
const MAIN_LINK = /\bhttps?:\/\/(?:www\.)?github\.com\/([^/\s)"'<>]+)\/[^\s)"'<>]*\/(?:blob|tree|raw)\/main(?:[/#?]|\b)/gi
/** A raw GitHub link names the branch as the fourth path segment; group 1 is the owner. */
const RAW_MAIN_LINK = /\bhttps?:\/\/raw\.githubusercontent\.com\/([^/\s)"'<>]+)\/[^\s)"'<>]*\/main(?:[/#?]|\b)/gi
/** A branch link written without a scheme, as a document often writes one; group 1 is the owner. */
const SHORT_MAIN_LINK = /\bgithub\.com\/([^/\s)"'<>]+)\/[^\s)"'<>]*\/(?:blob|tree|raw)\/main(?:[/#?]|\b)/gi

/** What the scan reads. A test can pass its own app list and skip list. */
export interface ForbiddenOptions {
  readonly apps?: readonly ForbiddenApp[] | undefined
  readonly skip?: readonly string[] | undefined
}

/** A line of `.plugin-kit/forbidden-allow`: one path and one finding id, with the reason it is allowed. */
interface Allowance {
  readonly path: string
  readonly pattern: string
  readonly reason: string
}

/** The allowance file, relative to the plugin root. */
export const ALLOW_FILE = ".plugin-kit/forbidden-allow"

/** The pattern ids an allowance may name: the finding id without its `FORBIDDEN.` prefix. */
const PATTERNS = ["app-name", "main-branch", "secret", "grant-email"] as const

/** Every valid allowance line. A line without a reason is not an allowance. */
function allowances(dir: string): Allowance[] {
  const text = readText(join(dir, ALLOW_FILE))
  if (text === undefined) return []
  const found: Allowance[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    const match = /^(.*):(app-name|main-branch|secret|grant-email|FORBIDDEN\.(?:app-name|main-branch|secret|grant-email))\s+(.+)$/.exec(trimmed)
    if (match === null) continue
    const reason = match[3]!.trim()
    if (reason === "") continue
    found.push({ path: normalizePath(match[1]!), pattern: match[2]!.replace(/^FORBIDDEN\./, ""), reason })
  }
  return found
}

const normalizePath = (path: string): string => path.replace(/\\/g, "/").replace(/^\.\//, "")

/** One finding, unless an allowance names its path and id; a used allowance is reported as a warning. */
function add(findings: Finding[], used: Map<Allowance, number>, allowances: readonly Allowance[], finding: Finding): void {
  const pattern = finding.id.replace(/^FORBIDDEN\./, "")
  const allow = allowances.find((entry) => entry.pattern === pattern && entry.path === finding.path)
  if (allow !== undefined && (PATTERNS as readonly string[]).includes(allow.pattern)) {
    used.set(allow, (used.get(allow) ?? 0) + 1)
    return
  }
  findings.push(finding)
}

/** The signed test-grant tokens a conformance fixture records; only a token its own public key verifies is exempt. */
function grantTokens(text: string): string[] {
  try {
    return [...verifiedGrantTokens(JSON.parse(text))]
  } catch {
    return []
  }
}

/** A plain email address and its domain, for the verified-grant fixture rule. */
const EMAIL = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+)/g

/** True for an address a fixture may commit: `example.test`, `example.com`, or a subdomain of either. */
function exampleDomain(domain: string): boolean {
  const lower = domain.toLowerCase()
  return lower === "example.test" || lower === "example.com" || lower.endsWith(".example.test") || lower.endsWith(".example.com")
}

/** One compact token's decoded payload text, or undefined when the token has no payload segment. */
function grantClaimText(token: unknown): string | undefined {
  if (typeof token !== "string") return undefined
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  const payload = parts[1]
  if (payload === undefined || payload === "") return undefined
  try {
    return Buffer.from(payload, "base64url").toString("utf8")
  } catch {
    return undefined
  }
}

/**
 * The findings inside a conformance fixture's signed grant cases: a secret in a decoded claim (`FORBIDDEN.secret`), and
 * a real email in a verified case's claims, input or request (`FORBIDDEN.grant-email`). The raw token text is exempt
 * only when its key verifies it; these checks look past that exemption, at the claims a token carries.
 */
function grantClaimFindings(relative: string, text: string): Finding[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return []
  }
  const grants = typeof value === "object" && value !== null ? (value as Record<string, unknown>)["grants"] : undefined
  if (typeof grants !== "object" || grants === null) return []
  const cases = (grants as Record<string, unknown>)["cases"]
  if (!Array.isArray(cases)) return []
  const findings: Finding[] = []
  for (const [index, entry] of cases.entries()) {
    if (typeof entry !== "object" || entry === null) continue
    const record = entry as Record<string, unknown>
    const where = typeof record["name"] === "string" ? record["name"] : `case ${index + 1}`
    const claims = grantClaimText(record["token"])
    if (claims !== undefined) {
      for (const kind of secretKinds(claims)) {
        findings.push({
          id: "FORBIDDEN.secret",
          level: "error",
          path: relative,
          message: `the signed grant claim in ${where} holds a credential (${kind}); a committed fixture never carries one`,
          fix: "remove it, rotate it with the provider, and record the fixture again through plugin-kit record",
        })
      }
    }
    const expect = typeof record["expect"] === "object" && record["expect"] !== null ? (record["expect"] as Record<string, unknown>) : {}
    if (expect["ok"] !== true) continue
    const scanned = [claims ?? "", JSON.stringify(record["input"] ?? ""), JSON.stringify(record["request"] ?? "")]
    let outside = false
    for (const candidate of scanned) {
      for (const match of candidate.matchAll(new RegExp(EMAIL.source, EMAIL.flags))) if (!exampleDomain(match[1]!)) outside = true
    }
    if (outside) {
      findings.push({
        id: "FORBIDDEN.grant-email",
        level: "error",
        path: relative,
        // The address is personal data: name the case, never the mailbox or its domain.
        message: `verified grant case ${where} carries an address outside example.test and example.com; a fixture uses invented addresses only`,
        fix: "replace the address with one on example.test or example.com, and record the fixture again",
      })
    }
  }
  return findings
}

/** The GitHub owner of the package under `dir`, or undefined when it names no GitHub repository. */
function packageOwner(dir: string): string | undefined {
  const raw = readJson(join(dir, "package.json"))
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined
  return repositoryOwner((raw as PackageJson).repository)
}

/** Every forbidden pattern under `dir`, with the line each was found on. */
export function forbiddenFindings(dir: string, options: ForbiddenOptions = {}): Finding[] {
  const apps = options.apps ?? FORBIDDEN_APPS
  const findings: Finding[] = []
  const allowed = allowances(dir)
  const owner = packageOwner(dir)
  const used = new Map<Allowance, number>()
  for (const path of walkFiles(dir, options.skip === undefined ? {} : { skip: options.skip })) {
    const name = basename(path)
    if (SKIPPED_FILES.has(name) || !isTextFile(path)) continue
    const relative = relativePath(dir, path)
    if (relative === ALLOW_FILE) continue
    const text = readText(path)
    if (text === undefined) continue
    // A conformance fixture records signed test grants; those tokens are public test data, not secrets.
    const exempt = relative.endsWith("fixtures/conformance.json") ? grantTokens(text) : []
    const withoutGrants = exempt.reduce((value, token) => value.split(token).join("<grant-token>"), text)
    // The raw token exemption does not hide what the signed claims carry: decode the payload and screen it.
    // A claim's findings take the same allowance path as every other pattern.
    if (relative.endsWith("fixtures/conformance.json")) for (const finding of grantClaimFindings(relative, text)) add(findings, used, allowed, finding)
    const lines = text.split(/\r?\n/)
    const scanLines = withoutGrants.split(/\r?\n/)
    const seen = new Set<string>()
    const reportedKinds = new Set<string>()
    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1
      for (const app of apps) {
        for (const match of line.matchAll(app.pattern)) {
          const at = match.index ?? 0
          // An `x-<app>` key is the one place a name belongs: skip a match written as a key.
          if (line.slice(Math.max(0, at - 2), at).toLowerCase() === "x-") continue
          const key = `app:${lineNumber}:${app.name}`
          if (seen.has(key)) continue
          seen.add(key)
          add(findings, used, allowed, {
            id: "FORBIDDEN.app-name",
            level: "error",
            path: relative,
            message: `line ${lineNumber} names the ${app.name} app; a plugin is host-neutral, and an app-only hint belongs in an x-<app> key`,
            fix: "remove the app name, or move the hint under an x-<app> key in capabilities",
          })
        }
      }
      for (const pattern of [MAIN_LINK, RAW_MAIN_LINK, SHORT_MAIN_LINK]) {
        const regex = new RegExp(pattern.source, pattern.flags)
        for (const match of line.matchAll(regex)) {
          // A third-party repository's main branch is legitimate; only the plugin's own owner is the org's.
          if (owner === undefined || match[1]!.toLowerCase() !== owner.toLowerCase()) continue
          const key = `main:${lineNumber}`
          if (seen.has(key)) continue
          seen.add(key)
          add(findings, used, allowed, {
            id: "FORBIDDEN.main-branch",
            level: "error",
            path: relative,
            message: `line ${lineNumber} links to the main branch of a repository under this plugin's owner; every repository in the org uses master`,
            fix: "point the link at master, not main",
          })
        }
      }
      const kinds = secretKinds(scanLines[index] ?? line)
      for (const kind of kinds) {
        reportedKinds.add(kind)
        const key = `secret:${lineNumber}:${kind}`
        if (seen.has(key)) continue
        seen.add(key)
        add(findings, used, allowed, {
          id: "FORBIDDEN.secret",
          level: "error",
          path: relative,
          message: `line ${lineNumber} holds what looks like a ${kind}; a committed file never carries one`,
          fix: "remove it, rotate it with the provider, and record the fixture again through plugin-kit record",
        })
      }
    }
    // A private key block can span lines, so one line at a time would miss the header without its body.
    for (const kind of secretKinds(withoutGrants)) {
      const key = `whole:${kind}`
      if (seen.has(key) || reportedKinds.has(kind)) continue
      seen.add(key)
      add(findings, used, allowed, {
        id: "FORBIDDEN.secret",
        level: "error",
        path: relative,
        message: `the file holds what looks like a ${kind}; a committed file never carries one`,
        fix: "remove it, rotate it with the provider, and record the fixture again through plugin-kit record",
      })
    }
  }
  for (const [allow, count] of used) {
    findings.push({
      id: "FORBIDDEN.suppressed",
      level: "warning",
      path: allow.path,
      message: `${allow.pattern} is suppressed for ${allow.path}${count > 1 ? ` (${count} matches)` : ""}: ${allow.reason}`,
    })
  }
  return sortFindings(findings)
}

/** `plugin-kit forbidden`: scan the plugin directory and print every finding. */
export async function runForbidden(context: CommandContext): Promise<number> {
  const findings = forbiddenFindings(context.dir)
  print(context, findings, findings.length === 0 ? "forbidden: ok" : "forbidden: patterns found")
  return hasError(findings) ? 1 : 0
}
