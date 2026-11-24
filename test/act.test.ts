import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { act, type ActHost, type ActRequest } from "../src/act.ts"
import { checkManifest } from "../src/manifest.ts"
import { evaluate, type ActGrant, type PermissionRule } from "../src/permission.ts"
import { installed, manifest } from "./support/manifest.ts"

const answer = {
  trust: "untrusted",
  output: { saved: true },
  reaches: [{ id: "mailto:ada@example.com", label: "Ada" }],
  changes: ["Saves a note"],
  cost: { class: "free" },
}

const value = (() => {
  const checked = checkManifest(
    manifest((m) => {
      m.plugin.name = "demo"
      m.methods = {
        status: { class: "read", accounts: "none" },
        probe: { class: "read", accounts: "optional" },
        list_notes: { class: "read", accounts: "none", operations: ["notes.list"] },
        preview_note: { class: "read", accounts: "none", operations: ["notes.read"] },
        save_note: { class: "write", accounts: "none", operations: ["notes.create"] },
        preview_send: { class: "read", accounts: "none", operations: ["notes.read"] },
        send_note: { class: "send", accounts: "none", operations: ["notes.create"] },
      }
      m.sources = [{ id: "demo.notes", kind: "snapshot", output: "list", method: "list_notes", cost: { class: "free" } }]
      m.actions = [
        {
          id: "demo.save",
          input: { type: "object", additionalProperties: true },
          output: { type: "object", properties: { saved: { type: "boolean" } }, required: ["saved"], additionalProperties: true },
          effect: "local",
          preview: "preview_note",
          commit: "save_note",
        },
        {
          id: "demo.notify",
          input: { type: "object", additionalProperties: true },
          output: { type: "object", properties: { saved: { type: "boolean" } }, required: ["saved"], additionalProperties: true },
          effect: "notify",
          preview: "preview_send",
          commit: "send_note",
        },
      ]
    }),
  )
  assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("\n"))
  if (!checked.ok) throw new Error("fixture")
  return checked.value
})()

const demo = installed(value)
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

const grantFor = (actionId: string, extra: Partial<ActGrant> = {}): ActGrant => ({
  consumer: "notes.home",
  action: actionId,
  account,
  manifestHash: demo.hash,
  ...extra,
})

const requestFor = (actionId: string, extra: Partial<ActRequest> = {}): ActRequest => ({
  installed: demo,
  action: actionId,
  grant: grantFor(actionId),
  consumer: "notes.home",
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

  test("a preview of a non-local action needs no confirmation, and its session cannot commit", async () => {
    const fake = fakeHost()
    const outcome = await act(fake.host, requestFor("demo.notify", { phase: "preview" }))
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.failure.message)
    if (!outcome.ok || outcome.phase !== "preview") return
    assert.equal(fake.calls[0]?.method, "preview_send")
    assert.equal(evaluate(fake.calls[0]!.rules, "demo.preview_send"), "allow")
    assert.equal(evaluate(fake.calls[0]!.rules, "demo.send_note"), "deny")
    assert.equal(outcome.preview.cost && (outcome.preview.cost as { class: string }).class, "free")
  })

  test("refuses before any call when the manifest changed since consent", async () => {
    const fake = fakeHost()
    const outcome = await act(fake.host, requestFor("demo.save", { grant: grantFor("demo.save", { manifestHash: "sha256:old" }) }))
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.failure.code, "PERMISSION_DENIED")
    assert.equal(fake.calls.length, 0)
  })
})
