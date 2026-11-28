// What each installed plugin may read and do for one person, and the grant behind each (issue #94). The report is
// evidence for an auditor: declarations and grant bindings only, never content, a credential or a token.
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { AUDIT_SCHEMA, auditReport, type ActGrantRecord, type AuditGrantRecord, type AuditReport, type ReadGrantRecord } from "../src/audit.ts"
import { checkManifest, type InstalledManifest } from "../src/manifest.ts"
import { installed, manifest } from "./support/manifest.ts"

const ANA = "ana@example.com"
const GRANTED_AT = "2026-11-28T09:00:00Z"
const OLD_HASH = `sha256:${"0".repeat(64)}`

const plugin = (change: (value: any) => void = () => {}): InstalledManifest => {
  const checked = checkManifest(manifest(change))
  assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("\n"))
  if (!checked.ok) throw new Error("the manifest fixture does not validate")
  return installed(checked.value)
}

const DEMO = plugin()
const HASH = DEMO.hash

const readGrant = (change: Partial<ReadGrantRecord> = {}): ReadGrantRecord => ({
  consumer: "notes",
  source: "demo.messages",
  account: "default",
  manifestHash: HASH,
  person: ANA,
  grantedAt: GRANTED_AT,
  ...change,
})

const actGrant = (change: Partial<ActGrantRecord> = {}): ActGrantRecord => ({
  consumer: "notes",
  action: "demo.messages.send",
  account: "default",
  manifestHash: HASH,
  person: ANA,
  grantedAt: GRANTED_AT,
  ...change,
})

const methodOf = (report: AuditReport, name: string) => report.plugins[0]!.methods.find((entry) => entry.method === name)!

