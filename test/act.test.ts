import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, describe, test } from "node:test"
import { act, type ActHost, type ActRequest } from "../src/act.ts"
import { readInstalledDescriptor, type InstalledDescriptor } from "../src/descriptor.ts"
import { evaluate, type ActGrant, type PermissionRule } from "../src/permission.ts"

const scratch = mkdtempSync(join(tmpdir(), "act-test-"))
after(() => rmSync(scratch, { recursive: true, force: true }))

const answer = {
  trust: "untrusted",
  output: { saved: true },
  reaches: [{ id: "mailto:ada@example.com", label: "Ada" }],
  changes: ["Saves a note"],
  cost: { class: "free" },
}

const directory = join(scratch, "demo")
mkdirSync(directory, { recursive: true })
writeFileSync(
  join(directory, "package.json"),
  JSON.stringify({
    name: "@example/demo",
    version: "1.0.0",
    sources: {
      contractVersion: 1,
      items: [
        {
          id: "demo.notes",
          kind: "snapshot",
          tool: "list_notes",
          output: "list",
          permission: { tool: "demo.list_notes", operations: ["notes.list"] },
          cost: { class: "free" },
        },
      ],
      acts: [
        {
          id: "demo.save",
          input: { type: "object", additionalProperties: true },
          output: { type: "object", properties: { saved: { type: "boolean" } }, required: ["saved"], additionalProperties: true },
          effect: "local",
          preview: "preview_note",
          commit: "save_note",
          permission: { preview: "demo.preview_note", commit: "demo.save_note", operations: ["notes.create"] },
        },
        {
          id: "demo.notify",
          input: { type: "object", additionalProperties: true },
          output: { type: "object", properties: { saved: { type: "boolean" } }, required: ["saved"], additionalProperties: true },
          effect: "notify",
          preview: "preview_send",
          commit: "send_note",
          permission: { preview: "demo.preview_send", commit: "demo.send_note", operations: ["notes.create"] },
        },
      ],
    },
  }),
)

const installed: InstalledDescriptor = (() => {
  const checked = readInstalledDescriptor(directory)
  assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("\n"))
  if (!checked.ok) throw new Error("fixture")
  return checked.value
})()

const account = "ada@example.com"

/** A host that records each session and answers from `reply`. `issued` is the confirmation check, when the host has one. */
function fakeHost(issued?: (token: string) => boolean) {
  const sessions = new Map<string, readonly PermissionRule[]>()
  const calls: { method: string; rules: readonly PermissionRule[] }[] = []
  const host: ActHost = {
    async openSession({ rules }) {
      const sessionID = `ses_${sessions.size + 1}`
      sessions.set(sessionID, rules)
      return { sessionID, close: async () => undefined }
    },
    async call({ method, sessionID }) {
      calls.push({ method, rules: sessions.get(sessionID)! })
      return answer
    },
    ...(issued === undefined ? {} : { issuedConfirmation: async ({ token }) => issued(token) }),
  }
  return { host, calls }
}

const grantFor = (actId: string, extra: Partial<ActGrant> = {}): ActGrant => ({
  consumer: "jelly.home",
  act: actId,
  account,
  descriptorHash: installed.hash,
  ...extra,
})

const requestFor = (actId: string, extra: Partial<ActRequest> = {}): ActRequest => ({
  installed,
  act: actId,
  grant: grantFor(actId),
  consumer: "jelly.home",
  phase: "commit",
  input: { text: "hello" },
  ...extra,
})

describe("act", () => {
  test("a local commit is allowed through the gate with no confirmation", async () => {
    const fake = fakeHost()
    const outcome = await act(fake.host, requestFor("demo.save"))
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.failure.message)
    if (!outcome.ok || outcome.phase !== "commit") return
    assert.equal(outcome.result.output && (outcome.result.output as { saved: boolean }).saved, true)
    assert.equal(fake.calls.length, 1)
    assert.equal(fake.calls[0]?.method, "save_note")
    assert.equal(evaluate(fake.calls[0]!.rules, "demo.save_note"), "allow")
    assert.equal(evaluate(fake.calls[0]!.rules, "demo.preview_note"), "deny")
  })

  test("a non-local commit without a confirmation is refused, and no tool is called", async () => {
    const fake = fakeHost()
    const outcome = await act(fake.host, requestFor("demo.notify"))
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.failure.code, "PERMISSION_DENIED")
    assert.match(outcome.failure.message, /confirmation the host issued/)
    assert.equal(fake.calls.length, 0)
  })

  test("a token is not a confirmation when the host has no issuer", async () => {
    const fake = fakeHost()
    const outcome = await act(fake.host, requestFor("demo.notify", { confirmation: "made-up" }))
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.failure.code, "PERMISSION_DENIED")
    assert.match(outcome.failure.message, /no confirmation issuer/)
    assert.equal(fake.calls.length, 0)
  })

  test("a confirmed non-local commit is allowed through the gate", async () => {
    const fake = fakeHost((token) => token === "issued-by-host")
    const refused = await act(fake.host, requestFor("demo.notify", { confirmation: "not-this-one" }))
    assert.equal(refused.ok, false)
    assert.equal(fake.calls.length, 0)
    const outcome = await act(fake.host, requestFor("demo.notify", { confirmation: "issued-by-host" }))
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.failure.message)
    if (!outcome.ok) return
    assert.equal(fake.calls.length, 1)
    assert.equal(fake.calls[0]?.method, "send_note")
    assert.equal(evaluate(fake.calls[0]!.rules, "demo.send_note"), "allow")
    assert.equal(evaluate(fake.calls[0]!.rules, "demo.preview_send"), "deny")
    assert.deepEqual(outcome.phase === "commit" ? outcome.result.reaches : undefined, [{ id: "mailto:ada@example.com", label: "Ada" }])
    assert.deepEqual(outcome.phase === "commit" ? outcome.result.changes : undefined, ["Saves a note"])
  })

  test("a preview of a non-local act needs no confirmation, and its session cannot commit", async () => {
    const fake = fakeHost()
    const outcome = await act(fake.host, requestFor("demo.notify", { phase: "preview" }))
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.failure.message)
    if (!outcome.ok || outcome.phase !== "preview") return
    assert.equal(fake.calls[0]?.method, "preview_send")
    assert.equal(evaluate(fake.calls[0]!.rules, "demo.preview_send"), "allow")
    assert.equal(evaluate(fake.calls[0]!.rules, "demo.send_note"), "deny")
    assert.equal(outcome.preview.cost && (outcome.preview.cost as { class: string }).class, "free")
  })

  test("refuses before any call when the descriptor changed since consent", async () => {
    const fake = fakeHost()
    const outcome = await act(fake.host, requestFor("demo.save", { grant: grantFor("demo.save", { descriptorHash: "sha256:old" }) }))
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.failure.code, "PERMISSION_DENIED")
    assert.equal(fake.calls.length, 0)
  })
})
