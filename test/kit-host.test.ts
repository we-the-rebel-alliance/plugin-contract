import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { Mcp, Plugin } from "@opencode/plugin"
import type { Tool } from "@opencode/schema/tool"
import {
  automationApi,
  connectMcpServer,
  createAutomation,
  createCodeMode,
  createHost,
  legacySchedule,
  mcpAddress,
  TurnLog,
  waitForActivation,
  type AutomationSpec,
  type McpTransport,
  type ToolCallLike,
} from "../src/kit.ts"

describe("the host harness's activation wait (2.4 behaviour 1)", () => {
  test("waits for the plugin to be active before the first RPC", async () => {
    let time = 0
    let checks = 0
    const order: string[] = []
    const host = createHost({
      kind: "server",
      plugin: "acme",
      isActive: () => {
        checks++
        order.push("check")
        return checks >= 3
      },
      now: () => time,
      sleep: async (ms) => {
        time += ms
      },
      pollMs: 25,
      timeoutMs: 1_000,
    })
    const answer = await host.call("status", async () => {
      order.push("call")
      return 42
    })
    assert.equal(answer, 42)
    assert.deepEqual(order.slice(-1), ["call"])
    assert.equal(checks, 3)
    assert.equal(time, 50)
  })

  test("fails at the bound with a next step, instead of hanging", async () => {
    let time = 0
    await assert.rejects(
      waitForActivation({
        isActive: () => false,
        now: () => time,
        sleep: async (ms) => {
          time += ms
        },
        pollMs: 10,
        timeoutMs: 50,
      }),
      /KIT_TIMEOUT: the plugin did not become active within 50 ms\. Next step: /,
    )
  })

  test("waits once for repeated activation calls", async () => {
    let checks = 0
    const host = createHost({ kind: "sdk", plugin: "acme", isActive: () => ++checks > 0, now: () => 0, sleep: async () => {} })
    await Promise.all([host.activate(), host.activate(), host.call("status", async () => 1)])
    assert.equal(checks, 1)
  })

  test("names the call that failed on the host", async () => {
    const host = createHost({ kind: "server", plugin: "acme", isActive: () => true })
    await assert.rejects(host.call("events_list", async () => Promise.reject(new Error("boom"))), /KIT_HOST_CALL: acme failed its first call, events_list, on the server host: boom\. Next step: /)
  })
})

describe("the host harness's automation rules (2.4 behaviours 2 and 3)", () => {
  const spec: AutomationSpec = { name: "read", trigger: { type: "every", every: "5 minutes" }, action: { type: "code", code: "return 1" } }

  test("the embedded sdk host never runs an automation", async () => {
    let created = 0
    const result = await createAutomation({ kind: "sdk" }, { create: async () => (created++, { id: "aut_1" }) }, spec)
    assert.deepEqual(result, { status: "skipped", reason: "the embedded @opencode/sdk host never runs automations; only @opencode/server starts the scheduler" })
    assert.equal(created, 0)
  })

  test("the server host creates one, and the sdk host does with a scheduler override", async () => {
    let created = 0
    const api = { create: async () => (created++, { id: `aut_${created}` }) }
    assert.deepEqual(await createAutomation({ kind: "server" }, api, spec), { status: "created", id: "aut_1" })
    assert.deepEqual(await createAutomation({ kind: "sdk" }, api, spec, { allowScheduler: true }), { status: "created", id: "aut_2" })
  })

  test("experimental.schedule is refused, and the 2.4 automation API is used instead", async () => {
    let scheduled = 0
    const client = {
      experimental: {
        schedule: () => {
          scheduled++
        },
        automation: { create: async () => ({ id: "aut_1" }) },
      },
    }
    assert.throws(() => legacySchedule(client), /KIT_API_GONE: experimental\.schedule is gone from OpenCode 2\.4\. Next step: /)
    assert.equal(scheduled, 0)
    assert.equal((await automationApi(client).create(spec)).id, "aut_1")
  })

  test("a host without experimental.automation says what to use", () => {
    assert.throws(() => automationApi({}), /KIT_API_GONE: this host has no experimental\.automation API\. Next step: use OpenCode 2\.4\.1 or later/)
  })

  test("accepts OpenCode 2.4.1's own automation create and server config types", async () => {
    // The real create has a wider input (sessionID, directory) and returns the whole automation; it still fits.
    const create = (async () => ({ id: "aut_real" })) as unknown as Plugin.Context["experimental"]["automation"]["create"]
    assert.deepEqual(await createAutomation({ kind: "server" }, { create }, spec), { status: "created", id: "aut_real" })
    const server: Mcp.ServerConfig = { type: "remote", url: "https://mcp.example.test", protocol: "legacy" }
    const answer = await connectMcpServer(server, { request: async () => ({ status: 200 }) })
    assert.equal(answer.status, "initialized")
  })
})