describe("the audit report", () => {
  test("lists every method with the effect each access level gives it", () => {
    const all = auditReport({ person: ANA, plugins: [DEMO], access: { demo: "all" } })
    assert.equal(all.plugins[0]!.access, "all")
    assert.equal(methodOf(all, "status").class, "read")
    assert.equal(methodOf(all, "status").access, "runs")
    assert.equal(methodOf(all, "send_message").class, "send")
    assert.equal(methodOf(all, "send_message").access, "runs")
    assert.equal(methodOf(all, "send_message").effect, undefined)
    assert.ok(methodOf(all, "mcp:*"), "a pass-through MCP method is a method too")

    const ask = auditReport({ person: ANA, plugins: [DEMO], access: { demo: "ask-changes" } })
    assert.equal(ask.plugins[0]!.access, "ask-changes")
    assert.equal(methodOf(ask, "events_list").access, "runs")
    assert.equal(methodOf(ask, "send_message").access, "asks first")

    const readOnly = auditReport({ person: ANA, plugins: [DEMO], access: { demo: "read-only" } })
    assert.equal(readOnly.plugins[0]!.access, "read-only")
    assert.equal(methodOf(readOnly, "events_list").access, "runs")
    assert.equal(methodOf(readOnly, "send_message").access, "off")
  })

  test("a method's own deny stays off under all, and its declared effect is shown", () => {
    const denied = plugin((value) => {
      value.methods.send_message.effect = "deny"
    })
    const report = auditReport({ person: ANA, plugins: [denied], access: { demo: "all" } })
    assert.equal(methodOf(report, "send_message").effect, "deny")
    assert.equal(methodOf(report, "send_message").access, "off")
    assert.equal(methodOf(report, "events_list").access, "runs")
  })

  test("lists every source and action as declared", () => {
    const report = auditReport({ person: ANA, plugins: [DEMO] })
    const [messages, channels] = report.plugins[0]!.sources
    assert.equal(messages?.id, "demo.messages")
    assert.equal(messages?.method, "events_list")
    assert.deepEqual(messages?.operations, ["demo.messages.list", "demo.messages.get"])
    assert.equal(messages?.accounts, "optional")
    assert.equal(messages?.private, true)
    assert.deepEqual(messages?.cost, { class: "free" })
    assert.deepEqual(messages?.grants, [])
    assert.equal(channels?.id, "demo.channels")
    assert.equal(channels?.private, false)

    const action = report.plugins[0]!.actions[0]!
    assert.equal(action.id, "demo.messages.send")
    assert.equal(action.preview, "plan_send")
    assert.equal(action.commit, "send_message")
    assert.deepEqual(action.operations, ["demo.messages.create"])
    assert.equal(action.confirmation, "required")
    assert.deepEqual(action.grants, [])
  })

  test("puts each grant under its source or action, canonical, with stale and disabled marked", () => {
    const grants: AuditGrantRecord[] = [
      readGrant({ scope: { channels: ["C2", "C1", "C1"] } }),
      readGrant({ source: "demo.channels", manifestHash: OLD_HASH, disabled: true }),
      actGrant({ account: "work", disabled: true }),
    ]
    const report = auditReport({ person: ANA, plugins: [DEMO], grants })
    const sources = report.plugins[0]!.sources
    const messageGrant = sources.find((source) => source.id === "demo.messages")!.grants[0]!
    assert.deepEqual(messageGrant.scope, { channels: ["C1", "C2"] })
    assert.equal(messageGrant.disabled, false)
    assert.equal(messageGrant.stale, undefined)
    assert.equal(messageGrant.person, ANA)
    assert.equal(messageGrant.grantedAt, GRANTED_AT)
    assert.equal(messageGrant.consumer, "notes")
    assert.equal(messageGrant.manifestHash, HASH)

    const stale = sources.find((source) => source.id === "demo.channels")!.grants[0]!
    assert.equal(stale.stale, true)
    assert.equal(stale.disabled, true)

    const actionGrant = report.plugins[0]!.actions[0]!.grants[0]!
    assert.equal(actionGrant.disabled, true)
    assert.equal(actionGrant.account, "work")
  })

  test("keeps a grant for an unknown plugin, source or action in problems, with its binding", () => {
    const grants: AuditGrantRecord[] = [
      readGrant({ source: "other.messages", manifestHash: OLD_HASH }),
      readGrant({ source: "demo.unknown" }),
      actGrant({ action: "demo.messages.unknown" }),
    ]
    const report = auditReport({ person: ANA, plugins: [DEMO], grants })
    assert.equal(report.problems.length, 3)
    assert.match(report.problems[0]!.problem, /plugin "other" is not installed/)
    assert.match(report.problems[1]!.problem, /source "demo.unknown" is not declared/)
    assert.match(report.problems[2]!.problem, /action "demo.messages.unknown" is not declared/)
    assert.equal(report.problems[0]!.grant.manifestHash, OLD_HASH)
    assert.equal(report.problems[0]!.grant.consumer, "notes")
    assert.equal(report.problems[0]!.grant.stale, undefined, "an unknown plugin has no installed manifest to compare with")
    assert.equal(report.problems[1]!.grant.stale, undefined)
    assert.equal(report.problems[2]!.grant.person, ANA)
    assert.deepEqual(
      report.plugins[0]!.sources.map((source) => source.grants),
      [[], []],
    )
    assert.deepEqual(report.plugins[0]!.actions[0]!.grants, [])
  })

  test("lists every declaration for a person with no grants", () => {
    const report = auditReport({ person: ANA, plugins: [DEMO] })
    assert.deepEqual(report.problems, [])
    assert.equal(report.plugins[0]!.sources.length, 2)
    assert.equal(report.plugins[0]!.actions.length, 1)
    assert.ok(report.plugins[0]!.methods.length > 0)
    for (const source of report.plugins[0]!.sources) assert.deepEqual(source.grants, [])
    for (const action of report.plugins[0]!.actions) assert.deepEqual(action.grants, [])
  })

  test("validates against its own schema, which refuses a field the report does not define", () => {
    const report = auditReport({
      person: ANA,
      plugins: [{ ...DEMO, target: "@example/demo" }],
      access: { demo: "ask-changes" },
      grants: [readGrant()],
    })
    const checked = AUDIT_SCHEMA.check(report)
    assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("\n"))
    assert.equal(AUDIT_SCHEMA.name, "audit")
    const generated = AUDIT_SCHEMA.jsonSchema() as Record<string, any>
    assert.equal(generated["type"], "object")
    assert.equal(generated["additionalProperties"], false)
    assert.ok(generated["required"].includes("person"))
    assert.ok(generated["required"].includes("plugins"))
    assert.ok(generated["required"].includes("problems"))
    assert.equal(AUDIT_SCHEMA.check({ ...report, token: "a token the report never carries" }).ok, false)
  })
})
