import assert from "node:assert/strict"
import { generateKeyPairSync } from "node:crypto"
import { describe, test } from "node:test"
import { createBus } from "../src/bus.ts"
import { signGrant } from "../src/grant.ts"
import { manifestHash, checkManifest, type Manifest } from "../src/manifest.ts"
import { register, type HandlerTable, type MethodHandler } from "../src/register.ts"
import { makeRpcHost, RpcDeclaredFailure, RpcFailure } from "./support/rpc-host.ts"
import { agentRules, makeHarness } from "./support/register-context.ts"
import { manifest } from "./support/manifest.ts"

const value = (change: (m: any) => void): Manifest => {
  const checked = checkManifest(manifest(change))
  assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("\n"))
  if (!checked.ok) throw new Error("fixture")
  return checked.value
}

const EMPTY = { type: "object", properties: {}, additionalProperties: false } as const
const OBJECT = { type: "object", additionalProperties: true } as const
const OK = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } as const
const SENT = { type: "object", properties: { sent: { type: "boolean" } }, required: ["sent"], additionalProperties: false } as const

const demo = value((m) => {})

const handler = (over: Partial<MethodHandler> = {}): MethodHandler => ({
  description: "A method.",
  input: EMPTY,
  output: OBJECT,
  run: async () => ({}),
  ...over,
})

function handlers(over: Partial<Record<string, MethodHandler>> = {}): HandlerTable {
  return {
    status: handler({ description: "Read the plugin's status.", output: OK, run: async () => ({ ok: true }) }),
    probe: handler({ description: "Read the signed-in owner.", run: async (_input, call) => ({ account: call.account, owner: "owner" }) }),
    events_list: handler({
      description: "List events.",
      input: { type: "object", properties: { cursor: { type: "string" } }, additionalProperties: false },
      run: async (input, call) => ({ account: call.account, cursor: input["cursor"] ?? null }),
    }),
    events_detail: handler({ description: "Read one event's detail." }),
    list_channels: handler({ description: "List channels." }),
    plan_send: handler({ description: "Dry-run a send.", run: async () => ({ planId: "p1", method: "send_message" }) }),
    send_message: handler({ description: "Send a message.", output: SENT, run: async () => ({ sent: true }) }),
    ...over,
  }
}


/** Make a plan through RPC and return its id; a commit may only use a plan this instance recorded. */
const planId = async (h: ReturnType<typeof makeHarness>, account?: string): Promise<string> => {
  const result = (await h.rpc.call("demo", "plan_send", { sessionID: "s1", input: account === undefined ? {} : { account } })) as { planId: string }
  return result.planId
}

const context = (over: Record<string, unknown> = {}) => ({
  sessionID: "s1",
  agent: "build",
  messageID: "msg_1",
  id: "call_1",
  signal: new AbortController().signal,
  progress: async () => {},
  ...over,
})

describe("register: the tool table", () => {
  test("one tool per declared method, in the plugin's namespace, with its permission action", async () => {
    const h = makeHarness()
    const registration = await register(h.ctx, demo, handlers())
    const declared = Object.keys(demo.methods).filter((method) => !method.startsWith("mcp:"))
    assert.equal(h.tools.size, declared.length)
    for (const method of declared) {
      const tool = h.tools.get(`demo_${method}`)
      assert.ok(tool, method)
      assert.deepEqual(tool.tool.options, { namespace: "demo", permission: `demo.${method}`, codemode: true })
    }
    assert.deepEqual(h.namespaces, [{ name: "demo", description: demo.plugin.summary }])
    assert.equal(h.rpc.count("demo"), 1, "one RPC registration")
    await registration.dispose()
    assert.equal(h.tools.size, 0)
    assert.equal(h.rpc.count("demo"), 0)
  })

  test("pinned marks the one method Code Mode may send every turn", async () => {
    const own = value((m) => {
      m.methods["search"] = { class: "read", accounts: "none", pinned: true }
    })
    const h = makeHarness()
    await register(h.ctx, own, handlers({ search: handler() }))
    assert.deepEqual(h.tools.get("demo_search")!.tool.options["codemode"], { pinned: true })
    assert.deepEqual(h.tools.get("demo_status")!.tool.options["codemode"], true)
  })

  test("a declared method with no handler, a handler with no declaration, and a handler for mcp:* are refused", async () => {
    await assert.rejects(register(makeHarness().ctx, demo, {} as HandlerTable), /UNAVAILABLE: .*status is declared but has no handler/)
    const extra = handlers({ not_declared: handler() })
    await assert.rejects(register(makeHarness().ctx, demo, extra), /UNAVAILABLE: .*not_declared.*does not declare/)
    const mcp = handlers({ "mcp:*": handler() })
    await assert.rejects(register(makeHarness().ctx, demo, mcp), /OPTIONS_INVALID: .*pass-through MCP method/)
  })
})

