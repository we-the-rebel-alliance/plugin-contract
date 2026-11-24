import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, test } from "node:test"
import {
  accessLevel,
  applyAccess,
  DENY_ALL,
  detailRules,
  evaluate,
  grantCovers,
  methodAction,
  namespaceOf,
  operationRule,
  probeRules,
  rulesFor,
  serverOf,
  sessionRules,
  unguardedAgents,
  withRules,
  type AccessContext,
  type AgentLike,
  type Grant,
  type PermissionRule,
} from "../src/access.ts"
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

describe("the access levels", () => {
  test("default all, and only the three levels are accepted", () => {
    assert.deepEqual(accessLevel({}), { ok: true, value: "all" })
    assert.deepEqual(accessLevel({ access: "read-only" }), { ok: true, value: "read-only" })
    for (const bad of ["", "read", "ALL", 7, null]) assert.equal(accessLevel({ access: bad }).ok, false, String(bad))
  })

  test("all runs every class; ask-changes asks for a change; read-only turns a change off", () => {
    const all = rulesFor(demo, "all")
    assert.deepEqual(all.find((rule) => rule.action === "demo.events_list"), { action: "demo.events_list", resource: "*", effect: "allow" })
    assert.deepEqual(all.find((rule) => rule.action === "demo.send_message"), { action: "demo.send_message", resource: "*", effect: "allow" })

    const ask = rulesFor(demo, "ask-changes")
    assert.equal(ask.find((rule) => rule.action === "demo.events_list")?.effect, "allow")
    assert.equal(ask.find((rule) => rule.action === "demo.send_message")?.effect, "ask")

    const readOnly = rulesFor(demo, "read-only")
    assert.equal(readOnly.find((rule) => rule.action === "demo.events_list")?.effect, "allow")
    assert.equal(readOnly.find((rule) => rule.action === "demo.send_message")?.effect, "deny")
  })

  test("a method's effect only narrows: ask forces an ask, deny turns it off, and there is no allow", () => {
    const own = value((m) => {
      m.methods["send_message"].effect = "deny"
      m.methods["events_list"].effect = "ask"
      m.methods["delete_note"] = { class: "delete", accounts: "none", effect: "ask" }
    })
    const all = rulesFor(own, "all")
    assert.equal(all.find((rule) => rule.action === "demo.send_message")?.effect, "deny")
    assert.equal(all.find((rule) => rule.action === "demo.events_list")?.effect, "ask")
    assert.equal(all.find((rule) => rule.action === "demo.delete_note")?.effect, "ask")
    const readOnly = rulesFor(own, "read-only")
    assert.equal(readOnly.find((rule) => rule.action === "demo.delete_note")?.effect, "deny", "read-only is stricter than ask")
    const invalid = checkManifest(manifest((m: any) => {
      m.methods["delete_note"] = { class: "delete", accounts: "none", effect: "allow" }
    }))
    assert.equal(invalid.ok, false)
    if (!invalid.ok) assert.ok(invalid.problems.some((problem) => /effect/.test(problem)))
  })

  test("wildcard rules come before specific ones, whatever the manifest key order", () => {
    const order = (wildcardFirst: boolean): Manifest => value((m) => {
      const rest = { ...m.methods }
      delete rest["mcp:*"]
      const wildcard = { "mcp:*": { class: "read" } }
      const specific = { "mcp:send_message": { class: "send" } }
      m.methods = wildcardFirst ? { ...wildcard, ...specific, ...rest } : { ...rest, ...specific, ...wildcard }
    })
    for (const level of ["all", "ask-changes", "read-only"] as const) {
      for (const mcpFirst of [true, false]) {
        const rules = rulesFor(order(mcpFirst), level, ["default", "work"])
        const expected = level === "all" ? "allow" : level === "ask-changes" ? "ask" : "deny"
        assert.equal(evaluate(rules, "demo_send_message"), expected, `${level} mcpFirst=${mcpFirst} default`)
        assert.equal(evaluate(rules, "demo-work_send_message"), expected, `${level} mcpFirst=${mcpFirst} work`)
        assert.equal(evaluate(rules, "demo_read_file"), "allow", `${level} mcpFirst=${mcpFirst} wildcard read`)
        assert.equal(evaluate(rules, "demo-work_read_file"), "allow", `${level} mcpFirst=${mcpFirst} work wildcard read`)
        // The specific send rule is after the wildcard read rule, so it decides.
        const wildcard = rules.findIndex((rule) => rule.action === "demo_*")
        const specific = rules.findIndex((rule) => rule.action === "demo_send_message")
        assert.ok(wildcard < specific, `${level} mcpFirst=${mcpFirst}`)
      }
    }
  })

  test("a pass-through MCP method has one rule per alias, and a rule for work cannot reach another alias", () => {
    const rules = rulesFor(demo, "read-only", ["default", "work"])
    assert.deepEqual(rules.find((rule) => rule.action === "demo-work_*"), { action: "demo-work_*", resource: "*", effect: "allow" })
    assert.deepEqual(rules.find((rule) => rule.action === "demo_*"), { action: "demo_*", resource: "*", effect: "allow" })
    assert.equal(evaluate(rules, "demo-work_list_files"), "allow")
    assert.equal(evaluate(rules, "demo_list_files"), "allow")
    const workOnly = rulesFor(demo, "read-only", ["work"])
    assert.equal(evaluate(workOnly, "demo-work_list_files"), "allow")
    assert.equal(evaluate(workOnly, "demo_list_files"), "ask")
  })

  test("the per-alias server derivation refuses an alias the plugin does not declare", () => {
    assert.deepEqual(serverOf("demo", "work", ["default", "work"]), { ok: true, value: "demo-work" })
    assert.deepEqual(serverOf("demo", "default", ["default", "work"]), { ok: true, value: "demo" })
    assert.equal(serverOf("demo", "personal", ["default", "work"]).ok, false)
    assert.equal(serverOf("demo", "*", ["default", "work"]).ok, false)
    assert.equal(serverOf("demo", "Work", ["default", "work"]).ok, false)
    assert.equal(serverOf("demo", "work_2", ["default", "work"]).ok, false)
  })
})

