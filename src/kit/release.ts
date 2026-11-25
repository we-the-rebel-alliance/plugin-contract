/**
 * `plugin-kit release <version>`: the guards and the local tag; CI publishes the GitHub release on the tag.
 *
 * A release is prepared in its pull request: the version in `package.json`, the lockfile and the changelog section.
 * This command checks that preparation, refuses anything but the 0.0.x line, refuses a tree that is not `master`, not
 * clean and not level with `origin/master`, and then creates the annotated tag locally. It never writes a release file,
 * never pushes and never publishes: the tag is the owner's to push, and CI cuts the GitHub release on it (plugin
 * standard §9).
 */
import { join } from "node:path"
import { checkPlugin } from "./check.ts"
import { readText } from "./files.ts"
import { readPlugin } from "./plugin.ts"
import { printFinding } from "./output.ts"
import type { CommandContext, Finding } from "./types.ts"
import { hasError, KitError, sortFindings } from "./types.ts"

/** The only version line this contract releases: v0.0.x, while the package is 0.x (contract §17). */
const VERSION = /^0\.0\.\d+$/

/** A version as a tag: `v0.0.0`. */
export const tagOf = (version: string): string => `v${version}`

/** Whether a version is one this contract releases: 0.0.x. */
export function isReleaseVersion(version: string): boolean {
  return VERSION.test(version)
}

/** The changelog section a release needs, with or without the link brackets. */
function hasChangelogSection(text: string, version: string): boolean {
  return new RegExp(`^## \\[?${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]?(?:\\s|$)`, "m").test(text)
}

/** The package version's preparation, as a finding rather than a write. */
function prepared(plugin: ReturnType<typeof readPlugin>, version: string): Finding[] {
  const findings: Finding[] = []
  if (plugin.package.version !== version) {
    findings.push({
      id: "KIT_RELEASE.version",
      level: "error",
      path: "package.json",
      message: `package.json is version ${JSON.stringify(plugin.package.version)}, not the release version ${version}`,
      fix: `Prepare the release in its pull request: set package.json and package-lock.json to ${version}, then run release again.`,
    })
  }
  const changelog = readText(join(plugin.dir, "CHANGELOG.md"))
  if (changelog === undefined) {
    findings.push({ id: "KIT_RELEASE.changelog", level: "error", path: "CHANGELOG.md", message: "CHANGELOG.md is missing", fix: `Add a "## [${version}]" section in the release pull request.` })
  } else if (!hasChangelogSection(changelog, version)) {
    findings.push({ id: "KIT_RELEASE.changelog", level: "error", path: "CHANGELOG.md", message: `CHANGELOG.md has no "## [${version}]" section`, fix: `Add the section in the release pull request; release never invents one.` })
  }
  return findings
}

/** One git answer, or a `KIT_GIT` error naming the command. */
async function git(context: CommandContext, args: readonly string[], what: string): Promise<string> {
  const answer = await context.git(args, context.dir)
  if (answer.code !== 0) throw new KitError("KIT_GIT", `${what} failed: ${answer.stderr.trim() || answer.stdout.trim() || `git ${args.join(" ")}`}`, "Resolve the repository state, then run release again.")
  return answer.stdout.trim()
}

/** The branch, tree and origin guards: the tag may only land on a clean, level master. */
async function guard(context: CommandContext): Promise<void> {
  const branch = await git(context, ["rev-parse", "--abbrev-ref", "HEAD"], "git rev-parse --abbrev-ref HEAD")
  if (branch !== "master") throw new KitError("KIT_RELEASE.branch", `the release runs on ${branch}, not master`, "Check out master and run release again; a tag on another branch is not a release.")
  const status = await git(context, ["status", "--porcelain"], "git status --porcelain")
  if (status !== "") throw new KitError("KIT_RELEASE.dirty", "the working tree has uncommitted changes", "Commit or stash them, then run release again.")
  const fetched = await context.git(["fetch", "--quiet", "origin", "master"], context.dir)
  if (fetched.code !== 0) throw new KitError("KIT_GIT", `git fetch origin master failed: ${fetched.stderr.trim() || fetched.stdout.trim()}`, "Check the remote, then run release again.")
  const head = await git(context, ["rev-parse", "HEAD"], "git rev-parse HEAD")
  const origin = await git(context, ["rev-parse", "origin/master"], "git rev-parse origin/master")
  if (head !== origin) throw new KitError("KIT_RELEASE.origin", "master is not level with origin/master", "Pull or push master so the two are equal, then run release again.")
}

/** `plugin-kit release <version>`: checks, guards, then one annotated local tag. */
export async function runRelease(context: CommandContext, version: string, options: { readonly dryRun: boolean }): Promise<number> {
  if (!isReleaseVersion(version)) {
    throw new KitError("KIT_VERSION", `"${version}" is not a release version`, "pass 0.0.x, such as 0.0.0 or 0.0.1; the contract releases only the 0.0 line")
  }
  // Read the package before the check: a package with no capabilities is not a plugin, so no gate applies to it.
  const plugin = readPlugin(context.dir)
  if (!Object.hasOwn(plugin.package, "capabilities")) {
    throw new KitError(
      "KIT_NOT_A_PLUGIN",
      `${plugin.name} has no capabilities, so it is not a plugin`,
      "run release from a plugin's root; this contract itself releases through scripts/release.mjs",
    )
  }
  const findings: Finding[] = [...(await checkPlugin(context))]
  findings.push(...prepared(plugin, version))
  if (hasError(findings)) {
    if (context.json) context.io.stdout(`${JSON.stringify({ command: "release", ok: false, version, tag: tagOf(version), findings: sortFindings(findings) }, null, 2)}\n`)
    else {
      for (const finding of sortFindings(findings)) printFinding(context, finding)
      context.io.stdout(`release: checks failed, so ${tagOf(version)} was not cut\n`)
    }
    return 1
  }
  await guard(context)
  const tag = tagOf(version)
  if (options.dryRun) {
    const answer = { command: "release", ok: true, version, tag, dryRun: true, findings }
    if (context.json) context.io.stdout(`${JSON.stringify(answer, null, 2)}\n`)
    else context.io.stdout(`release: would cut ${tag}; checks and guards passed, no tag written\n`)
    return 0
  }
  const tagged = await context.git(["tag", "-a", tag, "-m", tag], context.dir)
  if (tagged.code !== 0) throw new KitError("KIT_GIT", `git tag ${tag} failed: ${tagged.stderr.trim() || tagged.stdout.trim()}`, "Delete an existing local tag only if it is yours, then run release again.")
  const answer = { command: "release", ok: true, version, tag, dryRun: false, findings }
  if (context.json) context.io.stdout(`${JSON.stringify(answer, null, 2)}\n`)
  else {
    for (const finding of sortFindings(findings)) printFinding(context, finding)
    context.io.stdout(`release: ${tag} cut locally; push the tag yourself to let CI publish the GitHub release\n`)
  }
  return 0
}