describe("register: input, account and output", () => {
  test("a tool runs its handler and validates the answer", async () => {
    const h = makeHarness()
    await register(h.ctx, demo, handlers())
    const result = await h.tools.get("demo_status")!.tool.execute({}, context())
    assert.deepEqual(result.output, { ok: true })
    assert.equal(result.content, '{"ok":true}')
  })

  test("the account resolves through accounts; required, unknown and forbidden accounts are contract refusals", async () => {
    const h = makeHarness({ options: { accounts: { work: {}, personal: {} } } })
    await register(h.ctx, demo, handlers())
    await assert.rejects(h.tools.get("demo_events_list")!.tool.execute({}, context()), /ACCOUNT_REQUIRED: .*Next step: Pass account, one of: work, personal\./)
    const result = await h.tools.get("demo_events_list")!.tool.execute({ account: "work" }, context())
    assert.deepEqual(result.output, { account: "work", cursor: null })
    await assert.rejects(h.tools.get("demo_events_list")!.tool.execute({ account: "family" }, context()), /ACCOUNT_UNKNOWN: this plugin has no account "family"/)
    await assert.rejects(h.tools.get("demo_status")!.tool.execute({ account: "work" }, context()), /INPUT_INVALID: status takes no account/)
  })

  test("a method declared accounts none runs as default with two aliases, and takes no account", async () => {
    const h = makeHarness({ options: { accounts: { work: {}, personal: {} } } })
    const own = handlers({ status: handler({ description: "Read the plugin's status.", output: OBJECT, run: async (_input, call) => ({ account: call.account }) }) })
    await register(h.ctx, demo, own)
    const result = await h.tools.get("demo_status")!.tool.execute({}, context())
    assert.deepEqual(result.output, { account: "default" })
    await assert.rejects(h.tools.get("demo_status")!.tool.execute({ account: "work" }, context()), /INPUT_INVALID: status takes no account/)
    await assert.rejects(h.tools.get("demo_events_list")!.tool.execute({}, context()), /ACCOUNT_REQUIRED: .*Next step: Pass account, one of: work, personal\./)
  })

  test("an input outside the handler's schema is INPUT_INVALID", async () => {
    const h = makeHarness()
    await register(h.ctx, demo, handlers())
    await assert.rejects(h.tools.get("demo_events_list")!.tool.execute({ cursor: 7 }, context()), /INPUT_INVALID: .*cursor/)
    await assert.rejects(h.tools.get("demo_events_list")!.tool.execute({ anything: true }, context()), /INPUT_INVALID: .*anything/)
  })

  test("an answer outside the handler's schema is SCHEMA_VIOLATION", async () => {
    const own = value((m) => {
      m.methods["broken"] = { class: "read", accounts: "none" }
    })
    const h = makeHarness()
    await register(h.ctx, own, handlers({ broken: handler({ output: OK, run: async () => ({ ok: "yes" }) }) }))
    await assert.rejects(h.tools.get("demo_broken")!.tool.execute({}, context()), /SCHEMA_VIOLATION: .*ok/)
  })

  test("a plan answers { planId, method } with the preview fields; a commit takes only the planId and no account", async () => {
    const h = makeHarness()
    await register(
      h.ctx,
      demo,
      handlers({
        plan_send: handler({
          run: async () => ({ planId: "p1", method: "send_message", output: { text: "hi" }, reaches: [{ id: "person:ana", label: "Ana" }], changes: ["sends one message"], cost: { usd: 0 }, trust: "untrusted" }),
        }),
      }),
    )
    const plan = await h.tools.get("demo_plan_send")!.tool.execute({}, context())
    assert.deepEqual(plan.output, {
      planId: "p1",
      method: "send_message",
      output: { text: "hi" },
      reaches: [{ id: "person:ana", label: "Ana" }],
      changes: ["sends one message"],
      cost: { usd: 0 },
      trust: "untrusted",
    })
    const sent = await h.tools.get("demo_send_message")!.tool.execute({ planId: "p1" }, context())
    assert.deepEqual(sent.output, { sent: true })
    await assert.rejects(h.tools.get("demo_send_message")!.tool.execute({ planId: "p1", text: "x" }, context()), /PLAN_INVALID: .*only \{ planId \}/)
    await assert.rejects(h.tools.get("demo_send_message")!.tool.execute({ planId: "p1", account: "work" }, context()), /PLAN_INVALID: .*takes only \{ planId \}; the grant names the account/)
    await assert.rejects(h.tools.get("demo_send_message")!.tool.execute({ text: "x" }, context()), /PLAN_INVALID: .*only \{ planId \}/)
  })

  test("a commit's own input schema is not used: the contract's { planId } is", async () => {
    const h = makeHarness()
    await register(h.ctx, demo, handlers({ send_message: handler({ input: {}, output: SENT, run: async () => ({ sent: true }) }) }))
    const plan = await h.tools.get("demo_plan_send")!.tool.execute({}, context())
    const planId = (plan.output as { planId: string }).planId
    assert.deepEqual((await h.tools.get("demo_send_message")!.tool.execute({ planId }, context())).output, { sent: true })
    await assert.rejects(h.tools.get("demo_send_message")!.tool.execute({ planId }, context()), /PLAN_USED/)
  })

  test("a commit runs as the plan's account: a deny on personal is not skipped", async () => {
    const h = makeHarness({ options: { accounts: { work: {}, personal: {} } } })
    let sent = 0
    await register(
      h.ctx,
      demo,
      handlers({
        plan_send: handler({ run: async (_input, call) => ({ planId: `plan-${call.account}`, method: "send_message" }) }),
        send_message: handler({ output: SENT, run: async () => { sent += 1; return { sent: true } } }),
      }),
    )
    h.sessions.get("s1")!.permissions = [{ action: "demo.send_message", resource: "personal:*", effect: "deny" }]
    const plan = await h.tools.get("demo_plan_send")!.tool.execute({ account: "personal" }, context())
    assert.deepEqual(plan.output, { planId: "plan-personal", method: "send_message" })
    await assert.rejects(h.tools.get("demo_send_message")!.tool.execute({ planId: "plan-personal" }, context()), /PERMISSION_DENIED/)
    assert.equal(sent, 0, "the commit ran as work and skipped the personal deny")
    // The same plan's account is the account named in the gate, not the first declared alias.
    assert.equal(h.assertions.at(-1)!.resources.join(","), "personal:demo.messages.create")
  })

  test("a commit refuses an unknown plan", async () => {
    const h = makeHarness()
    await register(h.ctx, demo, handlers())
    await assert.rejects(h.tools.get("demo_send_message")!.tool.execute({ planId: "not-a-plan" }, context()), /PLAN_INVALID: .*no plan/)
  })

  test("a plan commits once, and only through the method its plan named", async () => {
    const own = value((m) => {
      m.methods["plan_archive"] = { class: "read", accounts: "none", plans: true }
      m.methods["archive_message"] = { class: "write", accounts: "none", commits: "plan_archive" }
    })
    const h = makeHarness()
    await register(h.ctx, own, handlers({
      plan_send: handler({ run: async () => ({ planId: "plan-send", method: "send_message" }) }),
      plan_archive: handler({ run: async () => ({ planId: "plan-archive", method: "archive_message" }) }),
      send_message: handler({ output: SENT, run: async () => ({ sent: true }) }),
      archive_message: handler({ input: EMPTY, output: OBJECT, run: async () => ({ archived: true }) }),
    }))
    const plan = await h.tools.get("demo_plan_send")!.tool.execute({}, context())
    const sentPlan = (plan.output as { planId: string }).planId
    await assert.rejects(h.tools.get("demo_archive_message")!.tool.execute({ planId: sentPlan }, context()), /PLAN_INVALID: .*commits send_message/)
    assert.deepEqual((await h.tools.get("demo_send_message")!.tool.execute({ planId: sentPlan }, context())).output, { sent: true })
    await assert.rejects(h.tools.get("demo_send_message")!.tool.execute({ planId: sentPlan }, context()), /PLAN_USED/)
  })

  test("a plan is refused when it names a method that does not commit it", async () => {
    const h = makeHarness()
    await register(h.ctx, demo, handlers({ plan_send: handler({ run: async () => ({ planId: "p1", method: "status" }) }) }))
    await assert.rejects(h.tools.get("demo_plan_send")!.tool.execute({}, context()), /PLAN_INVALID: .*status.*send_message/)
  })
})

