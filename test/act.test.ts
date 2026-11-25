import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { act, type ActHost, type ActRequest } from "../src/act.ts"
import { checkManifest } from "../src/manifest.ts"
import { evaluate, type ActGrant, type PermissionRule } from "../src/access.ts"
import { installed, manifest } from "./support/manifest.ts"

const confirm = {
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
        preview_note: { class: "read", plans: true, accounts: "none", operations: ["notes.read"] },
        save_note: { class: "write", commits: "preview_note", accounts: "none", operations: ["notes.create"] },
        preview_send: { class: "read", plans: true, accounts: "optional", operations: ["notes.read"] },
        send_note: { class: "send", commits: "preview_send", accounts: "none", operations: ["notes.create"] },
      }
      m.sources = [{ id: "demo.notes", kind: "snapshot", output: "list", method: "list_notes", cost: { class: "free" } }]
      m.actions = [
        {
          id: "demo.save",
          input: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
          output: { type: "object", properties: { saved: { type: "boolean" } }, required: ["saved"], additionalProperties: true },
          effect: "local",
          preview: "preview_note",
          commit: "save_note",
        },
        {
          id: "demo.notify",
          input: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
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

/** The fixture with its first preview method no longer declared `plans: true`: a manifest the plan flow refuses. */
const unplanned = (() => {
  const raw = structuredClone(value) as unknown as { methods: Record<string, Record<string, unknown>> }
  delete raw.methods["preview_note"]!["plans"]
  raw.methods["plan_other"] = { class: "read", plans: true, accounts: "none" }
  raw.methods["save_note"]!["commits"] = "plan_other"
  const checked = checkManifest(raw)
  assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("\n"))
  if (!checked.ok) throw new Error("fixture")
  return checked.value
})()

/** A register-minted plan id: 16 random bytes as base64url. */
const MINTED_SAVE = "Zx8kQ2mN4pR7sT1vW3yB5c"
const MINTED_SEND = "Lm3nP6qR9sT2vW5yB8cD1f"

/** Each method's answer: a plan (with the register's minted id) for a preview, the act's output for a commit. */
const answers: Readonly<Record<string, unknown>> = {
  preview_note: { ...confirm, planId: MINTED_SAVE, method: "save_note" },
  preview_send: { ...confirm, planId: MINTED_SEND, method: "send_note" },
  save_note: confirm,
  send_note: confirm,
}

interface RecordedCall {
  readonly method: string
  readonly input: Readonly<Record<string, unknown>>
  readonly grant?: string
  readonly consumer?: string
  readonly rules: readonly PermissionRule[]
}

/** A host that records each session and call, and answers each method with `reply`. */
function fakeHost(reply: (method: string) => unknown = (method) => answers[method]) {
  const sessions = new Map<string, readonly PermissionRule[]>()
  const calls: RecordedCall[] = []
  let closed = 0
  const host: ActHost = {
    async openSession({ rules }) {
      const sessionID = `ses_${sessions.size + 1}`
      sessions.set(sessionID, rules)
      return { sessionID, close: async () => void closed++ }
    },
    async status() {
      return { name: "demo", accounts: [{ alias: account }] }
    },
    async call({ method, sessionID, input, grant, consumer }) {
      calls.push({
        method,
        input,
        rules: sessions.get(sessionID)!,
        ...(grant === undefined ? {} : { grant }),
        ...(consumer === undefined ? {} : { consumer }),
      })
      return reply(method)
    },
  }
  return { host, calls, closed: () => closed }
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
  ...extra,
})

