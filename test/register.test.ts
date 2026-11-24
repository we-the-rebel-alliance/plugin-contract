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

  test("agent: false gets a Code Mode entry; pinned marks the one method Code Mode may send every turn", async () => {
    const own = value((m) => {
      m.methods["internal_sync"] = { class: "read", accounts: "none", agent: false }
      m.methods["search"] = { class: "read", accounts: "none", pinned: true }
    })
    const h = makeHarness()
    await register(h.ctx, own, handlers({ internal_sync: handler(), search: handler() }))
    const hidden = h.tools.get("demo_internal_sync")!.tool
    assert.equal(typeof hidden.options["codemode"], "object")
    assert.deepEqual((hidden.options["codemode"] as Record<string, unknown>)["input"], hidden.input)
    const pinned = h.tools.get("demo_search")!.tool
    assert.deepEqual(pinned.options["codemode"], { pinned: true })
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

  test("a plan answers { planId, method }; a commit takes only the planId", async () => {
    const h = makeHarness()
    await register(h.ctx, demo, handlers())
    const plan = await h.tools.get("demo_plan_send")!.tool.execute({}, context())
    assert.deepEqual(plan.output, { planId: "p1", method: "send_message" })
    const sent = await h.tools.get("demo_send_message")!.tool.execute({ planId: "p1" }, context())
    assert.deepEqual(sent.output, { sent: true })
    await assert.rejects(h.tools.get("demo_send_message")!.tool.execute({ planId: "p1", text: "x" }, context()), /PLAN_INVALID: .*only \{ planId \}/)
    await assert.rejects(h.tools.get("demo_send_message")!.tool.execute({ text: "x" }, context()), /PLAN_INVALID: .*only \{ planId \}/)
  })

  test("a commit's own input schema is not used: the contract's { planId } is", async () => {
    const h = makeHarness()
    await register(h.ctx, demo, handlers({ send_message: handler({ input: {}, output: SENT, run: async () => ({ sent: true }) }) }))
    assert.deepEqual((await h.tools.get("demo_send_message")!.tool.execute({ planId: "p1" }, context())).output, { sent: true })
  })

  test("a plan is refused when it names a method that does not commit it", async () => {
    const h = makeHarness()
    await register(h.ctx, demo, handlers({ plan_send: handler({ run: async () => ({ planId: "p1", method: "status" }) }) }))
    await assert.rejects(h.tools.get("demo_plan_send")!.tool.execute({}, context()), /PLAN_INVALID: .*status.*send_message/)
  })
})

describe("register: error mapping", () => {
  const own = value((m) => {
    for (const name of ["fail_auth", "fail_input", "fail_plain"]) m.methods[name] = { class: "read", accounts: "none" }
  })

  test("a sign-in is NEEDS_SIGN_IN, a contract code passes through, and an unknown failure is UNAVAILABLE", async () => {
    const h = makeHarness()
    await register(
      h.ctx,
      own,
      handlers({
        fail_auth: handler({ run: async () => Promise.reject(new Error("AUTH_REQUIRED: the sign-in expired. Next step: Sign in again.")) }),
        fail_input: handler({ run: async () => Promise.reject(new Error("INPUT_INVALID: the cursor is not ours. Next step: Read from the start.")) }),
        fail_plain: handler({ run: async () => Promise.reject(new Error("the provider fell over")) }),
      }),
    )
    await assert.rejects(h.tools.get("demo_fail_auth")!.tool.execute({}, context()), /^Error: NEEDS_SIGN_IN: the sign-in expired\. Next step: Sign in again\.$/)
    await assert.rejects(h.tools.get("demo_fail_input")!.tool.execute({}, context()), /^Error: INPUT_INVALID: the cursor is not ours\. Next step: Read from the start\.$/)
    await assert.rejects(h.tools.get("demo_fail_plain")!.tool.execute({}, context()), /^Error: UNAVAILABLE: fail_plain failed: the provider fell over\. Next step: /)
  })
})

describe("register: the per-alias server rule", () => {
  test("a bare operation for work asserts work's server, never the default alias's", async () => {
    const own = value((m) => {
      m.methods["sync"] = { class: "read", accounts: "optional", operations: ["list_files"] }
    })
    const h = makeHarness({ options: { accounts: { work: {}, personal: {} } } })
    await register(h.ctx, own, handlers({ sync: handler() }))
    await h.tools.get("demo_sync")!.tool.execute({ account: "work" }, context())
    assert.ok(h.assertions.some((assertion) => assertion.action === "demo-work_list_files" && assertion.resources.join(",") === "*"))
    assert.equal(h.assertions.some((assertion) => assertion.action === "demo_list_files"), false)
    assert.ok(agentRules(h).some((rule) => rule.action === "demo-work_*"), "access covers work's MCP server")
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

  test("a read runs under the session's rules", async () => {
    const h = makeHarness()
    await register(h.ctx, demo, handlers())
    assert.deepEqual(await h.rpc.call("demo", "status", { sessionID: "s1", input: {} }), { ok: true })
  })

  test("a non-read with an allow rule and no ask or grant is refused (LD-5)", async () => {
    const h = makeHarness()
    await register(h.ctx, demo, handlers())
    await assert.rejects(h.rpc.call("demo", "send_message", { sessionID: "s1", input: { planId: "p1" } }), (error: unknown) => {
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
    assert.deepEqual(await answered.rpc.call("demo", "send_message", { sessionID: "s1", input: { planId: "p1" } }), { sent: true })

    const refused = makeHarness({ answerAsks: false })
    await register(refused.ctx, demo, handlers())
    refused.sessions.get("s1")!.permissions = [{ action: "demo.send_message", resource: "*", effect: "ask" }]
    await assert.rejects(refused.rpc.call("demo", "send_message", { sessionID: "s1", input: { planId: "p1" } }), (error: unknown) => {
      assert.ok(error instanceof RpcDeclaredFailure)
      assert.equal((error.data as { code: string }).code, "PERMISSION_DENIED")
      return true
    })
  })

  test("a non-read with a valid action grant runs, and an invalid one is GRANT_INVALID", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const now = 1_800_000_000
    const input = { planId: "p1" }
    const token = (over: { manifest?: string; input?: unknown } = {}) =>
      signGrant({
        key: privateKey,
        kid: "host_test",
        audience: "@we-the-rebel-alliance/demo-plugin",
        consumer: "consumer:demo",
        capability: "demo.send_message",
        account: "default",
        act: "demo.messages.send",
        manifest: over.manifest ?? manifestHash(demo),
        jti: "grant_test_1",
        iat: now,
        exp: now + 60,
        input: over.input ?? input,
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
    assert.deepEqual(await h.rpc.call("demo", "send_message", { sessionID: "s1", input, grant: token(), consumer: "consumer:demo" }), { sent: true })
    await assert.rejects(h.rpc.call("demo", "send_message", { sessionID: "s1", input, grant: token({ manifest: `sha256:${"a".repeat(64)}` }), consumer: "consumer:demo" }), (error: unknown) => {
      assert.ok(error instanceof RpcDeclaredFailure)
      assert.equal((error.data as { code: string }).code, "GRANT_INVALID")
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
