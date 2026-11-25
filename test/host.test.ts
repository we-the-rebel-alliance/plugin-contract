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
import { generateKeyPairSync } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, test } from "node:test"
import { Effect } from "effect"
import { Plugin } from "@opencode/plugin"
import type { OpenCode as OpenCodeSdk } from "@opencode/sdk"
import { evaluate } from "../src/access.ts"
import { signGrant } from "../src/grant.ts"
import { checkManifest, manifestHash, type Manifest } from "../src/manifest.ts"
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

const nodeMajor = Number(process.versions.node.split(".")[0])
const skipHost = nodeMajor < 24 ? "the embedded host needs Node 24's explicit resource management (`await using`)" : false

describe("the gate on the embedded OpenCode 2.4.1 host", () => {
  test("a tool/Code Mode invocation and an RPC call each ask through ctx.permission.assert", { timeout: 30000, skip: skipHost }, async () => {
    const { OpenCode } = await import("@opencode/sdk")
    const directory = await mkdtemp(join(tmpdir(), "plugin-contract-host-"))
    let captured: HostContext | undefined
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

// ── The review's extra real-host cases ──────────────────────────────────────────────────────────────────────────────

const writeManifest = (name: string): Manifest =>
  value((m) => {
    m.plugin.name = name
    m.methods = { status: { class: "read", accounts: "none" }, write: { class: "write", accounts: "none" } }
    m.sources = []
    m.actions = []
    m.events = { changed: {} }
    delete m.accounts
  })

const orderManifest = (name: string, wildcardFirst: boolean): Manifest =>
  value((m) => {
    m.plugin.name = name
    const rest = { status: { class: "read", accounts: "none" } }
    const wildcard = { "mcp:*": { class: "read" } }
    const specific = { "mcp:files.delete": { class: "delete" } }
    m.methods = wildcardFirst ? { ...rest, ...wildcard, ...specific } : { ...rest, ...specific, ...wildcard }
    m.sources = []
    m.actions = []
    m.events = { changed: {} }
    delete m.accounts
  })

const writeHandler = handler({ description: "Write a note.", input: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false }, output: OK, run: async () => ({ ok: true }) })
const statusHandler = handler({ description: "Status.", output: OK, run: async () => ({ ok: true }) })
const writeHandlers: HandlerTable = { status: statusHandler, write: writeHandler }

interface HostCase {
  readonly manifest: Manifest
  readonly access?: string
  readonly handlers?: HandlerTable
  readonly wiring?: Parameters<typeof register>[3]
}

type HostContext = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]
type Host = OpenCodeSdk.Interface

function hostPlugin(testCase: HostCase, capture?: (ctx: HostContext) => void): ReturnType<typeof Plugin.define> {
  return Plugin.define({
    id: testCase.manifest.plugin.name,
    async setup(ctx) {
      capture?.(ctx)
      const wrapped = Object.assign(Object.create(ctx), { options: { access: testCase.access ?? "all" } }) as HostContext
      const registration = await register(wrapped, testCase.manifest, testCase.handlers ?? writeHandlers, testCase.wiring)
      return () => registration.dispose()
    },
  })
}

async function startHost(plugins: readonly ReturnType<typeof Plugin.define>[], directory: string, ids: readonly string[]): Promise<Host> {
  const { OpenCode } = await import("@opencode/sdk")
  const opencode = await OpenCode.create({ plugins, log: { level: "error", emit: () => {} } })
  await opencode.sessions.create({ location: { directory }, agent: "build" })
  await opencode.sessions.prompt({ sessionID: (await opencode.sessions.list({ location: { directory } })).data[0]!.id, text: "activate", delivery: "queue" })
  await waitFor(async () => {
    const list = await opencode.plugin.list({ location: { directory } })
    return ids.every((id) => list.data.some((entry: { id: string }) => entry.id === id)) ? true : undefined
  }, "the plugins to be active")
  return opencode
}

const ask = async (opencode: Host, sessionID: string, action: string, reply: "once" | "always" | "reject" = "once") => {
  const pending = await waitFor(async () => {
    const requests = await opencode.permission.list({ sessionID })
    return requests.find((request: { id: string; action: string }) => request.action === action)
  }, `a permission ask for ${action}`)
  await opencode.permission.reply({ sessionID, requestID: pending.id, decision: reply })
  return pending
}

const writeRpc = (opencode: Host, id: string, directory: string) =>
  opencode.rpc({
    id,
    methods: {
      write: {
        input: { type: "object", properties: { sessionID: { type: "string" }, input: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } }, required: ["sessionID", "input"], additionalProperties: false },
        output: OK,
        errors: { failed: { type: "object", properties: { code: { type: "string" }, next: { type: "string" } }, required: ["code", "next"], additionalProperties: false } },
      },
    },
    events: {},
  })

const failureOf = async (promise: Promise<unknown>): Promise<{ code: string }> => {
  try {
    await promise
    throw new Error("expected a refusal")
  } catch (error) {
    const data = (error as { data?: { code?: string } }).data
    if (data?.code === undefined) throw error
    return { code: data.code }
  }
}

describe("the review's real-host cases", () => {
  test("ask-changes asks for a write; a valid grant runs without a prompt; read-only refuses with a grant and with permissive rules", { timeout: 30000, skip: skipHost }, async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const now = 1_800_000_000
    const directory = await mkdtemp(join(tmpdir(), "plugin-contract-host-"))
    const askManifest = writeManifest("askdemo")
    const readManifest = writeManifest("readonly")
    const grant = (name: string) =>
      signGrant({
        key: privateKey,
        kid: "host_test",
        audience: "@we-the-rebel-alliance/demo-plugin",
        consumer: "consumer:demo",
        capability: `${name}.write`,
        account: "default",
        act: `${name}.write`,
        manifest: manifestHash(name === "askdemo" ? askManifest : readManifest),
        jti: `grant_${name}_1`,
        iat: now,
        exp: now + 60,
        input: { text: "hello" },
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
    const opencode = await startHost([hostPlugin({ manifest: askManifest, access: "ask-changes", wiring }), hostPlugin({ manifest: readManifest, access: "read-only", wiring })], directory, ["askdemo", "readonly"])
    try {
      const asked = await opencode.sessions.create({ location: { directory }, agent: "build", permissions: [{ action: "askdemo.write", resource: "*", effect: "ask" }] })
      const rpc = writeRpc(opencode, "askdemo", directory)
      const asking = rpc.write({ sessionID: asked.id, input: { text: "hello" } }, { location: { directory } })
      await ask(opencode, asked.id, "askdemo.write")
      assert.deepEqual(await asking, { ok: true })

      const granted = await opencode.sessions.create({ location: { directory }, agent: "build", permissions: [{ action: "askdemo.write", resource: "*", effect: "ask" }] })
      const grantedCall = writeRpc(opencode, "askdemo", directory).write({ sessionID: granted.id, input: { text: "hello" }, grant: grant("askdemo"), consumer: "consumer:demo" } as never, { location: { directory } })
      assert.deepEqual(await grantedCall, { ok: true })
      assert.deepEqual(await opencode.permission.list({ sessionID: granted.id }), [], "a valid grant does not prompt")

      const readGranted = await opencode.sessions.create({ location: { directory }, agent: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }] })
      assert.equal((await failureOf(writeRpc(opencode, "readonly", directory).write({ sessionID: readGranted.id, input: { text: "hello" }, grant: grant("readonly"), consumer: "consumer:demo" } as never, { location: { directory } }))).code, "PERMISSION_DENIED")
      assert.equal((await failureOf(writeRpc(opencode, "readonly", directory).write({ sessionID: readGranted.id, input: { text: "hello" } }, { location: { directory } }))).code, "PERMISSION_DENIED")
      assert.deepEqual(await opencode.permission.list({ sessionID: readGranted.id }), [], "read-only refuses without asking")
    } finally {
      await opencode.close().catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("a tool-door Always does not let RPC rely on a saved allow; a fresh ask or a grant does", { timeout: 30000, skip: skipHost }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "plugin-contract-host-"))
    let captured: HostContext | undefined
    const askManifest = writeManifest("askdemo")
    const opencode = await startHost([hostPlugin({ manifest: askManifest, access: "ask-changes" }, (ctx) => (captured = ctx))], directory, ["askdemo"])
    try {
      const session = await opencode.sessions.create({ location: { directory }, agent: "build", permissions: [{ action: "askdemo.write", resource: "*", effect: "ask" }] })
      const tool = (await captured!.tool.list()).find((entry) => entry.id === "askdemo_write")
      assert.ok(tool)
      const called = tool!.execute({ text: "hello" }, {
        sessionID: session.id,
        agent: "build",
        messageID: "msg_saved",
        id: "call_saved",
        signal: new AbortController().signal,
        progress: () => Effect.void,
      } as never)
      const saved = await ask(opencode, session.id, "askdemo.write", "always")
      assert.deepEqual(saved.save, ["default:*"], "a tool-door Always saves only the account pattern")
      assert.deepEqual(await called, { output: { ok: true }, content: '{"ok":true}' })

      // A no-operation method asks the same account pattern it saved, so "Always" sticks.
      const second = tool!.execute({ text: "again" }, {
        sessionID: session.id,
        agent: "build",
        messageID: "msg_saved_2",
        id: "call_saved_2",
        signal: new AbortController().signal,
        progress: () => Effect.void,
      } as never)
      const raced = await Promise.race([second, new Promise((resolve) => setTimeout(() => resolve("asked again"), 1000))])
      assert.notEqual(raced, "asked again", "a second no-operation tool call must not ask")
      assert.deepEqual(raced, { output: { ok: true }, content: '{"ok":true}' })

      const refused = writeRpc(opencode, "askdemo", directory).write({ sessionID: session.id, input: { text: "hello" } }, { location: { directory } })
      await ask(opencode, session.id, "askdemo.write", "reject")
      assert.equal((await failureOf(refused)).code, "PERMISSION_DENIED", "a saved allow does not confirm an RPC write")

      const fresh = writeRpc(opencode, "askdemo", directory).write({ sessionID: session.id, input: { text: "hello" } }, { location: { directory } })
      await ask(opencode, session.id, "askdemo.write", "once")
      assert.deepEqual(await fresh, { ok: true })
    } finally {
      await opencode.close().catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("ask-changes alone generates the ask; an allow-only session is not a confirmation", { timeout: 30000, skip: skipHost }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "plugin-contract-host-"))
    const askManifest = writeManifest("askdemo")
    const opencode = await startHost([hostPlugin({ manifest: askManifest, access: "ask-changes" })], directory, ["askdemo"])
    try {
      const generated = await opencode.sessions.create({ location: { directory }, agent: "build" })
      const call = writeRpc(opencode, "askdemo", directory).write({ sessionID: generated.id, input: { text: "hello" } }, { location: { directory } })
      await ask(opencode, generated.id, "askdemo.write", "once")
      assert.deepEqual(await call, { ok: true })

      const allowed = await opencode.sessions.create({ location: { directory }, agent: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }] })
      const refused = await failureOf(writeRpc(opencode, "askdemo", directory).write({ sessionID: allowed.id, input: { text: "hello" } }, { location: { directory } }))
      assert.equal(refused.code, "PERMISSION_DENIED", "an allow-only session is not a confirmation")
      assert.deepEqual(await opencode.permission.list({ sessionID: allowed.id }), [], "the allow-only refusal does not ask")
    } finally {
      await opencode.close().catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("both MCP rule orders deny a dotted tool under read-only on the real host", { timeout: 30000, skip: skipHost }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "plugin-contract-host-"))
    let captured: HostContext | undefined
    const a = orderManifest("ordera", true)
    const b = orderManifest("orderb", false)
    const opencode = await startHost(
      [hostPlugin({ manifest: a, access: "read-only", handlers: { status: statusHandler } }, (ctx) => (captured = ctx)), hostPlugin({ manifest: b, access: "read-only", handlers: { status: statusHandler } })],
      directory,
      ["ordera", "orderb"],
    )
    try {
      const build = (await captured!.agent.list()).data.find((agent) => agent.id === "build")
      assert.ok(build)
      assert.equal(evaluate(build.permissions, "ordera_files_delete"), "deny")
      assert.equal(evaluate(build.permissions, "orderb_files_delete"), "deny")
    } finally {
      await opencode.close().catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }
  })
})