describe("act", () => {
  test("a preview calls the plan method and answers its planId", async () => {
    const fake = fakeHost()
    const outcome = await act(fake.host, requestFor("demo.notify", { phase: "preview", input: { text: "hello" } }))
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.failure.message)
    if (!outcome.ok || outcome.phase !== "preview") return
    assert.equal(outcome.preview.planId, MINTED_SEND, "the register minted the planId the preview answers")
    assert.equal(outcome.preview.method, "send_note")
    assert.equal(outcome.preview.cost && (outcome.preview.cost as { class: string }).class, "free")
    assert.deepEqual(outcome.preview.reaches, [{ id: "mailto:ada@example.com", label: "Ada" }])
    assert.equal(fake.calls.length, 1)
    const call = fake.calls[0]!
    assert.equal(call.method, "preview_send")
    assert.deepEqual(call.input, { text: "hello", account }, "a method declared accounts: optional gets the granted account")
    assert.equal(call.grant, undefined, "a preview carries no grant")
    assert.equal(evaluate(call.rules, "demo.preview_send"), "allow")
    assert.equal(evaluate(call.rules, "demo.send_note"), "deny", "a preview session cannot run the commit")
    assert.equal(evaluate(call.rules, "demo.read", `${account}:notes.read`), "allow", "the preview's operation is fenced")
    assert.equal(fake.closed(), 1)
  })

  test("a preview sends no account to a method declared accounts: none", async () => {
    const fake = fakeHost()
    const outcome = await act(fake.host, requestFor("demo.save", { phase: "preview", input: { text: "hello" } }))
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.failure.message)
    assert.equal(fake.calls.length, 1)
    assert.deepEqual(fake.calls[0]!.input, { text: "hello" })
    assert.equal(Object.hasOwn(fake.calls[0]!.input, "account"), false)
  })

  test("a preview refuses an input the act's schema does not describe, before any call", async () => {
    const fake = fakeHost()
    const outcome = await act(fake.host, requestFor("demo.save", { phase: "preview", input: { text: 7 } as never }))
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.failure.code, "SCHEMA_VIOLATION")
    assert.equal(fake.calls.length, 0)
  })

  test("a preview refuses a method that is not declared plans: true, before any call", async () => {
    const fake = fakeHost()
    const outcome = await act(fake.host, {
      ...requestFor("demo.save", { phase: "preview", input: { text: "hello" } }),
      installed: installed(unplanned),
      grant: { ...grantFor("demo.save"), manifestHash: installed(unplanned).hash },
    })
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.failure.code, "PLAN_INVALID")
    assert.match(outcome.failure.message, /plans: true/)
    assert.equal(fake.calls.length, 0)
  })

  test("a commit without a planId and a grant is refused before any call", async () => {
    for (const extra of [{}, { planId: MINTED_SAVE }, { grantToken: "host-signed" }]) {
      const fake = fakeHost()
      const outcome = await act(fake.host, requestFor("demo.save", extra))
      assert.equal(outcome.ok, false)
      if (outcome.ok) return
      assert.equal(outcome.failure.code, "PERMISSION_DENIED")
      assert.match(outcome.failure.message, /planId/)
      assert.match(outcome.failure.next, /Preview the act/)
      assert.match(outcome.failure.next, /host-signed/)
      assert.equal(fake.calls.length, 0, "a commit with no planId or grant calls nothing")
    }
  })

  test("a commit sends exactly { planId } and the grant, in the commit's own fence", async () => {
    const fake = fakeHost()
    const outcome = await act(fake.host, requestFor("demo.save", { planId: MINTED_SAVE, grantToken: "host-signed" }))
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.failure.message)
    if (!outcome.ok || outcome.phase !== "commit") return
    assert.equal(outcome.result.output && (outcome.result.output as { saved: boolean }).saved, true)
    assert.equal(fake.calls.length, 1)
    const call = fake.calls[0]!
    assert.equal(call.method, "save_note")
    assert.deepEqual(call.input, { planId: MINTED_SAVE }, "the commit input is exactly the minted planId")
    assert.equal(call.grant, "host-signed")
    assert.equal(call.consumer, "notes.home")
    assert.equal(evaluate(call.rules, "demo.save_note"), "allow", "the commit fence allows the commit method")
    assert.equal(evaluate(call.rules, "demo.preview_note"), "deny", "the commit fence denies the preview method")
    assert.equal(evaluate(call.rules, "demo.read", `${account}:notes.create`), "allow", "the commit's operation is fenced")
    assert.equal(fake.closed(), 1)
  })

  test("a commit that carries input is refused as SCHEMA_VIOLATION, before any call", async () => {
    const fake = fakeHost()
    const outcome = await act(fake.host, requestFor("demo.save", { planId: MINTED_SAVE, grantToken: "host-signed", input: { text: "hello" } }))
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.failure.code, "SCHEMA_VIOLATION")
    assert.equal(fake.calls.length, 0)
  })

  test("a preview answer without a planId is SCHEMA_VIOLATION", async () => {
    const fake = fakeHost(() => ({ ...confirm }))
    const outcome = await act(fake.host, requestFor("demo.save", { phase: "preview", input: { text: "hello" } }))
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.failure.code, "SCHEMA_VIOLATION")
    assert.match(outcome.failure.message, /no planId/)
  })

  test("a preview answer naming another committing method is SCHEMA_VIOLATION", async () => {
    const fake = fakeHost(() => ({ ...confirm, planId: MINTED_SEND, method: "preview_send" }))
    const outcome = await act(fake.host, requestFor("demo.notify", { phase: "preview", input: { text: "hello" } }))
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.failure.code, "SCHEMA_VIOLATION")
    assert.match(outcome.failure.message, /send_note does/)
  })

  test("refuses before any call when the act is turned off, or the grant is another consumer's, act's or manifest's", async () => {
    const cases: readonly { request: ActRequest; code: string }[] = [
      { request: requestFor("demo.save", { phase: "preview", grant: grantFor("demo.save", { disabled: true }) }), code: "SOURCE_DISABLED" },
      { request: requestFor("demo.save", { phase: "preview", grant: grantFor("demo.save", { consumer: "someone.else" }) }), code: "PERMISSION_DENIED" },
      { request: requestFor("demo.save", { phase: "preview", grant: grantFor("demo.notify") }), code: "PERMISSION_DENIED" },
      { request: requestFor("demo.save", { phase: "preview", grant: grantFor("demo.save", { manifestHash: "sha256:old" }) }), code: "PERMISSION_DENIED" },
    ]
    for (const { request, code } of cases) {
      const fake = fakeHost()
      const outcome = await act(fake.host, request)
      assert.equal(outcome.ok, false)
      if (outcome.ok) return
      assert.equal(outcome.failure.code, code)
      assert.equal(fake.calls.length, 0)
    }
  })

  test("a preview refuses an account the plugin's status does not declare, before any call", async () => {
    const fake = fakeHost()
    const outcome = await act(fake.host, requestFor("demo.save", { phase: "preview", input: { text: "hello" }, grant: grantFor("demo.save", { account: "nobody@example.com" }) }))
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.failure.code, "PERMISSION_DENIED")
    assert.match(outcome.failure.message, /not one this plugin declares/)
    assert.equal(fake.calls.length, 0)
  })
})
