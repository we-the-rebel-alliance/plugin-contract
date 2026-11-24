import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { accountProblem, DENY_ALL, detailRules, evaluate, grantCovers, namespaceOf, operationRule, probeRules, serverOf, sessionRules, type Grant } from "../src/permission.ts"
import type { Checked } from "../src/index.ts"
import { checkManifest, type Manifest } from "../src/manifest.ts"
import { manifest } from "./support/manifest.ts"

const problemsIn = (checked: Checked<unknown>): readonly string[] => (checked.ok ? [] : checked.problems)
const ana = "ana@example.com"

const value = (change: (m: any) => void): Manifest => {
  const checked = checkManifest(manifest(change))
  assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("\n"))
  if (!checked.ok) throw new Error("fixture")
  return checked.value
}

const demo = value((m) => {})
const [messages, channels] = demo.sources as [Manifest["sources"][number], Manifest["sources"][number]]

const rulesOf = (checked: ReturnType<typeof sessionRules>) => {
  assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("\n"))
  return checked.ok ? checked.value : []
}

describe("sessionRules", () => {
  test("deny everything, allow the method on *, and each operation on <account>:<operation>", () => {
    assert.deepEqual(rulesOf(sessionRules(messages, { source: "demo.messages", account: ana })), [
      DENY_ALL,
      { action: "demo.events_list", resource: "*", effect: "allow" },
      { action: "demo.read", resource: `${ana}:demo.messages.list`, effect: "allow" },
      { action: "demo.read", resource: `${ana}:demo.messages.get`, effect: "allow" },
    ])
    assert.deepEqual(rulesOf(sessionRules(channels, { source: "demo.channels", account: ana })), [
      DENY_ALL,
      { action: "demo.list_channels", resource: "*", effect: "allow" },
      { action: "demo.read", resource: `${ana}:demo.channels.list`, effect: "allow" },
    ])
  })

  test("derive each operation's rule as the conformance kit does", () => {
    assert.deepEqual(operationRule(messages, "demo.messages.get", ana), { action: "demo.read", resource: `${ana}:demo.messages.get`, effect: "allow" })
    assert.deepEqual(operationRule({ id: "slack.workspace" }, "slack_read_channel", "T0123"), { action: "slack-T0123_slack_read_channel", resource: "*", effect: "allow" })
    assert.equal(namespaceOf(messages), "demo")
  })

  test("fence a session exactly: what is declared runs, nothing else does, and no other account", () => {
    const rules = rulesOf(sessionRules(messages, { source: "demo.messages", account: ana }))
    const session = [{ action: "*", resource: "*", effect: "allow" as const }, ...rules]
    assert.equal(evaluate(session, "demo.events_list"), "allow")
    assert.equal(evaluate(session, "demo.read", `${ana}:demo.messages.get`), "allow")
    assert.equal(evaluate(session, "demo.read", "ben@example.com:demo.messages.get"), "deny")
    assert.equal(evaluate(session, "demo.read", `${ana}:demo.messages.delete`), "deny")
    assert.equal(evaluate(session, "demo.send_message", "*"), "deny")
    assert.equal(evaluate(session, "bash", "*"), "deny")
  })

  test("refuse an account that would widen a rule, and a grant for another source", () => {
    for (const account of ["*", "ana*", "a?a", "ana:evil", "ana b", "", "x".repeat(321)]) {
      assert.equal(sessionRules(messages, { source: "demo.messages", account }).ok, false, account)
      assert.ok(accountProblem(account))
    }
    assert.equal(accountProblem(ana), undefined)
    assert.equal(sessionRules(messages, { source: "demo.channels", account: ana }).ok, false)
  })

  test("a grant for work uses work's MCP server and cannot reach the default alias's tools", () => {
    const recordings = value((m) => {
      m.sources = [{ id: "demo.recordings", kind: "events", reads: "meeting", method: "events_list", operations: ["list_files"], cost: { class: "free" } }]
    }).sources[0]!
    assert.equal(serverOf("demo", "default"), "demo")
    assert.equal(serverOf("demo", "work"), "demo-work")
    const work = rulesOf(sessionRules(recordings, { source: "demo.recordings", account: "work" }))
    assert.deepEqual(work, [
      DENY_ALL,
      { action: "demo.events_list", resource: "*", effect: "allow" },
      { action: "demo-work_list_files", resource: "*", effect: "allow" },
    ])
    assert.equal(evaluate(work, "demo-work_list_files"), "allow")
    assert.equal(evaluate(work, "demo_list_files"), "deny")
    const fallback = rulesOf(sessionRules(recordings, { source: "demo.recordings", account: "default" }))
    assert.deepEqual(fallback, [
      DENY_ALL,
      { action: "demo.events_list", resource: "*", effect: "allow" },
      { action: "demo_list_files", resource: "*", effect: "allow" },
    ])
    assert.equal(evaluate(fallback, "demo_list_files"), "allow")
    assert.equal(evaluate(fallback, "demo-work_list_files"), "deny")
  })

  test("refuse a declared operation with a wildcard, and a source whose method is not declared", () => {
    const loose = { ...demo, sources: [{ ...messages, operations: [...(messages.operations ?? []), "demo.*"] }] } as Manifest
    assert.match(problemsIn(sessionRules(loose.sources[0]!, { source: "demo.messages", account: ana }))[0]!, /wildcard/)

  })
})

describe("detail and probe rules", () => {
  test("a detail read runs under its declared method's rules", () => {
    const rules = detailRules(messages, "demo.messages.thread", { source: "demo.messages", account: ana })
    assert.deepEqual(rulesOf(rules), [
      DENY_ALL,
      { action: "demo.events_list", resource: "*", effect: "allow" },
      { action: "demo.read", resource: `${ana}:demo.messages.list`, effect: "allow" },
      { action: "demo.read", resource: `${ana}:demo.messages.get`, effect: "allow" },
      { action: "demo.events_detail", resource: "*", effect: "allow" },
    ])
    assert.equal(detailRules(messages, "demo.nothing", { source: "demo.messages", account: ana }).ok, false)
  })

  test("a probe is fenced to the probe action and its identity operations", () => {
    const rules = probeRules(messages, ana, ["demo.users.get"], "demo.probe")
    assert.ok(rules.ok)
    if (!rules.ok) return
    assert.equal(evaluate(rules.value, "demo.probe"), "allow")
    assert.equal(evaluate(rules.value, "demo.read", `${ana}:demo.users.get`), "allow")
    assert.equal(evaluate(rules.value, "demo.read", `${ana}:demo.users.delete`), "deny")
    assert.equal(probeRules(messages, "*", [], "demo.probe").ok, false)
  })
})

describe("grantCovers", () => {
  const grant: Grant = { consumer: "notes", source: "demo.messages", account: "T0123", scope: { channels: ["C01", "C02"] }, manifestHash: "sha256:x" }

  test("covers the same source and account within the granted scope only", () => {
    assert.equal(grantCovers(grant, { source: "demo.messages", account: "T0123", scope: { channels: ["C01"] } }), true)
    assert.equal(grantCovers(grant, { source: "demo.messages", account: "T0123" }), true)
    assert.equal(grantCovers(grant, { source: "demo.messages", account: "T0123", scope: { channels: ["C01", "C03"] } }), false)
    assert.equal(grantCovers(grant, { source: "demo.messages", account: "T9999", scope: { channels: ["C01"] } }), false)
    assert.equal(grantCovers(grant, { source: "demo.channels", account: "T0123" }), false)
    assert.equal(grantCovers(grant, { source: "demo.messages", account: "T0123", scope: { labels: ["INBOX"] } }), false)
  })
})
