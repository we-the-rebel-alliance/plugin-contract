import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { createAutomation, legacySchedule, type AutomationSpec } from "../src/internal/host/automation.ts"
import { waitForActivation } from "../src/internal/host/activation.ts"
import { createCodeMode } from "../src/internal/host/codemode.ts"
import { connectMcpServer } from "../src/internal/host/mcp.ts"
import { TurnLog } from "../src/internal/host/turn.ts"

describe("the host harness: activation before the first RPC", () => {
  test("waits, with a bound, and runs the call after activation", async () => {
    let time = 0
    let checks = 0
    await waitForActivation({ isActive: () => ++checks >= 3, now: () => time, sleep: async (ms) => void (time += ms), pollMs: 25, timeoutMs: 1000 })
    assert.equal(checks, 3)
    assert.equal(time, 50)
  })

  test("fails at the bound with a code and a next step", async () => {
    let time = 0
    await assert.rejects(waitForActivation({ isActive: () => false, now: () => time, sleep: async (ms) => void (time += ms), pollMs: 10, timeoutMs: 50 }), /HOST_TIMEOUT: the plugin did not become active within 50 ms\. Next step: /)
  })
})

describe("the host harness: automations", () => {
  const spec: AutomationSpec = { name: "read", trigger: { type: "every", every: "5 minutes" }, action: { type: "code", code: "return 1" } }
  test("the embedded sdk host never runs one", async () => {
    let created = 0
    const result = await createAutomation({ kind: "sdk" }, { create: async () => (created++, { id: "aut_1" }) }, spec)
    assert.equal(result.status, "skipped")
    assert.equal(created, 0)
  })
  test("the server host creates one, and a scheduler override allows the sdk host", async () => {
    assert.deepEqual(await createAutomation({ kind: "server" }, { create: async () => ({ id: "aut_1" }) }, spec), { status: "created", id: "aut_1" })
    assert.deepEqual(await createAutomation({ kind: "sdk" }, { create: async () => ({ id: "aut_2" }) }, spec, { allowScheduler: true }), { status: "created", id: "aut_2" })
  })
  test("experimental.schedule is gone", () => {
    assert.throws(() => legacySchedule({}), /HOST_API_GONE: experimental\.schedule is gone from OpenCode 2\.4\. Next step: /)
  })
})

describe("the host harness: MCP discovery", () => {
  const transport = (statuses: readonly number[], body?: unknown) => {
    const sent: string[] = []
    let index = 0
    return { sent, request: async (method: string) => { sent.push(method); return { status: statuses[index++] ?? 200, ...(body === undefined ? {} : { body }) } } }
  }
  test("a 401 or 403 to server/discover is final, with no initialize", async () => {
    for (const status of [401, 403]) {
      const fake = transport([status])
      const answer = await connectMcpServer({ url: "https://mcp.example.test" }, fake)
      assert.deepEqual(fake.sent, ["server/discover"])
      assert.equal(answer.status, "failed")
      assert.equal(answer.code, status)
    }
  })
  test("a 404 falls back to initialize, and an explicit legacy protocol initializes directly", async () => {
    const fallback = transport([404, 200])
    assert.equal((await connectMcpServer({ url: "https://mcp.example.test" }, fallback)).status, "initialized")
    assert.deepEqual(fallback.sent, ["server/discover", "initialize"])
    const legacy = transport([200])
    assert.equal((await connectMcpServer({ url: "https://mcp.example.test", protocol: "legacy" }, legacy)).status, "initialized")
    assert.deepEqual(legacy.sent, ["initialize"])
  })
})

describe("the host harness: Code Mode call ids", () => {
  test("a nested call has its own id and codemode: true", () => {
    const code = createCodeMode({ sessionID: "ses_1", agent: "build", messageID: "msg_1" })
    const first = code.nested({ tool: "events_list" })
    const second = code.nested({ tool: "events_list" })
    assert.equal(first.codemode, true)
    assert.notEqual(first.id, second.id)
    assert.equal(code.topLevel({ tool: "status" }).codemode, false)
    assert.throws(() => code.nested({ tool: "status", id: first.id }), /HOST_CALL_ID: /)
  })
})

describe("the host harness: a turn's first step", () => {
  test("a step before its start is held, then emitted after the start", () => {
    const log = new TurnLog()
    const step = { type: "tool.step" as const, turnID: "turn_1", step: 1, at: 1 }
    const start = { type: "turn.start" as const, turnID: "turn_1", at: 2 }
    assert.deepEqual(log.push(step), [])
    assert.deepEqual(log.push(start), [start, step])
    assert.deepEqual(log.flush(), [])
  })
})
