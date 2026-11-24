import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, test } from "node:test"
import { changelogFor, isReleaseVersion, releaseDate, runRelease, tagOf, versionedFiles } from "../src/kit/release.ts"
import { KitError } from "../src/kit/types.ts"
import type { CommandContext, ConformanceRunner, Git, GitResult } from "../src/kit/types.ts"
import { fakeConformance, finding } from "./support/kit.ts"
import { fullPlugin } from "./support/plugin.ts"

const context = (dir: string, options: { readonly runner?: ConformanceRunner; readonly git?: Git; readonly json?: boolean } = {}): CommandContext & { out: () => string; err: () => string; readonly calls: string[][] } => {
  let out = ""
  let err = ""
  const calls: string[][] = []
  const git: Git = options.git ?? (async (args) => {
    calls.push([...args])
    return { code: 0, stdout: "", stderr: "" }
  })
  return {
    dir,
    json: options.json ?? false,
    io: { stdout: (text) => (out += text), stderr: (text) => (err += text) },
    conformance: async () => options.runner ?? fakeConformance(),
    git,
    now: () => new Date("2026-11-24T12:34:56.000Z"),
    out: () => out,
    err: () => err,
    calls,
  }
}

describe("the release's changelog and version", () => {
  test("renames Unreleased, or adds a section after the title", () => {
    assert.equal(changelogFor("# Changelog\n\n## Unreleased\n\n- A change.\n", "0.1.0", "2026-11-24").text, "# Changelog\n\n## [0.1.0] - 2026-11-24\n\n- A change.\n")
    assert.equal(changelogFor("# Changelog\n\n## Unreleased\n", "0.1.0", "2026-11-24").text, "# Changelog\n\n## [0.1.0] - 2026-11-24\n\n- Release 0.1.0.\n")
    assert.equal(changelogFor("# Changelog\n\n## [0.1.0] - 2026-01-01\n\n- Old.\n", "0.1.0", "2026-11-24").changed, false)
    assert.match(changelogFor("# Changelog\n\n- Hand-written intro.\n", "0.1.0", "2026-11-24").text, /^# Changelog\n\n## \[0\.1\.0\] - 2026-11-24/)
    assert.match(changelogFor("No title here.\n", "0.1.0", "2026-11-24").text, /^## \[0\.1\.0\]/)
  })

  test("versions are semver tags, and the date is UTC", () => {
    assert.equal(isReleaseVersion("0.0.0"), true)
    assert.equal(isReleaseVersion("1.2.3-rc.1"), true)
    assert.equal(isReleaseVersion("v0.0.0"), false)
    assert.equal(tagOf("0.0.0"), "v0.0.0")
    assert.equal(releaseDate(new Date("2026-11-24T23:30:00.000Z")), "2026-11-24")
  })

  test("the package and lockfile carry the release version, and only changed files are named", () => {
    const local = mkdtempSync(join(tmpdir(), "plugin-kit-release-"))
    try {
      writeFileSync(join(local, "package.json"), `${JSON.stringify({ name: "acme", version: "0.0.0" }, null, 2)}\n`)
      writeFileSync(join(local, "package-lock.json"), `${JSON.stringify({ name: "acme", version: "0.0.0", lockfileVersion: 3, packages: { "": { name: "acme", version: "0.0.0" } } }, null, 2)}\n`)
      const files = versionedFiles(local, "0.1.0")
      assert.deepEqual(files.changed, ["package.json", "package-lock.json"])
      assert.equal((JSON.parse(files.package) as { version: string }).version, "0.1.0")
      assert.equal((JSON.parse(files.lock ?? "{}") as { packages: Record<string, { version: string }> }).packages[""]?.version, "0.1.0")
      assert.deepEqual(versionedFiles(local, "0.0.0").changed, [])
    } finally {
      rmSync(local, { recursive: true, force: true })
    }
  })
})

describe("plugin-kit release", () => {
  test("refuses a version that is not semver, before touching a file", async () => {
    const plugin = fullPlugin()
    try {
      await assert.rejects(runRelease(context(plugin.dir), "v0.0.0", { dryRun: false }), /KIT_VERSION: "v0\.0\.0" is not a release version\. Next step: /)
      assert.equal(existsSync(join(plugin.dir, "CHANGELOG.md")), true)
    } finally {
      plugin.cleanup()
    }
  })

  test("does not write or tag when a check fails", async () => {
    const plugin = fullPlugin()
    try {
      const run = context(plugin.dir, { runner: fakeConformance({ t0: [finding({ id: "T0.namespace-length" })] }) })
      assert.equal(await runRelease(run, "0.1.0", { dryRun: false }), 1)
      assert.deepEqual(run.calls, [])
      assert.match(readFileSync(join(plugin.dir, "CHANGELOG.md"), "utf8"), /Unreleased/)
      assert.match(readFileSync(join(plugin.dir, "package.json"), "utf8"), /"version": "0\.0\.0"/)
    } finally {
      plugin.cleanup()
    }
  })

  test("dry-run prints the plan and writes nothing", async () => {
    const plugin = fullPlugin()
    try {
      const run = context(plugin.dir)
      assert.equal(await runRelease(run, "0.1.0", { dryRun: true }), 0)
      assert.deepEqual(run.calls, [])
      assert.match(run.out(), /release: would prepare v0\.1\.0: CHANGELOG\.md, package\.json; checks passed/)
      assert.match(readFileSync(join(plugin.dir, "CHANGELOG.md"), "utf8"), /Unreleased/)
    } finally {
      plugin.cleanup()
    }
  })

  test("writes the version and changelog, then commits and tags", async () => {
    const plugin = fullPlugin()
    try {
      const run = context(plugin.dir)
      assert.equal(await runRelease(run, "0.1.0", { dryRun: false }), 0)
      assert.equal((JSON.parse(readFileSync(join(plugin.dir, "package.json"), "utf8")) as { version: string }).version, "0.1.0")
      assert.match(readFileSync(join(plugin.dir, "CHANGELOG.md"), "utf8"), /## \[0\.1\.0\] - 2026-11-24/)
      assert.deepEqual(run.calls, [
        ["add", "CHANGELOG.md", "package.json"],
        ["commit", "-m", "chore(release): prepare v0.1.0"],
        ["tag", "-a", "v0.1.0", "-m", "v0.1.0"],
      ])
      assert.match(run.out(), /release: v0\.1\.0 cut after writing CHANGELOG\.md, package\.json; push it to let CI publish the release: git push origin v0\.1\.0/)
    } finally {
      plugin.cleanup()
    }
  })

  test("a release with nothing to write still tags, without an empty commit", async () => {
    const plugin = fullPlugin()
    try {
      assert.equal(await runRelease(context(plugin.dir), "0.0.0", { dryRun: false }), 0)
      const run = context(plugin.dir)
      assert.equal(await runRelease(run, "0.0.0", { dryRun: false }), 0)
      assert.deepEqual(run.calls, [["tag", "-a", "v0.0.0", "-m", "v0.0.0"]])
    } finally {
      plugin.cleanup()
    }
  })

  test("a missing changelog and a failing git each name their next step", async () => {
    const plugin = fullPlugin()
    try {
      rmSync(join(plugin.dir, "CHANGELOG.md"))
      await assert.rejects(runRelease(context(plugin.dir), "0.1.0", { dryRun: false }), (error: unknown) => error instanceof KitError && error.code === "KIT_RELEASE")
    } finally {
      plugin.cleanup()
    }
    const second = fullPlugin()
    try {
      const git: Git = async (args): Promise<GitResult> => (args[0] === "tag" ? { code: 1, stdout: "", stderr: "tag exists" } : { code: 0, stdout: "", stderr: "" })
      await assert.rejects(runRelease(context(second.dir, { git }), "0.1.0", { dryRun: false }), /KIT_GIT: git tag v0\.1\.0 failed: tag exists\. Next step: /)
    } finally {
      second.cleanup()
    }
  })

  test("--json prints the tag and the files", async () => {
    const plugin = fullPlugin()
    try {
      const run = context(plugin.dir, { json: true })
      assert.equal(await runRelease(run, "0.1.0", { dryRun: true }), 0)
      const parsed = JSON.parse(run.out()) as { tag: string; files: string[]; dryRun: boolean }
      assert.deepEqual({ tag: parsed.tag, files: parsed.files, dryRun: parsed.dryRun }, { tag: "v0.1.0", files: ["CHANGELOG.md", "package.json"], dryRun: true })
    } finally {
      plugin.cleanup()
    }
  })
})
