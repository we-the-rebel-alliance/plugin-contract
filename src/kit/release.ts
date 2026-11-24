/**
 * `plugin-kit release <version>`: the files a release needs, then the tag CI publishes from.
 *
 * The order is the contract's: checks first, then a changelog section, then the version in `package.json` (and the
 * lockfile), then one commit and one annotated tag. A tag is local; pushing it is the owner's step, and the GitHub
 * release is cut by CI on that tag (plugin standard §9). `--dry-run` writes nothing and prints the plan.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { checkPlugin } from "./check.ts"
import { readText, writeTextIfChanged } from "./files.ts"
import { readPlugin } from "./plugin.ts"
import { printFinding } from "./output.ts"
import type { CommandContext, Finding } from "./types.ts"
import { hasError, KitError, sortFindings } from "./types.ts"

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** A version as a tag: `v0.0.0`. */
export const tagOf = (version: string): string => `v${version}`

/** Whether a version is semver, as a release tag may be. */
export function isReleaseVersion(version: string): boolean {
  return VERSION.test(version)
}

/** The date a changelog section carries: UTC, `YYYY-MM-DD`. */
export function releaseDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** Add the version's section to a changelog, or rename `Unreleased` to it. */
export function changelogFor(text: string, version: string, date: string): { readonly text: string; readonly changed: boolean } {
  const heading = `## [${version}] - ${date}`
  if (new RegExp(`^## \\[?${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]?(?:\\s|$)`, "m").test(text)) return { text, changed: false }
  const unreleased = /^## \[?Unreleased\]?[ \t]*$/m.exec(text)
  if (unreleased !== null) {
    const at = unreleased.index
    const after = at + unreleased[0].length
    const rest = text.slice(after)
    const empty = /^\s*(?=## |$)/.test(rest)
    const body = `${heading}${empty ? `\n\n- Release ${version}.` : ""}`
    return { text: `${text.slice(0, at)}${body}${rest}`, changed: true }
  }
  const first = /^# .*$/m.exec(text)
  const section = `${heading}\n\n- Release ${version}.\n`
  if (first === null) return { text: `${section}\n${text}`, changed: true }
  const at = first.index + first[0].length
  return { text: `${text.slice(0, at)}\n\n${section}${text.slice(at).replace(/^\n+/, "\n")}`, changed: true }
}

/** The package.json and lockfile a release writes. */
export function versionedFiles(dir: string, version: string): { readonly package: string; readonly lock?: string; readonly changed: string[] } {
  const packageFile = join(dir, "package.json")
  const pkg = parseObject(packageFile, readText(packageFile) ?? "{}")
  pkg["version"] = version
  const files = new Map<string, string>()
  files.set("package.json", `${JSON.stringify(pkg, null, 2)}\n`)
  const lockFile = join(dir, "package-lock.json")
  if (existsSync(lockFile)) {
    const lock = parseObject(lockFile, readText(lockFile) ?? "{}")
    lock["version"] = version
    const packages = typeof lock["packages"] === "object" && lock["packages"] !== null ? (lock["packages"] as Record<string, unknown>) : undefined
    const root = packages?.[""]
    if (typeof root === "object" && root !== null) (root as Record<string, unknown>)["version"] = version
    files.set("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`)
  }
  const changed = [...files].filter(([file, text]) => readText(join(dir, file)) !== text).map(([file]) => file)
  return { package: files.get("package.json")!, ...(files.has("package-lock.json") ? { lock: files.get("package-lock.json")! } : {}), changed }
}

/** A JSON object a release edits, or a `KIT_RELEASE` naming the file that is not one. */
function parseObject(file: string, text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    // The same next step whether it is not JSON or not an object.
  }
  throw new KitError("KIT_RELEASE", `${file} is not a JSON object, so the release cannot write its version`, "repair the file, then run release again")
}

/** `plugin-kit release <version>`: checks, changelog, version, one commit and one tag. */
export async function runRelease(context: CommandContext, version: string, options: { readonly dryRun: boolean }): Promise<number> {
  if (!isReleaseVersion(version)) throw new KitError("KIT_VERSION", `"${version}" is not a release version`, "pass a semver release, such as 0.0.0 or 0.1.0")
  readPlugin(context.dir)
  const findings: Finding[] = [...(await checkPlugin(context))]
  if (hasError(findings)) {
    for (const finding of sortFindings(findings)) printFinding(context, finding)
    context.io.stdout(`release: checks failed, so ${tagOf(version)} was not cut\n`)
    return 1
  }
  const changelogFile = join(context.dir, "CHANGELOG.md")
  const changelog = readText(changelogFile)
  if (changelog === undefined) throw new KitError("KIT_RELEASE", "CHANGELOG.md is missing, so there is no section to write", "create CHANGELOG.md with a title and run release again")
  const dated = changelogFor(changelog, version, releaseDate(context.now()))
  const files = versionedFiles(context.dir, version)
  const changelogChanged = dated.changed
  const written = [...new Set([...files.changed, ...(changelogChanged ? ["CHANGELOG.md"] : [])])].sort()
  const tag = tagOf(version)
  if (options.dryRun) {
    const answer = { command: "release", ok: true, version, tag, dryRun: true, files: written, findings }
    if (context.json) context.io.stdout(`${JSON.stringify(answer, null, 2)}\n`)
    else context.io.stdout(`release: would prepare ${tag}${written.length === 0 ? " (nothing to write)" : `: ${written.join(", ")}`}; checks passed\n`)
    return 0
  }
  writeTextIfChanged(join(context.dir, "package.json"), files.package)
  if (files.lock !== undefined) writeTextIfChanged(join(context.dir, "package-lock.json"), files.lock)
  if (changelogChanged) writeTextIfChanged(changelogFile, dated.text)
  if (written.length > 0) {
    const added = await context.git(["add", ...written], context.dir)
    if (added.code !== 0) throw new KitError("KIT_GIT", `git add failed: ${added.stderr.trim() || added.stdout.trim()}`, "commit the release files by hand, then tag")
    const committed = await context.git(["commit", "-m", `chore(release): prepare ${tag}`], context.dir)
    if (committed.code !== 0) throw new KitError("KIT_GIT", `git commit failed: ${committed.stderr.trim() || committed.stdout.trim()}`, "commit the release files by hand, then tag")
  }
  const tagged = await context.git(["tag", "-a", tag, "-m", tag], context.dir)
  if (tagged.code !== 0) throw new KitError("KIT_GIT", `git tag ${tag} failed: ${tagged.stderr.trim() || tagged.stdout.trim()}`, "delete an existing local tag only if it is yours, then run release again")
  const answer = { command: "release", ok: true, version, tag, dryRun: false, files: written, findings }
  if (context.json) context.io.stdout(`${JSON.stringify(answer, null, 2)}\n`)
  else {
    for (const finding of sortFindings(findings)) printFinding(context, finding)
    context.io.stdout(`release: ${tag} cut${written.length === 0 ? "" : ` after writing ${written.join(", ")}`}; push it to let CI publish the release: git push origin ${tag}\n`)
  }
  return 0
}