describe("register: error mapping", () => {
  const own = value((m) => {
    for (const name of ["fail_auth", "fail_old", "fail_input", "fail_secret", "fail_plain"]) m.methods[name] = { class: "read", accounts: "none" }
  })

  test("NEEDS_SIGN_IN passes, an unknown code is UNAVAILABLE, and a coded what is redacted", async () => {
    const h = makeHarness()
    await register(
      h.ctx,
      own,
      handlers({
        fail_auth: handler({ run: async () => Promise.reject(new Error("NEEDS_SIGN_IN: the sign-in expired. Next step: Sign in again.")) }),
        fail_old: handler({ run: async () => Promise.reject(new Error("AUTH_REQUIRED: the sign-in expired. Next step: Sign in again.")) }),
        fail_input: handler({ run: async () => Promise.reject(new Error("INPUT_INVALID: the cursor is not ours. Next step: Read from the start.")) }),
        fail_secret: handler({
          run: async () =>
            Promise.reject(Object.assign(new Error("INPUT_INVALID: the token ghp_abcdefghijklmnop1234 is not ours. Next step: Sign in again with https://example.com/cb?code=abcdef."), { code: "INPUT_INVALID", next: "Sign in again with https://example.com/cb?code=abcdef." })),
        }),
        fail_plain: handler({ run: async () => Promise.reject(new Error("the provider fell over")) }),
      }),
    )
    await assert.rejects(h.tools.get("demo_fail_auth")!.tool.execute({}, context()), /^Error: NEEDS_SIGN_IN: the sign-in expired\. Next step: Sign in again\.$/)
    await assert.rejects(h.tools.get("demo_fail_old")!.tool.execute({}, context()), /^Error: UNAVAILABLE: fail_old failed: AUTH_REQUIRED: the sign-in expired\. Next step: /)
    await assert.rejects(h.tools.get("demo_fail_input")!.tool.execute({}, context()), /^Error: INPUT_INVALID: the cursor is not ours\. Next step: Read from the start\.$/)
    await assert.rejects(h.tools.get("demo_fail_secret")!.tool.execute({}, context()), (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      assert.match(message, /^INPUT_INVALID: /)
      assert.equal(message.includes("ghp_abcdefghijklmnop1234"), false)
      assert.equal(message.includes("code=abcdef"), false)
      return true
    })
    await assert.rejects(h.tools.get("demo_fail_plain")!.tool.execute({}, context()), /^Error: UNAVAILABLE: fail_plain failed: the provider fell over\. Next step: /)
  })
})

