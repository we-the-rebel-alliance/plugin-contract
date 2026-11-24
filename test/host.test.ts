/**
 * The real-host proof for the one permission gate (contract §6 and §9; OpenCode 2.4.1).
 *
 * It loads a plugin built with this package's `register` into the embedded `@opencode/sdk` host, creates a session
 * whose rules say `ask`, and invokes the plugin through the RPC door and through the registered tool's own executor
 * (the same executor Code Mode uses). Each call must produce a real `permission.asked` event from
 * `ctx.permission.assert`; a `once` reply lets it finish. No fake tool host and no fake permission service is involved.
 *
 * A tool's `permission` option only hides a fully denied tool and `tool.add` adds no ask (OpenCode 2.4.1
 * `core/src/tool.ts:327,500` and `plugin/src/promise/adapter.ts:574`), so this test is the gate itself.
 */
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, test } from "node:test"
import { Effect } from "effect"
import { OpenCode } from "@opencode/sdk"
import { Plugin } from "@opencode/plugin"
import { checkManifest, type Manifest } from "../src/manifest.ts"
import { register, type HandlerTable, type MethodHandler } from "../src/register.ts"
import { manifest } from "./support/manifest.ts"

const EMPTY = { type: "object", properties: {}, additionalProperties: false } as const
const OK = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } as const
const SENT = { type: "object", properties: { sent: { type: "boolean" } }, required: ["sent"], additionalProperties: false } as const

const value = (change: (m: any) => void = () => {}): Manifest => {
  const checked = checkManifest(manifest(change))
  assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("\n"))
  if (!checked.ok) throw new Error("fixture")
  return checked.value
}

const demo = value()
const handler = (over: Partial<MethodHandler> = {}): MethodHandler => ({
  description: "A method.",
  input: EMPTY,
  output: { type: "object", additionalProperties: true },
  run: async () => ({}),
  ...over,
})

const handlers: HandlerTable = {
  status: handler({ description: "Read the plugin's status.", output: OK, run: async () => ({ ok: true }) }),
  probe: handler({ description: "Read the signed-in owner." }),
  events_list: handler({ description: "List events." }),
  events_detail: handler({ description: "Read one event's detail." }),
  list_channels: handler({ description: "List channels." }),
  plan_send: handler({ description: "Dry-run a send.", run: async () => ({ planId: "p1", method: "send_message" }) }),
  send_message: handler({ description: "Send a message.", output: SENT, run: async () => ({ sent: true }) }),
}

const RPC = {
  id: "demo",
  methods: {
    status: { input: { type: "object", properties: { sessionID: { type: "string" }, input: EMPTY }, required: ["sessionID", "input"], additionalProperties: false }, output: OK, errors: {} },
  },
  events: {},
} as const

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor<T>(read: () => Promise<T | undefined>, label: string, timeout = 5000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await read()
    if (value !== undefined) return value
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`)
    await sleep(25)
  }
}

describe("the gate on the embedded OpenCode 2.4.1 host", () => {
  test("a tool/Code Mode invocation and an RPC call each ask through ctx.permission.assert", { timeout: 30000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "plugin-contract-host-"))
    let captured: Plugin.Context | undefined
    const plugin = Plugin.define({
      id: "demo",
      async setup(ctx) {
        captured = ctx
        const registration = await register(ctx, demo, handlers)
        return () => registration.dispose()
      },
    })
    const opencode = await OpenCode.create({ plugins: [plugin], log: { level: "error", emit: () => {} } })
    try {
      const session = await opencode.sessions.create({
        location: { directory },
        agent: "build",
        permissions: [{ action: "demo.status", resource: "*", effect: "ask" }],
      })
      // A prompt is what makes the SDK acquire the session's plugin instance.
      await opencode.sessions.prompt({ sessionID: session.id, text: "activate the plugin", delivery: "queue" })
      await waitFor(async () => {
        const list = await opencode.plugin.list({ location: { directory } })
        return list.data.some((entry: { id: string }) => entry.id === "demo") ? true : undefined
      }, "the plugin to be active")
      assert.ok(captured, "setup captured the host context")

      const answer = async (action: string) => {
        const pending = await waitFor(async () => {
          const requests = await opencode.permission.list({ sessionID: session.id })
          return requests.find((request: { id: string; action: string }) => request.action === action)
        }, `a permission ask for ${action}`)
        await opencode.permission.reply({ sessionID: session.id, requestID: pending.id, decision: "once" })
      }

      // Door 1/2: the registered tool's executor, which Code Mode uses too.
      const tool = (await captured!.tool.list()).find((entry) => entry.id === "demo_status")
      assert.ok(tool, "demo_status is registered")
      const toolCall = tool!.execute({}, {
        sessionID: session.id,
        agent: "build",
        messageID: "msg_host_tool",
        id: "call_host_tool",
        signal: new AbortController().signal,
        codemode: true,
        progress: () => Effect.void,
      } as never)
      await answer("demo.status")
      assert.deepEqual(await toolCall, { output: { ok: true }, content: '{"ok":true}' })

      // Door 3: the RPC registration.
      const rpc = opencode.rpc(RPC)
      const result = rpc.status({ sessionID: session.id, input: {} }, { location: { directory } })
      await answer("demo.status")
      assert.deepEqual(await result, { ok: true })
    } finally {
      await opencode.close().catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }
  })
})
