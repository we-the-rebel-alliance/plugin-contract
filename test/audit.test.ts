import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { AUDIT_REPORT_SCHEMA, auditReport, renderAuditReport, type AuditGrantRecord } from "../src/audit.ts"
import { readInstalledManifest, type InstalledManifest } from "../src/manifest.ts"
import { installed, manifest } from "./support/manifest.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

/** One example's installed manifest. */
function example(name: string): InstalledManifest {
  const read = readInstalledManifest(join(root, "examples", name))
  assert.ok(read.ok, read.ok ? "" : read.problems.join("; "))
  return read.value
}

/** The access text a report gives one method. */
function accessOf(plugin: { methods: readonly { method: string; access: string }[] }, method: string): string | undefined {
  return plugin.methods.find((entry) => entry.method === method)?.access
}

describe("the audit report", () => {
  test("builds the three examples with fixed grants and renders the committed Markdown", () => {
    const integration = example("integration")
    const mcp = example("mcp")
    const tools = example("tools")
    const grants: AuditGrantRecord[] = [
      {
        consumer: "notes",
        source: "harbour.notes",
        account: "work",
        scope: { spaces: ["space-research"] },
        manifestHash: integration.hash,
        disabled: true,
        person: "Ana Silva",
        grantedAt: "2026-11-20T10:00:00.000Z",
      },
      {
        consumer: "digest",
        source: "trellis.messages",
        account: "personal",
        scope: { channels: ["C-RESEARCH"] },
        manifestHash: `sha256:${"0".repeat(64)}`,
        person: "Ana Silva",
        grantedAt: "2026-11-20T10:05:00.000Z",
      },
      {
        consumer: "notes",
        source: "ghost.messages",
        account: "work",
        scope: {},
        manifestHash: `sha256:${"1".repeat(64)}`,
        person: "Ana Silva",
        grantedAt: "2026-11-20T10:10:00.000Z",
      },
    ]
    const report = auditReport({
      person: "Ana Silva",
      installed: [integration, mcp, tools],
      options: {
        [integration.package]: { access: "read-only" },
        [mcp.package]: { access: "ask-changes" },
        [tools.package]: { access: "all" },
      },
      grants,
    })
    const checked = AUDIT_REPORT_SCHEMA.check(report)
    assert.ok(checked.ok, checked.ok ? "" : checked.problems.join("\n"))
    assert.equal(renderAuditReport(report), readFileSync(join(root, "test", "fixtures", "audit-report.md"), "utf8"))

    const glyph = report.plugins.find((plugin) => plugin.package === tools.package)
    assert.ok(glyph)
    assert.deepEqual(glyph.sources, [])
    assert.deepEqual(glyph.actions, [])
    assert.equal(accessOf(glyph, "word_count"), "runs")
    assert.equal(accessOf(glyph, "write_note"), "runs")
    assert.equal(report.problems.length, 1)
    assert.equal(report.problems[0]?.target, "ghost.messages")
    assert.match(report.problems[0]?.reason ?? "", /the plugin "ghost" is not installed/)
  })

  test("escapes a pipe and a newline in provider text, so a grant cannot break a table", () => {
    const entry = installed(manifest())
    const report = auditReport({
      person: "Ana\nSilva",
      installed: [entry],
      grants: [
        {
          consumer: "notes",
          source: "demo.messages",
          account: "ana@example.com",
          scope: { channels: ["team|one", "line\nbreak"] },
          manifestHash: entry.hash,
          person: "Ana\nSilva",
          grantedAt: "2026-11-20T10:00:00.000Z",
        },
      ],
    })
    const markdown = renderAuditReport(report)
    assert.match(markdown, /^# Audit report for Ana Silva$/m)
    assert.ok(markdown.includes("team\\|one"), "the pipe is escaped")
    assert.equal(markdown.includes("team|one"), false, "no raw pipe reaches the table")
    assert.ok(markdown.includes("line\\nbreak"), "the newline is JSON-escaped")
    const rows = markdown.split("\n").filter((line) => line.startsWith("| demo.messages |"))
    assert.equal(rows.length, 1)
    assert.match(rows[0] ?? "", /team\\\|one/)
  })

  test("the three access levels decide each method, and a declared deny stays off under all", () => {
    const entry = installed(
      manifest((value: any) => {
        value.methods["events_list"].effect = "ask"
        value.methods["delete_note"] = { class: "delete", accounts: "none", effect: "deny" }
      }),
    )
    const reportAt = (level: "all" | "ask-changes" | "read-only") => {
      const report = auditReport({ person: "Ana", installed: [entry], access: { [entry.package]: level } })
      return report.plugins[0]!
    }
    const all = reportAt("all")
    assert.equal(accessOf(all, "events_list"), "asks first", "a declared ask narrows all")
    assert.equal(accessOf(all, "send_message"), "runs")
    assert.equal(accessOf(all, "delete_note"), "off", "a declared deny stays off under all")
    assert.equal(all.methods.find((method) => method.method === "send_message")?.effect, undefined)
    assert.equal(all.methods.find((method) => method.method === "delete_note")?.effect, "deny")

    const ask = reportAt("ask-changes")
    assert.equal(accessOf(ask, "send_message"), "asks first")
    assert.equal(accessOf(ask, "events_list"), "asks first")
    const readOnly = reportAt("read-only")
    assert.equal(accessOf(readOnly, "send_message"), "off")
    assert.equal(accessOf(readOnly, "events_list"), "asks first")
  })

  test("lists every declaration with no grants, and marks a stale and a disabled grant", () => {
    const entry = installed(manifest())
    const empty = auditReport({ person: "Ana", installed: [entry] })
    const plugin = empty.plugins[0]!
    assert.equal(plugin.sources.length, 2)
    assert.equal(plugin.actions.length, 1)
    assert.ok(plugin.methods.length > 0)
    assert.deepEqual(plugin.sources.find((source) => source.id === "demo.messages")?.grants, [])
    assert.deepEqual(plugin.sources.find((source) => source.id === "demo.messages")?.accounts, [])
    assert.deepEqual(plugin.actions[0]?.grants, [])
    assert.equal(plugin.actions[0]?.confirmation, "required")
    assert.deepEqual(plugin.actions[0]?.operations, ["demo.messages.create"])

    const stale = `sha256:${"2".repeat(64)}`
    const report = auditReport({
      person: "Ana",
      installed: [entry],
      grants: [
        {
          consumer: "old",
          source: "demo.messages",
          account: "work",
          scope: { labels: ["B", "A"], channels: ["two", "one", "two"] },
          manifestHash: stale,
          person: "Ana",
          grantedAt: "2026-11-18T09:00:00.000Z",
        },
        {
          consumer: "off",
          source: "demo.messages",
          account: "work",
          scope: { channels: ["general"] },
          manifestHash: entry.hash,
          disabled: true,
          person: "Ana",
          grantedAt: "2026-11-19T09:00:00.000Z",
        },
      ],
    })
    const source = report.plugins[0]?.sources.find((held) => held.id === "demo.messages")
    assert.ok(source)
    assert.deepEqual(source.accounts, ["work"])
    assert.deepEqual(source.grants[0]?.scope, { channels: ["one", "two"], labels: ["A", "B"] })
    assert.equal(source.grants[0]?.stale, true)
    assert.equal(source.grants[0]?.disabled, false)
    assert.equal(source.grants[1]?.stale, false)
    assert.equal(source.grants[1]?.disabled, true)
  })

  test("renders one row for each grant under an action", () => {
    const entry = installed(manifest())
    const report = auditReport({
      person: "Ana",
      installed: [entry],
      grants: [
        { consumer: "notes", action: "demo.messages.send", account: "work", manifestHash: entry.hash, person: "Ana", grantedAt: "2026-11-20T10:00:00.000Z" },
        { consumer: "digest", action: "demo.messages.send", account: "personal", manifestHash: entry.hash, person: "Ana", grantedAt: "2026-11-20T10:05:00.000Z" },
      ],
    })
    const markdown = renderAuditReport(report)
    const rows = markdown.split("\n").filter((line) => line.startsWith("| demo.messages.send |"))
    assert.equal(rows.length, 2)
    assert.match(rows[0] ?? "", /notes on work/)
    assert.match(rows[1] ?? "", /digest on personal/)
  })

  test("puts a grant for an uninstalled plugin, an undeclared source and an undeclared action under problems", () => {
    const entry = installed(manifest())
    const report = auditReport({
      person: "Ana",
      installed: [entry],
      grants: [
        {
          consumer: "notes",
          source: "ghost.messages",
          account: "work",
          scope: {},
          manifestHash: entry.hash,
          person: "Ana",
          grantedAt: "2026-11-20T10:00:00.000Z",
        },
        {
          consumer: "notes",
          source: "demo.unknown",
          account: "work",
          scope: {},
          manifestHash: entry.hash,
          person: "Ana",
          grantedAt: "2026-11-20T10:01:00.000Z",
        },
        {
          consumer: "notes",
          action: "demo.messages.delete",
          account: "work",
          manifestHash: entry.hash,
          person: "Ana",
          grantedAt: "2026-11-20T10:02:00.000Z",
        },
      ],
    })
    assert.deepEqual(report.problems.map((problem) => [problem.kind, problem.target]), [
      ["read", "ghost.messages"],
      ["read", "demo.unknown"],
      ["act", "demo.messages.delete"],
    ])
    assert.match(report.problems[0]?.reason ?? "", /not installed/)
    assert.match(report.problems[1]?.reason ?? "", /not declared/)
    assert.match(report.problems[2]?.reason ?? "", /not declared/)
    assert.equal(report.plugins[0]?.sources.find((source) => source.id === "demo.messages")?.grants.length, 0)
    assert.equal(report.plugins[0]?.actions[0]?.grants.length, 0)
  })

  test("accepts a grant record that wraps the grant, and the catalogue's plugins key", () => {
    const entry = installed(manifest())
    const report = auditReport({
      person: "Ana",
      plugins: [entry],
      grants: [
        {
          grant: { consumer: "notes", source: "demo.messages", account: "work", manifestHash: entry.hash },
          person: "Ana",
          grantedAt: "2026-11-20T10:00:00.000Z",
        },
      ],
    })
    assert.equal(report.plugins[0]?.sources.find((source) => source.id === "demo.messages")?.grants[0]?.consumer, "notes")
  })
})
