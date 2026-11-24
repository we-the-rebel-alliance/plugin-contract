/**
 * `plugin-kit forbidden`: the patterns a committed plugin file may not carry.
 *
 * Three checks, one finding id each:
 *
 * - `FORBIDDEN.app-name`: the plugin names an app. A plugin is host-neutral; an app-only hint is an `x-<app>` key, and
 *   the `x-` prefix is the one place a name is allowed.
 * - `FORBIDDEN.main-branch`: a link points at a `main` branch. Every repository in the org uses `master`.
 * - `FORBIDDEN.secret`: a credential is committed. The detector is the contract's own (`secretKinds`), so a fixture, a
 *   doc and an event are judged by one set of patterns.
 *
 * The scan reads text files only, outside `node_modules`, `dist` and the other generated directories, and never a
 * lockfile: its registry paths and integrity hashes are not the plugin's text.
 */
import { basename } from "node:path"
import { secretKinds } from "../internal/secrets.ts"
import { isTextFile, readText, relativePath, walkFiles } from "./files.ts"
import { FORBIDDEN_APPS, type ForbiddenApp } from "./forbidden-apps.ts"
import type { CommandContext, Finding } from "./types.ts"
import { hasError, sortFindings } from "./types.ts"
import { print } from "./output.ts"

/** Files a scan skips: generated from other files, and not the plugin's own text. */
const SKIPPED_FILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "composer.lock", "Cargo.lock"])

/** A link to a repository's `main` branch, in the forms a GitHub link takes. */
const MAIN_LINK = /\bhttps?:\/\/[^\s)"'<>]*\/(?:blob|tree|raw)\/main(?:[/#?]|\b)/gi
/** A raw GitHub link names the branch as the fourth path segment. */
const RAW_MAIN_LINK = /\bhttps?:\/\/raw\.githubusercontent\.com\/[^\s)"'<>]+\/main(?:[/#?]|\b)/gi
/** A branch link written without a scheme, as a document often writes one. */
const SHORT_MAIN_LINK = /\bgithub\.com\/[^\s)"'<>]+\/(?:blob|tree|raw)\/main(?:[/#?]|\b)/gi

/** What the scan reads. A test can pass its own app list and skip list. */
export interface ForbiddenOptions {
  readonly apps?: readonly ForbiddenApp[] | undefined
  readonly skip?: readonly string[] | undefined
}

/** Every forbidden pattern under `dir`, with the line each was found on. */
export function forbiddenFindings(dir: string, options: ForbiddenOptions = {}): Finding[] {
  const apps = options.apps ?? FORBIDDEN_APPS
  const findings: Finding[] = []
  for (const path of walkFiles(dir, options.skip === undefined ? {} : { skip: options.skip })) {
    const name = basename(path)
    if (SKIPPED_FILES.has(name) || !isTextFile(path)) continue
    const relative = relativePath(dir, path)
    const text = readText(path)
    if (text === undefined) continue
    const lines = text.split(/\r?\n/)
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
          findings.push({
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
        for (const _match of line.matchAll(regex)) {
          const key = `main:${lineNumber}`
          if (seen.has(key)) continue
          seen.add(key)
          findings.push({
            id: "FORBIDDEN.main-branch",
            level: "error",
            path: relative,
            message: `line ${lineNumber} links to the main branch of a repository; every repository in the org uses master`,
            fix: "point the link at master, not main",
          })
        }
      }
      const kinds = secretKinds(line)
      for (const kind of kinds) {
        reportedKinds.add(kind)
        const key = `secret:${lineNumber}:${kind}`
        if (seen.has(key)) continue
        seen.add(key)
        findings.push({
          id: "FORBIDDEN.secret",
          level: "error",
          path: relative,
          message: `line ${lineNumber} holds what looks like a ${kind}; a committed file never carries one`,
          fix: "remove it, rotate it with the provider, and record the fixture again through plugin-kit record",
        })
      }
    }
    // A private key block can span lines, so one line at a time would miss the header without its body.
    for (const kind of secretKinds(text)) {
      const key = `whole:${kind}`
      if (seen.has(key) || reportedKinds.has(kind)) continue
      seen.add(key)
      findings.push({
        id: "FORBIDDEN.secret",
        level: "error",
        path: relative,
        message: `the file holds what looks like a ${kind}; a committed file never carries one`,
        fix: "remove it, rotate it with the provider, and record the fixture again through plugin-kit record",
      })
    }
  }
  return sortFindings(findings)
}

/** `plugin-kit forbidden`: scan the plugin directory and print every finding. */
export async function runForbidden(context: CommandContext): Promise<number> {
  const findings = forbiddenFindings(context.dir)
  print(context, findings, findings.length === 0 ? "forbidden: ok" : "forbidden: patterns found")
  return hasError(findings) ? 1 : 0
}

