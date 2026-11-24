import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, test } from "node:test"
import { main } from "../src/kit.ts"
import { fakeConformance, finding } from "./support/kit.ts"
import { fullPlugin, manifest, pluginDir, write } from "./support/plugin.ts"

interface Run {
  readonly code: number
  readonly out: string
  readonly err: string
}

const run = async (args: readonly string[], options: Parameters<typeof main>[1] = {}): Promise<Run> => {
  let out = ""
  let err = ""
  const code = await main(args, { stdout: (text) => (out += text), stderr: (text) => (err += text), ...options })
  return { code, out, err }
}

describe("plugin-kit's command line", () => {
  test("prints the commands for --help, and names the next step for a typo", async () => {
    const help = await run(["--help"])
    assert.equal(help.code, 0)
    for (const command of ["check", "docs", "record", "conformance", "hosts", "release", "supported", "forbidden"]) assert.match(help.out, new RegExp(command))
    const typo = await run(["chek"])
    assert.equal(typo.code, 2)
    assert.match(typo.err, /KIT_USAGE: "chek" is not a command\. Next step: /)
  })

  test("hosts prints [2.4.1], as text and as JSON", async () => {
    assert.deepEqual(await run(["hosts"]), { code: 0, out: "[2.4.1]\n", err: "" })
    const json = await run(["hosts", "--json"])
    assert.equal(json.code, 0)
    assert.deepEqual(JSON.parse(json.out), ["2.4.1"])
  })

  test("supported prints the SUPPORTED.md row for the manifest", async () => {
    const plugin = fullPlugin()
    try {
      const answer = await run(["supported", "--dir", plugin.dir])
      assert.equal(answer.code, 0)
      assert.equal(answer.out, "| acme | `acme-plugin` | — | acme.feed (events: message) | send | bus | 5 min | — | supported |\n")
      const json = await run(["supported", "--dir", plugin.dir, "--wave", "pilot", "--status", "planned", "--json"])
      assert.equal(json.code, 0)
      const parsed = JSON.parse(json.out) as { cells: string[]; row: string }
      assert.deepEqual(parsed.cells.slice(7), ["pilot", "planned"])
      assert.match(parsed.row, /\| pilot \| planned \|$/)
    } finally {
      plugin.cleanup()
    }
  })

  test("supported names an account mechanism, a snapshot source and every write class", async () => {
    const value = manifest({
      accounts: { via: "mcp", owner: "mailto" },
      options: {
        type: "object",
        properties: {
          access: { type: "string" },
          accounts: { type: "object", additionalProperties: { type: "object", properties: { email: { type: "string" } } } },
        },
      },
      methods: {
        status: { class: "read", accounts: "none" },
        probe: { class: "read", accounts: "optional" },
        events_list: { class: "read", accounts: "optional" },
        plan: { class: "read", plans: true, accounts: "optional" },
        send: { class: "send", accounts: "optional" },
        delete_item: { class: "delete", accounts: "optional" },
        share_item: { class: "share", accounts: "optional" },
      },
      sources: [
        { id: "acme.feed", kind: "events", reads: "message", method: "events_list", signals: ["bus", "webhook"], cadence: { suggestMinutes: 10 }, cost: { class: "free" } },
        { id: "acme.inbox", kind: "snapshot", output: "x-acme/inbox", method: "status", cost: { class: "free" } },
      ],
    })
    const plugin = pluginDir("acme", value)
    try {
      const answer = await run(["supported", "--dir", plugin.dir, "--json"])
      assert.equal(answer.code, 0)
      const parsed = JSON.parse(answer.out) as { cells: string[] }
      assert.equal(parsed.cells[2], "mcp")
      assert.equal(parsed.cells[3], "acme.feed (events: message), acme.inbox (snapshot: x-acme/inbox)")
      assert.equal(parsed.cells[4], "send, share, delete")
      assert.equal(parsed.cells[5], "bus, webhook")
      assert.equal(parsed.cells[6], "10 min")
    } finally {
      plugin.cleanup()
    }
  })

  test("supported reads the accounts column from the manifest, not a fixed multi → multi", async () => {
    const { accountsCell } = await import("../src/kit/supported.ts")
    assert.equal(accountsCell(manifest()), "—")
    assert.equal(
      accountsCell(manifest({ accounts: { via: "integration", owner: "mailto", profile: { $ref: "#/options/properties/accounts/additionalProperties" } } })),
      "integration (profile per alias)",
    )
    assert.equal(accountsCell(manifest({ accounts: { via: "mcp", owner: "slack" } })), "mcp")
    assert.equal(accountsCell(manifest({ accounts: { via: "local", owner: "machine" } })), "local")
  })

  test("check runs T0 once and T1 on every tested host the manifest names", async () => {
    const plugin = fullPlugin()
    try {
      const runner = fakeConformance({ t0: [finding({ id: "T0.pinned", level: "warning", message: "no pinned method" })] })
      const answer = await run(["check", "--dir", plugin.dir], { conformance: async () => runner })
      assert.equal(answer.code, 0)
      assert.deepEqual(runner.calls.t0, [plugin.dir])
      assert.deepEqual(runner.calls.t1, [{ dir: plugin.dir, host: "2.4.1" }])
      assert.match(answer.out, /check: ok \(0 errors, 1 warning\)/)
    } finally {
      plugin.cleanup()
    }
  })

  test("check fails on an error, and --host replaces the manifest's matrix", async () => {
    const plugin = fullPlugin()
    try {
      const runner = fakeConformance({ t0: [finding({ id: "T0.namespace-length", message: "the namespace line is 401 characters" })] })
      const answer = await run(["check", "--dir", plugin.dir, "--host", "2.4.0"], { conformance: async () => runner })
      assert.equal(answer.code, 1)
      assert.deepEqual(runner.calls.t1, [{ dir: plugin.dir, host: "2.4.0" }])
      assert.match(answer.err, /ERROR T0\.namespace-length/)
    } finally {
      plugin.cleanup()
    }
  })

  test("check fails when a conformance gate throws, instead of skipping it", async () => {
    const plugin = fullPlugin()
    try {
      const runner = fakeConformance()
      runner.t1 = async () => {
        throw new Error("no host available")
      }
      const answer = await run(["check", "--dir", plugin.dir], { conformance: async () => runner })
      assert.equal(answer.code, 1)
      assert.match(answer.err, /KIT_CONFORMANCE: T1 2\.4\.1 did not run: no host available/)
    } finally {
      plugin.cleanup()
    }
  })

  test("check finds stale docs and a forbidden pattern", async () => {
    const plugin = fullPlugin()
    try {
      const changed = manifest({ methods: { ...manifest().methods, delete_item: { class: "delete" } } })
      write(join(plugin.dir, "package.json"), `${JSON.stringify({ name: "@we-the-rebel-alliance/acme-plugin", version: "0.0.0", capabilities: changed }, null, 2)}\n`)
      write(join(plugin.dir, "README.md"), `${readFileSync(join(plugin.dir, "README.md"), "utf8")}\nSee https://github.com/we-the-rebel-alliance/acme-plugin/blob/main/docs/guide.md\n`)
      const runner = fakeConformance()
      const answer = await run(["check", "--dir", plugin.dir], { conformance: async () => runner })
      assert.equal(answer.code, 1)
      assert.match(answer.err, /DOCS\.stale/)
      assert.match(answer.err, /FORBIDDEN\.main-branch/)
    } finally {
      plugin.cleanup()
    }
  })

  test("docs --check reports drift, docs writes it, and a missing marker fails", async () => {
    const plugin = fullPlugin()
    try {
      const current = await run(["docs", "--check", "--dir", plugin.dir])
      assert.equal(current.code, 0)
      assert.match(current.out, /docs: current/)
      const changed = manifest({ methods: { ...manifest().methods, delete_item: { class: "delete" } } })
      write(join(plugin.dir, "package.json"), `${JSON.stringify({ name: "@we-the-rebel-alliance/acme-plugin", version: "0.0.0", capabilities: changed }, null, 2)}\n`)
      const drift = await run(["docs", "--check", "--dir", plugin.dir])
      assert.equal(drift.code, 1)
      assert.match(drift.err, /DOCS\.stale/)
      const written = await run(["docs", "--dir", plugin.dir])
      assert.equal(written.code, 0)
      assert.match(written.out, /docs: 2 files updated/)
      assert.equal((await run(["docs", "--check", "--dir", plugin.dir])).code, 0)
      write(join(plugin.dir, "docs", "capabilities.md"), "# capabilities\n\nNo markers here.\n")
      const missing = await run(["docs", "--check", "--dir", plugin.dir])
      assert.equal(missing.code, 1)
      assert.match(missing.err, /DOCS\.missing-marker/)
    } finally {
      plugin.cleanup()
    }
  })

  test("conformance passes hosts and record through to the runner, and prints its report", async () => {
    const plugin = fullPlugin()
    try {
      const runner = fakeConformance({ report: { ok: false, findings: [finding({ id: "T1.host", message: "the plugin refused" })] } })
      const answer = await run(["conformance", "--dir", plugin.dir, "--host", "2.4.1", "--record", "--json"], { conformance: async () => runner })
      assert.equal(answer.code, 1)
      assert.deepEqual(runner.calls.run, [{ dir: plugin.dir, options: { hosts: ["2.4.1"], record: true } }])
      assert.equal((JSON.parse(answer.out) as { ok: boolean }).ok, false)
    } finally {
      plugin.cleanup()
    }
  })

  test("conformance without hosts lets the runner choose, and record is omitted when not asked", async () => {
    const plugin = fullPlugin()
    try {
      const runner = fakeConformance()
      const answer = await run(["conformance", "--dir", plugin.dir], { conformance: async () => runner })
      assert.equal(answer.code, 0)
      assert.deepEqual(runner.calls.run, [{ dir: plugin.dir, options: {} }])
      assert.match(answer.out, /conformance: ok \(0 findings\)/)
    } finally {
      plugin.cleanup()
    }
  })

  test("forbidden reports an app name, a main link and a secret with stable ids", async () => {
    const plugin = fullPlugin()
    try {
      const app = (await import("../src/kit/forbidden-apps.ts")).FORBIDDEN_APPS[0]!.name
      const token = `gh${"p_"}${"A1b2C3d4E5f6G7h8"}`
      write(join(plugin.dir, "docs", "guide.md"), `# Guide\n\n${app} reads this.\nhttps://github.com/we-the-rebel-alliance/acme-plugin/tree/main/docs\nSet GH_TOKEN=${token}\n`)
      const answer = await run(["forbidden", "--dir", plugin.dir])
      assert.equal(answer.code, 1)
      assert.match(answer.err, /FORBIDDEN\.app-name/)
      assert.match(answer.err, /FORBIDDEN\.main-branch/)
      assert.match(answer.err, /FORBIDDEN\.secret/)
    } finally {
      plugin.cleanup()
    }
  })

  test("an x-<app> key is allowed: the prefix is the one place a name belongs", async () => {
    const plugin = fullPlugin()
    try {
      const app = (await import("../src/kit/forbidden-apps.ts")).FORBIDDEN_APPS[0]!.name.toLowerCase()
      write(join(plugin.dir, "docs", "hint.md"), `# Hint\n\n\`x-${app}\` is an app-only key.\n`)
      const answer = await run(["forbidden", "--dir", plugin.dir])
      assert.equal(answer.code, 0, answer.err)
    } finally {
      plugin.cleanup()
    }
  })

  test("--json prints a KitError as one JSON object on stdout, not a plain line", async () => {
    const missing = await run(["supported", "--dir", "/nonexistent/plugin", "--json"])
    assert.equal(missing.code, 1)
    assert.equal(missing.err, "")
    const parsed = JSON.parse(missing.out) as { ok: boolean; error: { code: string; message: string; next: string } }
    assert.deepEqual({ ok: parsed.ok, code: parsed.error.code, hasNext: parsed.error.next.length > 0 }, { ok: false, code: "KIT_NOT_A_PLUGIN", hasNext: true })
    const version = await run(["release", "1.2.3", "--json"])
    assert.equal(version.code, 1)
    assert.equal(version.err, "")
    assert.equal((JSON.parse(version.out) as { error: { code: string } }).error.code, "KIT_VERSION")
    const usage = await run(["chek", "--json"])
    assert.equal(usage.code, 2)
    assert.equal(usage.err, "")
    assert.equal((JSON.parse(usage.out) as { error: { code: string } }).error.code, "KIT_USAGE")
  })

  test("a plugin without a manifest answers docs with a manifest finding, not a crash", async () => {
    const plugin = pluginDir()
    try {
      write(join(plugin.dir, "package.json"), `${JSON.stringify({ name: "acme-plugin", version: "0.0.0" })}\n`)
      const answer = await run(["docs", "--check", "--dir", plugin.dir])
      assert.equal(answer.code, 1)
      assert.match(answer.err, /DOCS\.manifest/)
    } finally {
      plugin.cleanup()
    }
  })
})

describe("the plugin-kit package entry", () => {
  test("has a bin, a ./kit export, and an executable shim that loads dist/", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { bin: Record<string, string>; exports: Record<string, unknown>; files: string[] }
    assert.deepEqual(pkg.bin, { "plugin-kit": "./bin/plugin-kit.js" })
    assert.deepEqual(pkg.exports["./kit"], { types: "./dist/kit.d.ts", default: "./dist/kit.js" })
    assert.ok(pkg.files.includes("bin"))
    const bin = new URL("../bin/plugin-kit.js", import.meta.url).pathname
    assert.match(readFileSync(bin, "utf8"), /from "\.\.\/dist\/kit\.js"/)
    assert.notEqual(statSync(bin).mode & 0o111, 0, "bin/plugin-kit.js is executable")
    assert.equal(execFileSync(process.execPath, [bin, "hosts"], { encoding: "utf8" }), "[2.4.1]\n")
  })
})
