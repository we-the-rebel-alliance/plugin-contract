import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, test } from "node:test"
import { runConformance } from "../src/conformance.ts"
import { FIXTURE_FILE, fixtureAliases, redactText, redactValue, runRecord } from "../src/kit/record.ts"
import type { CommandContext, ConformanceReport, ConformanceRunner } from "../src/kit/types.ts"
import { KitError } from "../src/kit/types.ts"

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const temp = (): { dir: string; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), "plugin-kit-record-"))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const context = (dir: string, runner: ConformanceRunner, json = false): CommandContext & { out: () => string; err: () => string } => {
  let out = ""
  let err = ""
  return {
    dir,
    json,
    io: { stdout: (text) => (out += text), stderr: (text) => (err += text) },
    conformance: async () => runner,
    git: async () => ({ code: 0, stdout: "", stderr: "" }),
    now: () => new Date("2026-11-24T00:00:00.000Z"),
    out: () => out,
    err: () => err,
  }
}

const okRunner = (report: ConformanceReport = { ok: true, findings: [] }): ConformanceRunner => ({
  async runConformance() {
    return report
  },
  async t0() {
    return []
  },
  async t1() {
    return []
  },
})

describe("redaction", () => {
  test("replaces a credential's whole string, and personal data in place", () => {
    const token = `gh${"p_"}${"A1b2C3d4E5f6G7h8"}`
    assert.equal(redactText(`token ${token}`), "<redacted:secret>")
    assert.equal(redactText("mail ana@example.com now"), "mail <redacted:email> now")
    assert.equal(redactText("call +33 6 12 34 56 78"), "call <redacted:phone>")
    assert.equal(redactText("read /home/ana/notes/today.md"), "read <redacted:home>")
    assert.equal(redactText("?token=abc123&page=2"), "?token=<redacted>&page=2")
    assert.equal(redactText("nothing personal"), "nothing personal")
    assert.equal(redactText("version 1.2.3, 2026-11-24"), "version 1.2.3, 2026-11-24")
    assert.equal(redactText("at 2026-11-24 12:30"), "at 2026-11-24 12:30")
    assert.equal(redactText("id 1234567890"), "id 1234567890")
    assert.equal(redactText("reach +14155550123"), "reach <redacted:phone>")
  })

  test("is idempotent: a placeholder carries no pattern", () => {
    const once = redactText("mail ana@example.com from /home/ana")
    assert.equal(redactText(once), once)
  })

  test("keys decide for a credential and for personal data, and order is preserved", () => {
    const value = {
      id: "keep",
      email: "ana@example.com",
      token: "anything",
      accessToken: "anything",
      sessionToken: "anything",
      botToken: "anything",
      displayName: "Ana",
      login: "ana",
      first_name: "Ana",
      name: "Ana",
      nested: { phone: "+33 6 12 34 56 78", safe: "hello", contact: "bo@example.com" },
      list: [{ note: "ana@example.com" }],
      count: 3,
    }
    const redacted = redactValue(value) as typeof value
    assert.deepEqual(Object.keys(redacted), Object.keys(value))
    assert.equal(redacted.id, "keep")
    assert.equal(redacted.email, "<redacted:personal>")
    assert.equal(redacted.token, "<redacted:secret>")
    assert.equal(redacted.accessToken, "<redacted:secret>")
    assert.equal(redacted.sessionToken, "<redacted:secret>")
    assert.equal(redacted.botToken, "<redacted:secret>")
    assert.equal(redacted.displayName, "<redacted:personal>")
    assert.equal(redacted.login, "<redacted:personal>")
    assert.equal(redacted.first_name, "<redacted:personal>")
    assert.equal(redacted.name, "<redacted:personal>")
    assert.equal(redacted.nested.phone, "<redacted:personal>")
    assert.equal(redacted.nested.safe, "hello")
    assert.equal(redacted.nested.contact, "<redacted:email>")
    assert.equal(redacted.list[0]?.note, "<redacted:email>")
    assert.equal(redacted.count, 3)
  })

  test("the status answer keeps its plugin name, and a phone value is redacted by its key", () => {
    const value = redactValue({ events: { status: { name: "acme" } }, phone: "020 7946 0018", profile: { name: "Ana" } }) as Record<string, any>
    assert.equal(value.events.status.name, "acme")
    assert.equal(value.phone, "<redacted:personal>")
    assert.equal(value.profile.name, "<redacted:personal>")
  })
})

