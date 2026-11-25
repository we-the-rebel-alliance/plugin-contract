import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, test } from "node:test"
import { eventHash, makeEvent } from "../src/events.ts"
import { runConformance } from "../src/conformance.ts"
import { FIXTURE_FILE, fixtureAliases, redactFixture, redactText, redactValue, runRecord } from "../src/kit/record.ts"
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
      assert.equal(await runRecord(run, { check: false }), 0)
      const result = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>
      assert.deepEqual(fixtureAliases(result), ["work", "personal"])
      assert.equal(result.sources["fixture.messages"].cases[0].answer.owner.email, "<redacted:personal>")
      assert.equal(result.sources["fixture.messages"].cases[0].answer.owner.name, "<redacted:personal>")
      assert.equal(result.token, "<redacted:secret>")
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
      assert.equal(await runRecord(run, { check: true }), 1)
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
      await assert.rejects(runRecord(context(local.dir, okRunner()), { account: "nobody", check: true }), (error: unknown) => error instanceof KitError && error.code === "KIT_ACCOUNT_UNKNOWN")
    } finally {
      local.cleanup()
    }
  })

  test("a runtime where the real host cannot run records the fixture and warns", async () => {
    const local = temp()
    try {
      write(join(local.dir, FIXTURE_FILE), `${JSON.stringify({ ...fixture(), email: "ana@example.com" }, null, 2)}
`)
      const gate = { ok: false, findings: [{ id: "T1.host-unavailable", level: "error" as const, message: "T1 needs Node 24 or Bun" }] }
      const run = context(local.dir, okRunner(gate))
      assert.equal(await runRecord(run, { check: false }), 0)
      assert.match(run.err(), /RECORD\.host-unavailable/)
      assert.doesNotMatch(readFileSync(join(local.dir, FIXTURE_FILE), "utf8"), /ana@example\.com/)
    } finally {
      local.cleanup()
    }
  })

  test("a missing fixture is a finding, not a directory walk", async () => {
    const local = temp()
    try {
      const run = context(local.dir, okRunner())
      assert.equal(await runRecord(run, { check: true }), 1)
      assert.match(run.err(), /RECORD\.missing-file/)
    } finally {
      local.cleanup()
    }
  })

  test("redaction rehashes only events it changed, and leaves valid events untouched", () => {
    const valid = makeEvent({ source: "acme", account: "default", external_id: "plain", kind: "message", occurred_at: "2026-11-01T00:00:00.000Z", actors: [{ role: "from", id: "acme:u1" }] })
    const untouched = redactFixture({ events: [valid] }, { display: FIXTURE_FILE })
    assert.deepEqual(untouched.value, { events: [valid] })
    assert.deepEqual(untouched.findings, [])

    const changed = makeEvent({ source: "acme", account: "default", external_id: "redacted", kind: "message", occurred_at: "2026-11-01T00:00:00.000Z", actors: [{ role: "from", id: "acme:u1", name: "Ana" }], title: "mail ana@example.com" })
    const redacted = redactFixture({ events: [changed] }, { display: FIXTURE_FILE })
    const event = (redacted.value as { events: Record<string, any>[] }).events[0]!
    assert.equal(event.hash, eventHash(event as never))
    assert.notEqual(event.hash, changed.hash)
    assert.deepEqual(redacted.findings, [])

    const wrong = { ...valid, hash: "sha256:not-the-content-hash" }
    const reported = redactFixture({ events: [wrong] }, { display: FIXTURE_FILE })
    assert.ok(reported.findings.some((finding) => finding.id === "RECORD.hash-mismatch" && finding.message.includes("plain")))
    assert.equal((reported.value as { events: Record<string, any>[] }).events[0]!.hash, "sha256:not-the-content-hash")

    const wrongAndRedacted = { ...changed, hash: "sha256:not-the-content-hash" }
    const repaired = redactFixture({ events: [wrongAndRedacted] }, { display: FIXTURE_FILE })
    assert.ok(repaired.findings.some((finding) => finding.id === "RECORD.hash-mismatch" && finding.message.includes("redacted")))
    const repairedEvent = (repaired.value as { events: Record<string, any>[] }).events[0]!
    assert.equal(repairedEvent.hash, eventHash(repairedEvent as never))
    assert.notEqual(repairedEvent.hash, "sha256:not-the-content-hash")
  })

  test("grants keep only the verified token and public key, and redact the other fields", () => {
    const source = JSON.parse(readFileSync(join(process.cwd(), "test", "fixtures", "fixture-plugin", "fixtures", "conformance.json"), "utf8")) as Record<string, any>
    const valid = source.grants.cases[0].token as string
    const bad = `gh${"p_"}${"A1b2C3d4E5f6G7h8"}`
    source.grants.cases[1].token = bad
    source.grants.cases[1].request.password = bad
    const redacted = redactFixture(source, { display: FIXTURE_FILE, publicKey: source.grants.publicKey, verifiedTokens: new Set([valid]) })
    const value = redacted.value as Record<string, any>
    assert.equal(value.grants.publicKey, source.grants.publicKey)
    assert.equal(value.grants.cases[0].token, valid)
    assert.equal(value.grants.cases[0].name, source.grants.cases[0].name)
    assert.equal(value.grants.cases[0].input.to, source.grants.cases[0].input.to)
    assert.equal(value.grants.cases[1].name, "<redacted:personal>")
    assert.equal(value.grants.cases[1].input.to, "<redacted:email>")
    assert.equal(value.grants.cases[1].token, "<redacted:secret>")
    assert.equal(value.grants.cases[1].request.password, "<redacted:secret>")
  })

  test("runs end to end against #59's fixture plugin, with two aliases", { timeout: 60000 }, async () => {
    const root = mkdtempSync(join(process.cwd(), "test", ".tmp-record-"))
    const directory = join(root, "fixture-plugin")
    try {
      cpSync(join(process.cwd(), "test", "fixtures", "fixture-plugin"), directory, { recursive: true })
      const run = context(directory, { runConformance, t0: async () => [], t1: async () => [] })
      assert.equal(await runRecord(run, { account: "work", check: false }), 0)
      const value = JSON.parse(readFileSync(join(directory, FIXTURE_FILE), "utf8")) as Record<string, unknown>
      assert.deepEqual(fixtureAliases(value), ["work", "personal"])
      assert.match(readFileSync(join(directory, FIXTURE_FILE), "utf8"), /<redacted:personal>/)
      const redacted = JSON.parse(readFileSync(join(directory, FIXTURE_FILE), "utf8")) as Record<string, any>
      assert.deepEqual(redacted.accounts.aliases, ["work", "personal"])
      assert.match(redacted.grants.cases[0].token, /^eyJ/)
      assert.equal(redacted.grants.cases[0].name, "valid")
      assert.equal(redacted.grants.cases[0].input.to, "person@example.test")
      const report = await runConformance(directory)
      const errors = report.findings.filter((finding) => finding.level === "error" && finding.id !== "T1.host-unavailable")
      assert.deepEqual(errors, [])
      assert.equal(report.findings.filter((finding) => finding.id !== "T1.host-unavailable").length, 0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