describe("the host harness's MCP discovery (2.4 behaviour 4)", () => {
  const transport = (statuses: readonly number[], body?: unknown): McpTransport & { sent: string[] } => {
    const sent: string[] = []
    let index = 0
    return {
      sent,
      async request(method) {
        sent.push(method)
        const status = statuses[index++] ?? 200
        return { status, ...(body === undefined ? {} : { body }) }
      },
    }
  }

  test("a 401 to server/discover ends the attempt: no initialize follows", async () => {
    const fake = transport([401])
    const answer = await connectMcpServer({ type: "remote", url: "https://mcp.example.test" }, fake)
    assert.deepEqual(fake.sent, ["server/discover"])
    assert.equal(answer.status, "failed")
    assert.equal(answer.code, 401)
    assert.match(answer.reason ?? "", /a 401 ends the attempt and no initialize follows/)
  })

  test("a server without discovery falls back to initialize", async () => {
    const fake = transport([404, 200])
    const answer = await connectMcpServer({ type: "remote", url: "https://mcp.example.test" }, fake)
    assert.deepEqual(fake.sent, ["server/discover", "initialize"])
    assert.equal(answer.status, "initialized")
  })

  test("a successful discovery selects the protocol the server names", async () => {
    const fake = transport([200], { protocol: "2026-07-28" })
    const answer = await connectMcpServer({ url: "https://mcp.example.test" }, fake)
    assert.deepEqual(fake.sent, ["server/discover"])
    assert.deepEqual({ status: answer.status, protocol: answer.protocol }, { status: "discovered", protocol: "2026-07-28" })
  })

  test("an explicit legacy protocol initializes directly, and an explicit 2026 protocol does not fall back", async () => {
    const legacy = transport([200])
    assert.equal((await connectMcpServer({ url: "https://mcp.example.test", protocol: "legacy" }, legacy)).status, "initialized")
    assert.deepEqual(legacy.sent, ["initialize"])
    const draft = transport([404])
    assert.equal((await connectMcpServer({ url: "https://mcp.example.test", protocol: "2026-07-28" }, draft)).status, "failed")
    assert.deepEqual(draft.sent, ["server/discover"])
  })

  test("an MCP config without an address is refused", () => {
    assert.throws(() => mcpAddress({ protocol: "legacy" }), /KIT_MCP: the MCP server has no url and no command\. Next step: /)
  })
})

describe("the host harness's Code Mode calls (2.4 behaviour 5)", () => {
  const session = { sessionID: "ses_1", agent: "build", messageID: "msg_1" }

  test("every nested call has its own id and codemode: true; a top-level call does not", () => {
    const code = createCodeMode(session)
    const first = code.nested({ tool: "events_list", input: { source: "acme" } })
    const second = code.nested({ tool: "events_list", input: { source: "acme" } })
    const top = code.topLevel({ tool: "status", id: "call_top" })
    assert.equal(first.codemode, true)
    assert.equal(second.codemode, true)
    assert.notEqual(first.id, second.id)
    assert.equal(top.codemode, false)
    assert.deepEqual(code.calls.map((call) => call.tool), ["events_list", "events_list", "status"])
  })

  test("an explicit id is used once; reusing it in the session is refused", () => {
    const code = createCodeMode(session)
    assert.equal(code.nested({ tool: "events_list", id: "call_1" }).id, "call_1")
    assert.throws(() => code.topLevel({ tool: "status", id: "call_1" }), /KIT_CALL_ID: the call id call_1 is already used in this session\. Next step: /)
  })

  test("the real Tool.Context fits the harness's call shape", () => {
    const context = null as unknown as Tool.Context
    const like: ToolCallLike = context
    assert.equal(like, context)
  })
})

describe("the host harness's turn log (2.4 behaviour 6)", () => {
  test("a first tool step that arrives before the turn start is held, then emitted after the start", () => {
    const log = new TurnLog()
    const step = { type: "tool.step" as const, turnID: "turn_1", step: 1, at: 1 }
    const start = { type: "turn.start" as const, turnID: "turn_1", at: 2 }
    assert.deepEqual(log.push(step), [])
    assert.deepEqual(log.push(start), [start, step])
    assert.deepEqual(
      log.push({ type: "tool.step", turnID: "turn_1", step: 2, at: 3 }),
      [{ type: "tool.step", turnID: "turn_1", step: 2, at: 3 }],
    )
  })

  test("a start first is emitted alone, then its steps in arrival order", () => {
    const log = new TurnLog()
    const start = { type: "turn.start" as const, turnID: "turn_1", at: 0 }
    const one = { type: "tool.step" as const, turnID: "turn_1", step: 1, at: 1 }
    const two = { type: "tool.step" as const, turnID: "turn_1", step: 2, at: 2 }
    assert.deepEqual(log.push(start), [start])
    assert.deepEqual(log.push(one), [one])
    assert.deepEqual(log.push(two), [two])
  })

  test("two turns' early steps are released with their own starts, never across", () => {
    const log = new TurnLog()
    const a = { type: "tool.step" as const, turnID: "a", step: 1, at: 1 }
    const b = { type: "tool.step" as const, turnID: "b", step: 1, at: 2 }
    const startB = { type: "turn.start" as const, turnID: "b", at: 3 }
    const startA = { type: "turn.start" as const, turnID: "a", at: 4 }
    log.push(a)
    log.push(b)
    assert.deepEqual(log.push(startB), [startB, b])
    assert.deepEqual(log.push(startA), [startA, a])
  })

  test("flush returns a step whose turn never started, so a test never loses it", () => {
    const log = new TurnLog()
    const step = { type: "tool.step" as const, turnID: "turn_1", step: 1, at: 1 }
    log.push(step)
    assert.deepEqual(log.flush(), [step])
    assert.deepEqual(log.flush(), [])
    assert.equal(log.events.length, 1)
  })
})
