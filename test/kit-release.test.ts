import assert from "node:assert/strict"
import { execFile, execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, test } from "node:test"
import { isReleaseVersion, runRelease, tagOf } from "../src/kit/release.ts"
import type { CommandContext, ConformanceRunner, Git } from "../src/kit/types.ts"
import { fakeConformance } from "./support/kit.ts"
import { fullPlugin, write } from "./support/plugin.ts"

const realGit: Git = (args, directory) =>
  new Promise((done) => {
    execFile("git", [...args], { cwd: directory, encoding: "utf8" }, (error, stdout, stderr) => {
      done({ code: error === null ? 0 : 1, stdout: stdout ?? "", stderr: stderr ?? "" })
    })
  })

const run = (directory: string, args: readonly string[]): void => {
  execFileSync("git", [...args], { cwd: directory, stdio: "pipe" })
}

const temp = (): { dir: string; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), "plugin-kit-release-"))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

interface Repository {
  readonly plugin: ReturnType<typeof fullPlugin>
  readonly origin: { dir: string; cleanup: () => void }
  cleanup(): void
}

/** A plugin directory as a real git repository, committed on master and pushed to a bare origin. */
function repository(version = "0.0.0", options: { readonly changelog?: string } = {}): Repository {
  const plugin = fullPlugin()
  const pkg = JSON.parse(readFileSync(join(plugin.dir, "package.json"), "utf8")) as Record<string, unknown>
  pkg["version"] = version
  writeFileSync(join(plugin.dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`)
  write(join(plugin.dir, "CHANGELOG.md"), options.changelog ?? `# Changelog\n\n## [${version}] - 2026-11-24\n\n- Release ${version}.\n`)
  const origin = temp()
  run(origin.dir, ["init", "--bare", "-b", "master"])
  run(plugin.dir, ["init", "-b", "master"])
  run(plugin.dir, ["config", "user.email", "release@example.test"])
  run(plugin.dir, ["config", "user.name", "Release Test"])
  run(plugin.dir, ["add", "-A"])
  run(plugin.dir, ["commit", "-m", "initial"])
  run(plugin.dir, ["remote", "add", "origin", origin.dir])
  run(plugin.dir, ["push", "origin", "master"])
  return { plugin, origin, cleanup: () => { plugin.cleanup(); origin.cleanup() } }
}

const context = (dir: string, json = false): CommandContext & { out: () => string; err: () => string } => {
  let out = ""
  let err = ""
  const runner: ConformanceRunner = fakeConformance()
  return {
    dir,
    json,
    io: { stdout: (text) => (out += text), stderr: (text) => (err += text) },
    conformance: async () => runner,
    git: realGit,
    now: () => new Date("2026-11-24T12:34:56.000Z"),
    out: () => out,
    err: () => err,
  }
}

describe("the release's version line", () => {
  test("only 0.0.x is a release version", () => {
    assert.equal(isReleaseVersion("0.0.0"), true)
    assert.equal(isReleaseVersion("0.0.10"), true)
    assert.equal(isReleaseVersion("0.1.0"), false)
    assert.equal(isReleaseVersion("1.2.3"), false)
    assert.equal(isReleaseVersion("1.2.3-rc.1"), false)
    assert.equal(isReleaseVersion("v0.0.0"), false)
    assert.equal(tagOf("0.0.1"), "v0.0.1")
  })

  test("refuses a version outside 0.0.x before touching git", async () => {
    const local = temp()
    try {
      await assert.rejects(runRelease(context(local.dir), "1.2.3-rc.1", { dryRun: false }), /KIT_VERSION: "1\.2\.3-rc\.1" is not a release version\. Next step: /)
    } finally {
      local.cleanup()
    }
  })
})

describe("the release's preparation and git guards", () => {
  test("tags a clean, level master whose version and changelog are prepared, and pushes nothing", async () => {
    const repo = repository("0.0.0")
    try {
      const before = runGit(repo.plugin.dir, ["rev-parse", "HEAD"])
      const answer = context(repo.plugin.dir)
      assert.equal(await runRelease(answer, "0.0.0", { dryRun: false }), 0)
      assert.match(answer.out(), /release: v0\.0\.0 cut locally; push the tag yourself/)
      assert.equal(runGit(repo.plugin.dir, ["tag", "--list", "v0.0.0"]), "v0.0.0")
      assert.equal(runGit(repo.plugin.dir, ["rev-parse", "HEAD"]), before)
      // The tag is local: the bare origin has no tag and the same single commit.
      assert.equal(runGit(repo.origin.dir, ["tag", "--list"]), "")
      assert.equal(runGit(repo.origin.dir, ["rev-list", "--count", "master"]), "1")
      assert.equal(readFileSync(join(repo.plugin.dir, "CHANGELOG.md"), "utf8"), "# Changelog\n\n## [0.0.0] - 2026-11-24\n\n- Release 0.0.0.\n")
    } finally {
      repo.cleanup()
    }
  })

  test("dry-run writes no tag", async () => {
    const repo = repository("0.0.0")
    try {
      const answer = context(repo.plugin.dir)
      assert.equal(await runRelease(answer, "0.0.0", { dryRun: true }), 0)
      assert.match(answer.out(), /would cut v0\.0\.0; checks and guards passed, no tag written/)
      assert.equal(runGit(repo.plugin.dir, ["tag", "--list"]), "")
    } finally {
      repo.cleanup()
    }
  })

  test("refuses a branch other than master", async () => {
    const repo = repository("0.0.0")
    try {
      run(repo.plugin.dir, ["checkout", "-b", "feature"])
      await assert.rejects(runRelease(context(repo.plugin.dir), "0.0.0", { dryRun: false }), /KIT_RELEASE\.branch: the release runs on feature, not master\. Next step: /)
      assert.equal(runGit(repo.plugin.dir, ["tag", "--list"]), "")
    } finally {
      repo.cleanup()
    }
  })

  test("refuses a dirty tree", async () => {
    const repo = repository("0.0.0")
    try {
      write(join(repo.plugin.dir, "README.md"), `${readFileSync(join(repo.plugin.dir, "README.md"), "utf8")}\nchanged\n`)
      await assert.rejects(runRelease(context(repo.plugin.dir), "0.0.0", { dryRun: false }), /KIT_RELEASE\.dirty: the working tree has uncommitted changes\. Next step: /)
      assert.equal(runGit(repo.plugin.dir, ["tag", "--list"]), "")
    } finally {
      repo.cleanup()
    }
  })

  test("refuses master that is not level with origin/master", async () => {
    const repo = repository("0.0.0")
    try {
      write(join(repo.plugin.dir, "NOTES.md"), "local commit\n")
      run(repo.plugin.dir, ["add", "NOTES.md"])
      run(repo.plugin.dir, ["commit", "-m", "ahead"])
      await assert.rejects(runRelease(context(repo.plugin.dir), "0.0.0", { dryRun: false }), /KIT_RELEASE\.origin: master is not level with origin\/master\. Next step: /)
      assert.equal(runGit(repo.plugin.dir, ["tag", "--list"]), "")
    } finally {
      repo.cleanup()
    }
  })

  test("requires the release version in package.json and its changelog section", async () => {
    const repo = repository("0.0.0")
    try {
      const unprepared = context(repo.plugin.dir)
      assert.equal(await runRelease(unprepared, "0.0.1", { dryRun: false }), 1)
      assert.match(unprepared.err(), /KIT_RELEASE\.version/)
      assert.match(unprepared.err(), /KIT_RELEASE\.changelog/)
      assert.equal(runGit(repo.plugin.dir, ["tag", "--list"]), "")
    } finally {
      repo.cleanup()
    }
  })

  test("a missing changelog is a finding, not a section the kit invents", async () => {
    const repo = repository("0.0.0", { changelog: "# Changelog\n\n## Unreleased\n" })
    try {
      const answer = context(repo.plugin.dir)
      assert.equal(await runRelease(answer, "0.0.0", { dryRun: false }), 1)
      assert.match(answer.err(), /KIT_RELEASE\.changelog CHANGELOG\.md: CHANGELOG\.md has no "## \[0\.0\.0\]" section/)
      assert.match(readFileSync(join(repo.plugin.dir, "CHANGELOG.md"), "utf8"), /Unreleased/)
      assert.equal(runGit(repo.plugin.dir, ["tag", "--list"]), "")
    } finally {
      repo.cleanup()
    }
  })

  test("--json prints the tag and no files", async () => {
    const repo = repository("0.0.0")
    try {
      const answer = context(repo.plugin.dir, true)
      assert.equal(await runRelease(answer, "0.0.0", { dryRun: true }), 0)
      const parsed = JSON.parse(answer.out()) as { tag: string; dryRun: boolean; files?: unknown }
      assert.equal(parsed.tag, "v0.0.0")
      assert.equal(parsed.dryRun, true)
      assert.equal(parsed.files, undefined)
    } finally {
      repo.cleanup()
    }
  })
})

/** Run a real git command and return its trimmed stdout. */
function runGit(directory: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: directory, encoding: "utf8" }).trim()
}