describe("register: the per-alias server rule", () => {
  test("the gate names the method action and its operation's account resource, and access covers work's MCP server", async () => {
    const own = value((m) => {
      m.methods["sync"] = { class: "read", accounts: "optional", operations: ["list_files"] }
    })
    const h = makeHarness({ options: { accounts: { work: {}, personal: {} } } })
    await register(h.ctx, own, handlers({ sync: handler() }))
    await h.tools.get("demo_sync")!.tool.execute({ account: "work" }, context())
    assert.deepEqual(h.assertions, [{ sessionID: "s1", agent: "build", action: "demo.sync", resources: ["work:list_files"], save: ["work:*"] }])
    assert.ok(agentRules(h).some((rule) => rule.action === "demo-work_*"), "access covers work's MCP server")
    assert.equal(agentRules(h).some((rule) => rule.action === "demo-personal_*"), true, "access covers personal's MCP server")
  })
})

describe("register: door 3", () => {
  test("one RPC id carries the bus events, and createBus wraps that registration", async () => {
    const h = makeHarness()
    const registration = await register(h.ctx, demo, handlers())
    assert.equal(h.rpc.count("demo"), 1)
    const bus = createBus("demo", registration)
    assert.deepEqual(await bus.emit("changed", { capability: "demo.messages", account: "default", reason: "write" }), { ok: true })
    assert.deepEqual(h.rpc.published.map((event) => event.type), ["rpc.demo.changed"])
  })

  test("an event the manifest does not declare is not registered", async () => {
    const onlyChanged = value((m) => {
      m.events = { changed: {} }
    })
    const h = makeHarness()
    const registration = await register(h.ctx, onlyChanged, handlers())
    const bus = createBus("demo", registration)
    assert.deepEqual(await bus.emit("changed", { capability: "demo.messages", account: "default", reason: "write" }), { ok: true })
    assert.deepEqual(await bus.emit("status", { state: "ready" }), { ok: false, reason: "unavailable" })
  })

  test("a read runs through the one gate, and an RPC gate never saves", async () => {
    const h = makeHarness()
    await register(h.ctx, demo, handlers())
    assert.deepEqual(await h.rpc.call("demo", "status", { sessionID: "s1", input: {} }), { ok: true })
    assert.deepEqual(h.assertions, [{ sessionID: "s1", agent: "build", action: "demo.status", resources: ["default:*"] }])
  })

  test("read-only still runs a read over RPC", async () => {
    const h = makeHarness({ options: { access: "read-only" } })
    await register(h.ctx, demo, handlers())
    assert.deepEqual(await h.rpc.call("demo", "status", { sessionID: "s1", input: {} }), { ok: true })
  })

  test("an effect deny is refused under ask-changes before any confirmation", async () => {
    const own = value((m) => {
      m.methods["send_message"].effect = "deny"
    })
    const h = makeHarness({ options: { access: "ask-changes" } })
    await register(h.ctx, own, handlers())
    await assert.rejects(h.rpc.call("demo", "send_message", { sessionID: "s1", input: { planId: "p1" } }), (error: unknown) => {
      assert.ok(error instanceof RpcDeclaredFailure)
      assert.equal((error.data as { code: string }).code, "PERMISSION_DENIED")
      return true
    })
    assert.equal(h.assertions.length, 0, "the plugin's deny is checked before the session gate")
  })

  test("read-only refuses a non-read over RPC even with a valid grant", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const now = 1_800_000_000
    const input = { planId: "p1" }
    const token = signGrant({
      key: privateKey,
      kid: "host_test",
      audience: "@we-the-rebel-alliance/demo-plugin",
      consumer: "consumer:demo",
      capability: "demo.send_message",
      account: "default",
      act: "demo.messages.send",
      manifest: manifestHash(demo),
      jti: "grant_read_only_1",
      iat: now,
      exp: now + 60,
      input,
      cfm: true,
    })
    const h = makeHarness({ options: { access: "read-only" } })
    await register(h.ctx, demo, handlers(), {
      grant: { keys: { keys: { host_test: publicKey } }, audience: "@we-the-rebel-alliance/demo-plugin", store: { consume: async () => true }, now: () => now },
    })
    await assert.rejects(h.rpc.call("demo", "send_message", { sessionID: "s1", input, grant: token, consumer: "consumer:demo" }), (error: unknown) => {
      assert.ok(error instanceof RpcDeclaredFailure)
      assert.equal((error.data as { code: string }).code, "PERMISSION_DENIED")
      return true
    })
  })

  test("ask-changes asks, never saves, and a valid grant is the other confirmation", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const now = 1_800_000_000
    let jti = 0
    const tokenFor = (input: { planId: string }, manifest = manifestHash(demo)) =>
      signGrant({
        key: privateKey,
        kid: "host_test",
        audience: "@we-the-rebel-alliance/demo-plugin",
        consumer: "consumer:demo",
        capability: "demo.send_message",
        account: "default",
        act: "demo.messages.send",
        manifest,
        jti: `grant_ask_changes_${++jti}`,
        iat: now,
        exp: now + 60,
        input,
        cfm: true,
      })
    const h = makeHarness({ options: { access: "ask-changes" } })
    await register(h.ctx, demo, handlers(), {
      grant: { keys: { keys: { host_test: publicKey } }, audience: "@we-the-rebel-alliance/demo-plugin", store: { consume: async () => true }, now: () => now },
    })
    const first = { planId: await planId(h) }
    const before = h.assertions.length
    assert.deepEqual(await h.rpc.call("demo", "send_message", { sessionID: "s1", input: first }), { sent: true })
    assert.equal(h.assertions.length, before + 1)
    assert.equal(h.assertions.at(-1)!.action, "demo.send_message")
    assert.equal(h.assertions.at(-1)!.save, undefined, "an RPC ask never saves")
    const second = { planId: await planId(h) }
    const beforeSecond = h.assertions.length
    assert.deepEqual(await h.rpc.call("demo", "send_message", { sessionID: "s1", input: second }), { sent: true })
    assert.equal(h.assertions.length, beforeSecond + 1, "the second call asks again, so nothing was saved")
    // A session allow rule appended after the generated ask makes the grant the confirmation, and the gate allows it.
    h.sessions.get("s1")!.permissions = [{ action: "*", resource: "*", effect: "allow" }]
    const granted = { planId: await planId(h) }
    assert.deepEqual(await h.rpc.call("demo", "send_message", { sessionID: "s1", input: granted, grant: tokenFor(granted), consumer: "consumer:demo" }), { sent: true })
    // A valid grant is a confirmation, not a bypass of a session deny.
    h.sessions.get("s1")!.permissions = [{ action: "demo.send_message", resource: "*", effect: "deny" }]
    const denied = { planId: await planId(h) }
    await assert.rejects(h.rpc.call("demo", "send_message", { sessionID: "s1", input: denied, grant: tokenFor(denied), consumer: "consumer:demo" }), (error: unknown) => {
      assert.ok(error instanceof RpcDeclaredFailure)
      assert.equal((error.data as { code: string }).code, "PERMISSION_DENIED")
      return true
    })
  })

  test("a non-read with an allow rule and no ask or grant is refused (LD-5)", async () => {
    const h = makeHarness()
    await register(h.ctx, demo, handlers())
    const input = { planId: await planId(h) }
    await assert.rejects(h.rpc.call("demo", "send_message", { sessionID: "s1", input }), (error: unknown) => {
      assert.ok(error instanceof RpcDeclaredFailure)
      assert.equal(error.type, "failed")
      assert.equal((error.data as { code: string }).code, "PERMISSION_DENIED")
      return true
    })
  })

  test("a non-read with a permission ask runs when the ask is answered, and is refused when it is not", async () => {
    const answered = makeHarness()
    await register(answered.ctx, demo, handlers())
    answered.sessions.get("s1")!.permissions = [{ action: "demo.send_message", resource: "*", effect: "ask" }]
    assert.deepEqual(await answered.rpc.call("demo", "send_message", { sessionID: "s1", input: { planId: await planId(answered) } }), { sent: true })

    const refused = makeHarness({ answerAsks: false })
    await register(refused.ctx, demo, handlers())
    refused.sessions.get("s1")!.permissions = [{ action: "demo.send_message", resource: "*", effect: "ask" }]
    await assert.rejects(refused.rpc.call("demo", "send_message", { sessionID: "s1", input: { planId: await planId(refused) } }), (error: unknown) => {
      assert.ok(error instanceof RpcDeclaredFailure)
      assert.equal((error.data as { code: string }).code, "PERMISSION_DENIED")
      return true
    })
  })

  test("a non-read with a valid action grant runs, and an invalid one is GRANT_INVALID", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const now = 1_800_000_000
    let jti = 0
    const tokenFor = (input: { planId: string }, manifest = manifestHash(demo)) =>
      signGrant({
        key: privateKey,
        kid: "host_test",
        audience: "@we-the-rebel-alliance/demo-plugin",
        consumer: "consumer:demo",
        capability: "demo.send_message",
        account: "default",
        act: "demo.messages.send",
        manifest,
        jti: `grant_test_${++jti}`,
        iat: now,
        exp: now + 60,
        input,
        cfm: true,
      })
    const wiring = {
      grant: {
        keys: { keys: { host_test: publicKey } },
        audience: "@we-the-rebel-alliance/demo-plugin",
        store: { consume: async () => true },
        now: () => now,
      },
    }
    const h = makeHarness()
    await register(h.ctx, demo, handlers(), wiring)
    const first = { planId: await planId(h) }
    assert.deepEqual(await h.rpc.call("demo", "send_message", { sessionID: "s1", input: first, grant: tokenFor(first), consumer: "consumer:demo" }), { sent: true })
    const second = { planId: await planId(h) }
    await assert.rejects(h.rpc.call("demo", "send_message", { sessionID: "s1", input: second, grant: tokenFor(second, `sha256:${"a".repeat(64)}`), consumer: "consumer:demo" }), (error: unknown) => {
      assert.ok(error instanceof RpcDeclaredFailure)
      assert.equal((error.data as { code: string }).code, "GRANT_INVALID")
      return true
    })
  })

  test("a grant for another account than the plan is ACCOUNT_MISMATCH", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const now = 1_800_000_000
    const h = makeHarness({ options: { accounts: { work: {}, personal: {} } } })
    await register(h.ctx, demo, handlers(), {
      grant: { keys: { keys: { host_test: publicKey } }, audience: "@we-the-rebel-alliance/demo-plugin", store: { consume: async () => true }, now: () => now },
    })
    const input = { planId: await planId(h, "personal") }
    const token = signGrant({
      key: privateKey,
      kid: "host_test",
      audience: "@we-the-rebel-alliance/demo-plugin",
      consumer: "consumer:demo",
      capability: "demo.send_message",
      account: "work",
      act: "demo.messages.send",
      manifest: manifestHash(demo),
      jti: "grant_plan_account_1",
      iat: now,
      exp: now + 60,
      input,
      cfm: true,
    })
    await assert.rejects(h.rpc.call("demo", "send_message", { sessionID: "s1", input, grant: token, consumer: "consumer:demo" }), (error: unknown) => {
      assert.ok(error instanceof RpcDeclaredFailure)
      assert.equal((error.data as { code: string }).code, "ACCOUNT_MISMATCH")
      return true
    })
  })

  test("the envelope refuses an unknown key and an invalid input before the handler runs", async () => {
    const h = makeHarness()
    await register(h.ctx, demo, handlers())
    await assert.rejects(h.rpc.call("demo", "status", { sessionID: "s1", input: {}, extra: true }), (error: unknown) => error instanceof RpcFailure && error.type === "rpc.invalid_input")
    await assert.rejects(h.rpc.call("demo", "status", { sessionID: "s1", input: { extra: true } }), (error: unknown) => error instanceof RpcFailure && error.type === "rpc.invalid_input")
    await assert.rejects(h.rpc.call("demo", "status", { sessionID: "missing", input: {} }), (error: unknown) => {
      assert.ok(error instanceof RpcDeclaredFailure)
      assert.equal((error.data as { code: string }).code, "UNAVAILABLE")
      return true
    })
  })
})
