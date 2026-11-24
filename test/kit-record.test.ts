import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, test } from "node:test"
import { redactDirectory, redactText, redactValue, runRecord } from "../src/kit/record.ts"
import type { CommandContext, ConformanceReport, ConformanceRunner } from "../src/kit/types.ts"

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

const runnerThatWrites = (file: string, report: ConformanceReport = { ok: true, findings: [] }): ConformanceRunner => ({
  async runConformance() {
    write(file, JSON.stringify({ account: "ana@example.com", owner: { token: "ghp_aaaaaaaaaaaaaaaaaaaa" }, text: "call +33 6 12 34 56 78", home: "/home/ana/notes" }))
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
    // A timestamp and a plain account id are not phone numbers.
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

  test("a directory is checked without a write, and rewritten with one", () => {
    const local = temp()
    try {
      const file = join(local.dir, "default.json")
      write(file, JSON.stringify({ email: "ana@example.com" }, null, 2) + "\n")
      const check = redactDirectory(local.dir, { write: false })
      assert.deepEqual(check.findings.map((finding) => finding.id), ["RECORD.unredacted"])
      assert.match(readFileSync(file, "utf8"), /ana@example\.com/)
      const written = redactDirectory(local.dir, { write: true })
      assert.deepEqual(written.findings, [])
      assert.equal(written.files[0]?.changed, true)
      assert.doesNotMatch(readFileSync(file, "utf8"), /ana@example\.com/)
      assert.equal(redactDirectory(local.dir, { write: true }).files[0]?.changed, false)
    } finally {
      local.cleanup()
    }
  })

  test("invalid JSON and a missing directory are findings, not crashes", () => {
    const local = temp()
    try {
      write(join(local.dir, "bad.json"), "{")
      assert.deepEqual(redactDirectory(local.dir, { write: false }).findings.map((finding) => finding.id), ["RECORD.invalid-json"])
      assert.deepEqual(redactDirectory(join(local.dir, "missing"), { write: false }).findings.map((finding) => finding.id), ["RECORD.missing-directory"])
    } finally {
      local.cleanup()
    }
  })
})

describe("plugin-kit record", () => {
  test("runs the recorder, redacts a fixture, and fails a check that still finds one", async () => {
    const local = temp()
    try {
      const file = join(local.dir, "test", "conformance", "default.json")
      const runner = runnerThatWrites(file)
      const recorded = context(local.dir, runner)
      assert.equal(await runRecord(recorded, { fixtures: undefined, check: false }), 0)
      assert.match(recorded.out(), /record: 1 fixture under test\/conformance, 1 redacted; conformance ok/)
      assert.doesNotMatch(readFileSync(file, "utf8"), /ana@example\.com|ghp_/)
      assert.equal(await runRecord(context(local.dir, runner), { fixtures: undefined, check: true }), 0)
      write(file, JSON.stringify({ email: "ana@example.com" }))
      const check = context(local.dir, runner)
      assert.equal(await runRecord(check, { fixtures: undefined, check: true }), 1)
      assert.match(check.err(), /RECORD\.unredacted/)
    } finally {
      local.cleanup()
    }
  })

  test("--account narrows to that account's directory when the recorder writes one per alias", async () => {
    const local = temp()
    try {
      const work = join(local.dir, "test", "conformance", "work", "feed.json")
      const personal = join(local.dir, "test", "conformance", "personal", "feed.json")
      write(work, JSON.stringify({ email: "work@example.com" }))
      write(personal, JSON.stringify({ email: "personal@example.com" }))
      const runner: ConformanceRunner = { runConformance: async () => ({ ok: true, findings: [] }), t0: async () => [], t1: async () => [] }
      assert.equal(await runRecord(context(local.dir, runner), { account: "work", fixtures: undefined, check: false }), 0)
      assert.doesNotMatch(readFileSync(work, "utf8"), /work@example\.com/)
      assert.match(readFileSync(personal, "utf8"), /personal@example\.com/)
    } finally {
      local.cleanup()
    }
  })

  test("a failed conformance report is reported and fails, after the fixtures are redacted", async () => {
    const local = temp()
    try {
      const file = join(local.dir, "test", "conformance", "default.json")
      const runner = runnerThatWrites(file, { ok: false, findings: [{ id: "T1.host", level: "error", message: "the plugin refused" }] })
      const run = context(local.dir, runner)
      assert.equal(await runRecord(run, { fixtures: undefined, check: false }), 1)
      assert.match(run.err(), /T1\.host/)
      assert.doesNotMatch(readFileSync(file, "utf8"), /ana@example\.com/)
    } finally {
      local.cleanup()
    }
  })

  test("a default fixture directory the recorder did not create is a finding", async () => {
    const local = temp()
    try {
      const runner: ConformanceRunner = { runConformance: async () => ({ ok: true, findings: [] }), t0: async () => [], t1: async () => [] }
      const run = context(local.dir, runner)
      assert.equal(await runRecord(run, { fixtures: undefined, check: false }), 1)
      assert.match(run.err(), /RECORD\.missing-directory/)
    } finally {
      local.cleanup()
    }
  })
})