describe("plugin-kit record", () => {
  const fixture = (aliases = ["work", "personal"]): Record<string, unknown> => ({
    plugin: "@we-the-rebel-alliance/fixture-plugin",
    accounts: { aliases },
    sources: { "fixture.messages": { cases: [{ input: { account: "work" }, answer: { account: "work" } }] } },
    grants: { cases: [{ name: "valid", token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl" }] },
    events: { status: { name: "fixture", version: "1.0.0", accounts: aliases.map((alias) => ({ alias, state: "ready" })) } },
  })

  test("writes and redacts exactly fixtures/conformance.json, keeping the accounts section", async () => {
    const local = temp()
    try {
      write(join(local.dir, FIXTURE_FILE), `${JSON.stringify(fixture(), null, 2)}\n`)
      const path = join(local.dir, FIXTURE_FILE)
      const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>
      value.sources["fixture.messages"].cases[0].answer.owner = { email: "ana@example.com", name: "Ana" }
      value.token = "ghp_aaaaaaaaaaaaaaaaaaaa"
      writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
      const run = context(local.dir, okRunner())
      assert.equal(await runRecord(run, { fixtures: undefined, check: false }), 0)
      const result = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>
      assert.deepEqual(fixtureAliases(result), ["work", "personal"])
      assert.equal(result.sources["fixture.messages"].cases[0].answer.owner.email, "<redacted:personal>")
      assert.equal(result.sources["fixture.messages"].cases[0].answer.owner.name, "<redacted:personal>")
      assert.equal(result.token, "<redacted:secret>")
      assert.equal(result.grants.cases[0].token, "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl")
      assert.match(run.out(), /fixtures\/conformance\.json written, redacted; conformance ok/)
    } finally {
      local.cleanup()
    }
  })

  test("--check reports an unredacted fixture without writing it", async () => {
    const local = temp()
    try {
      write(join(local.dir, FIXTURE_FILE), `${JSON.stringify({ ...fixture(), email: "ana@example.com" }, null, 2)}\n`)
      const run = context(local.dir, okRunner())
      assert.equal(await runRecord(run, { fixtures: undefined, check: true }), 1)
      assert.match(run.err(), /RECORD\.unredacted/)
      assert.match(readFileSync(join(local.dir, FIXTURE_FILE), "utf8"), /ana@example\.com/)
    } finally {
      local.cleanup()
    }
  })

  test("an unknown --account is a KitError, never a fallback", async () => {
    const local = temp()
    try {
      write(join(local.dir, FIXTURE_FILE), `${JSON.stringify(fixture(), null, 2)}\n`)
      await assert.rejects(runRecord(context(local.dir, okRunner()), { account: "nobody", fixtures: undefined, check: true }), (error: unknown) => error instanceof KitError && error.code === "KIT_ACCOUNT_UNKNOWN")
    } finally {
      local.cleanup()
    }
  })

  test("a missing fixture is a finding, not a directory walk", async () => {
    const local = temp()
    try {
      const run = context(local.dir, okRunner())
      assert.equal(await runRecord(run, { fixtures: undefined, check: true }), 1)
      assert.match(run.err(), /RECORD\.missing-file/)
    } finally {
      local.cleanup()
    }
  })

  test("runs end to end against #59's fixture plugin, with two aliases", { timeout: 60000 }, async () => {
    const root = mkdtempSync(join(process.cwd(), "test", ".tmp-record-"))
    const directory = join(root, "fixture-plugin")
    try {
      cpSync(join(process.cwd(), "test", "fixtures", "fixture-plugin"), directory, { recursive: true })
      const run = context(directory, { runConformance, t0: async () => [], t1: async () => [] })
      assert.equal(await runRecord(run, { account: "work", fixtures: undefined, check: false }), 0)
      const value = JSON.parse(readFileSync(join(directory, FIXTURE_FILE), "utf8")) as Record<string, unknown>
      assert.deepEqual(fixtureAliases(value), ["work", "personal"])
      assert.match(readFileSync(join(directory, FIXTURE_FILE), "utf8"), /<redacted:personal>/)
      const report = await runConformance(directory, { hosts: [] })
      assert.equal(report.ok, true, report.findings.map((finding) => finding.id).join(", "))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