describe("generating access into agents", () => {
  const agents = (): AgentLike[] => [
    { id: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }, { action: "read", resource: "*.env", effect: "ask" }] },
    { id: "plan", permissions: [{ action: "*", resource: "*", effect: "allow" }, { action: "edit", resource: "*", effect: "deny" }] },
  ]

  const context = (list: AgentLike[]) => {
    const updates: string[] = []
    const ctx: AccessContext = {
      agent: {
        async transform(callback) {
          callback({
            list: () => list,
            update(id, update) {
              const agent = list.find((held) => held.id === id)
              if (agent === undefined) throw new Error(`no agent ${id}`)
              updates.push(id)
              update(agent as unknown as { permissions: PermissionRule[] })
            },
          })
          return { dispose: async () => {} }
        },
      },
    }
    return { ctx, updates }
  }

  test("rules are inserted after the base allow, so a later agent rule still wins", async () => {
    const list = agents()
    const { ctx, updates } = context(list)
    const access = await applyAccess(ctx, { manifest: demo, options: { access: "read-only" } })
    assert.deepEqual(access.problems, [])
    assert.deepEqual(updates, ["build", "plan"])
    const build = list[0]!.permissions
    assert.equal(build[0]!.action, "*")
    assert.equal(build[1]!.action, "demo_*", "the wildcard rule follows the base allow")
    assert.equal(build.at(-1)!.action, "read", "the agent's own rule still follows")
    assert.equal(evaluate(build, "demo.send_message"), "deny")
    // A later rule the person adds for one tool wins, whichever level generated the default.
    const narrowed: PermissionRule[] = [...build, { action: "demo.send_message", resource: "*", effect: "allow" }]
    assert.equal(evaluate(narrowed, "demo.send_message"), "allow")
  })

  test("applying twice adds nothing twice, and an agent that appears later is named, never patched", async () => {
    const list = agents()
    const { ctx } = context(list)
    const first = await applyAccess(ctx, { manifest: demo, options: {} })
    const second = await applyAccess(ctx, { manifest: demo, options: {} })
    assert.equal(list[0]!.permissions.filter((rule) => rule.action === "demo.events_list").length, 1)
    assert.deepEqual(second.rules, first.rules)
    const later: AgentLike = { id: "reviewer", permissions: [{ action: "*", resource: "*", effect: "allow" }] }
    assert.deepEqual(unguardedAgents([...list, later], first.rules), ["reviewer"])
    assert.deepEqual(unguardedAgents(list, first.rules), [])
  })

  test("unguardedAgents names an agent whose later rule widens a generated ask or deny, not one that narrows", async () => {
    const list = agents()
    const { ctx } = context(list)
    const access = await applyAccess(ctx, { manifest: demo, options: { access: "read-only" } })
    const widened: AgentLike = { id: "widened", permissions: [...list[0]!.permissions, { action: "*", resource: "*", effect: "allow" }] }
    const narrowed: AgentLike = { id: "narrowed", permissions: [...list[0]!.permissions, { action: "*", resource: "*", effect: "deny" }] }
    const missing: AgentLike = { id: "missing", permissions: [{ action: "*", resource: "*", effect: "allow" }] }
    assert.deepEqual(unguardedAgents([widened, narrowed, missing], access.rules), ["missing", "widened"])
  })

  test("an invalid access option is a problem, not a wider default", async () => {
    const { ctx, updates } = context(agents())
    const access = await applyAccess(ctx, { manifest: demo, options: { access: "everything" } })
    assert.equal(access.rules.length, 0)
    assert.deepEqual(updates, [])
    assert.match(access.problems[0]!, /^OPTIONS_INVALID: .*Next step: /)
  })
})

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
    assert.deepEqual(operationRule({ id: "slack.workspace" }, "slack_read_channel", "work"), { action: "slack-work_slack_read_channel", resource: "*", effect: "allow" })
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
    }
    assert.equal(sessionRules(messages, { source: "demo.channels", account: ana }).ok, false)
  })

  test("a grant for work uses work's MCP server and cannot reach the default alias's tools", () => {
    const recordings = value((m) => {
      m.sources = [{ id: "demo.recordings", kind: "events", reads: "meeting", method: "events_list", operations: ["list_files"], cost: { class: "free" } }]
    }).sources[0]!
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

  test("refuse a declared operation with a wildcard", () => {
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

describe("withRules", () => {
  test("inserts after the base allow, and a later rule still wins", () => {
    const base: PermissionRule[] = [
      { action: "*", resource: "*", effect: "allow" },
      { action: "read", resource: "*.env", effect: "ask" },
      { action: "demo.send_message", resource: "*", effect: "allow" },
    ]
    const rules = withRules(base, [{ action: "demo.send_message", resource: "*", effect: "deny" }])
    assert.deepEqual(rules.map((rule) => rule.action), ["*", "demo.send_message", "read", "demo.send_message"])
    assert.equal(evaluate(rules, "demo.send_message"), "allow", "the agent's own later allow wins")
    assert.equal(methodAction("demo", "send_message"), "demo.send_message")
  })
})


describe("the package entries", () => {
  test("access and register are exported, and the old permission and tools-rpc entries are gone", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    assert.deepEqual(pkg.exports["./access"], { types: "./dist/access.d.ts", default: "./dist/access.js" })
    assert.deepEqual(pkg.exports["./register"], { types: "./dist/register.d.ts", default: "./dist/register.js" })
    assert.equal(pkg.exports["./permission"], undefined)
    assert.equal(pkg.exports["./tools-rpc"], undefined)
  })
})
