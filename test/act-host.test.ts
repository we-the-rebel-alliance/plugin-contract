/**
 * `act` end to end on the real OpenCode 2.4.1 host (contract §8, §9 and §13): a preview answers a plan the register
 * minted, the person confirms, and the commit calls the action's commit method in its own fence, carrying the
 * host-signed grant that `register` verifies.
 *
 * The plugin is built with this package's `register` and its fourth-argument grant wiring; the app is this package's
 * `act` over the embedded host's sessions and RPC door. The plugin's status, the plan store, the grant verifier and the
 * permission gate are all real: no fake host and no fake permission service is involved.
 *
 * The cases: a granted commit runs and its fence denies an inner call outside the granted operations; a grant for
 * another account, scope, action, manifest or planId is refused; a commit without a grant is refused; a replayed grant
 * is GRANT_INVALID; a spent plan is PLAN_USED; and a planId from before a reload is PLAN_INVALID.
 */
import assert from "node:assert/strict"
import { generateKeyPairSync } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, test } from "node:test"
import { Plugin } from "@opencode/plugin"
import type { OpenCode as OpenCodeSdk } from "@opencode/sdk"
import { act, type ActHost } from "../src/act.ts"
import type { PermissionRule } from "../src/access.ts"
import { signGrant, type SignGrantRequest } from "../src/grant.ts"
import { checkManifest, manifestHash, type Manifest } from "../src/manifest.ts"
import { PLAN_ID_BYTES } from "../src/register/plans.ts"
import { register, type HandlerTable, type MethodHandler } from "../src/register.ts"
import { installed, manifest } from "./support/manifest.ts"

const EMPTY = { type: "object", properties: {}, additionalProperties: false } as const
const TEXT = { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } as const
/** The action's declared output: what the preview and the commit put in their `output`. */
const OUTPUT = {
  type: "object",
  properties: {
    saved: { type: "boolean" },
    probe: {
      type: "object",
      properties: { inside: { type: "string" }, outside: { type: "string" } },
      required: ["inside", "outside"],
      additionalProperties: false,
    },
  },
  required: ["saved"],
  additionalProperties: false,
} as const
/** The commit method's answer: the action's output and the contract's `trust`, which every answer carries. */
const SAVED = {
  type: "object",
  properties: { output: OUTPUT, trust: { type: "string", enum: ["untrusted"] } },
  required: ["output", "trust"],
  additionalProperties: false,
} as const
const ACCOUNTS = { type: "object", properties: { accounts: { type: "array" } }, required: ["accounts"], additionalProperties: true } as const

const value = (change: (m: any) => void): Manifest => {
  const checked = checkManifest(manifest(change))
  assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("\n"))
  if (!checked.ok) throw new Error("fixture")
  return checked.value
}

const demo = value((m) => {
  m.plugin.name = "actdemo"
  m.methods = {
    status: { class: "read", accounts: "none" },
    plan_note: { class: "read", plans: true, accounts: "none", operations: ["notes.plan"] },
    save_note: { class: "write", commits: "plan_note", accounts: "none", operations: ["notes.create"] },
  }
  m.sources = []
  m.actions = [
    {
      id: "actdemo.save",
      effect: "notify",
      preview: "plan_note",
      commit: "save_note",
      input: TEXT,
      output: OUTPUT,
    },
  ]
  m.events = { changed: {} }
  delete m.accounts
})

const AUDIENCE = "@we-the-rebel-alliance/demo-plugin"
const CONSUMER = "consumer:act"
const ACCOUNT = "default"
const NOW = 1_800_000_000

const handler = (over: Partial<MethodHandler>): MethodHandler => ({
  description: "A method.",
  input: EMPTY,
  output: { type: "object", additionalProperties: true },
  run: async () => ({}),
  ...over,
})

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

type HostContext = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]
type Host = OpenCodeSdk.Interface
type RpcCall = (input: unknown, options?: { readonly location?: { readonly directory: string } }) => Promise<unknown>

async function startHost(plugin: ReturnType<typeof Plugin.define>, directory: string): Promise<Host> {
  const { OpenCode } = await import("@opencode/sdk")
  const opencode = await OpenCode.create({ plugins: [plugin], log: { level: "error", emit: () => {} } })
  await opencode.sessions.create({ location: { directory }, agent: "build" })
  await opencode.sessions.prompt({ sessionID: (await opencode.sessions.list({ location: { directory } })).data[0]!.id, text: "activate", delivery: "queue" })
  await waitFor(async () => {
    const list = await opencode.plugin.list({ location: { directory } })
    return list.data.some((entry: { id: string }) => entry.id === "actdemo") ? true : undefined
  }, "the plugin to be active")
  return opencode
}

/** The plugin's RPC methods as this host calls them: the same id, and loose schemas the door validates on its side. */
function rpcClient(opencode: Host, methods: readonly string[]): Record<string, RpcCall> {
  const definition = {
    id: "actdemo",
    methods: Object.fromEntries(methods.map((method) => [method, { input: { type: "object" }, output: { type: "object" } }])),
    events: {},
  }
  return opencode.rpc(definition as never) as unknown as Record<string, RpcCall>
}

/** `act`'s host over the real server: real sessions, the real RPC door, and a status read for the aliases. */
function actHost(opencode: Host, directory: string): ActHost {
  const client = rpcClient(opencode, ["status", "plan_note", "save_note"])
  const call = (method: string, request: Readonly<Record<string, unknown>>) => client[method]!({ ...request }, { location: { directory } })
  const opened = async (permissions: readonly PermissionRule[], title?: string) => {
    const created = await opencode.sessions.create({ location: { directory }, agent: "build", permissions, ...(title === undefined ? {} : { title }) })
    return { sessionID: created.id, close: async () => void (await opencode.sessions.remove({ sessionID: created.id }).catch(() => undefined)) }
  }
  return {
    openSession: ({ rules, title }) => opened(rules, title),
    async status() {
      const reading = await opened([{ action: "*", resource: "*", effect: "allow" }])
      try {
        return await call("status", { sessionID: reading.sessionID, input: {} })
      } finally {
        await reading.close()
      }
    },
    async call({ method, sessionID, input, grant, consumer }) {
      return call(method, { sessionID, input, ...(grant === undefined ? {} : { grant }), ...(consumer === undefined ? {} : { consumer }) })
    },
  }
}

/** The register's refusal, as the RPC door answers it: the declared code and its sentence. */
async function refusalOf(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    const answer = await promise
    throw new Error(`expected a refusal, and the call answered ${JSON.stringify(answer)}`)
  } catch (error) {
    const record = error as { data?: { code?: string }; message?: unknown }
    if (record.data?.code === undefined) throw error
    return { code: record.data.code, message: typeof record.message === "string" ? record.message : "" }
  }
}

describe("act on the embedded OpenCode 2.4.1 host", () => {
  test("a granted commit runs in its fence; another account, scope, action, manifest, planId, replay and reload are refused", { timeout: 90000, skip: skipHost }, async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const directory = await mkdtemp(join(tmpdir(), "plugin-contract-act-"))
    const ran: { input: Readonly<Record<string, unknown>>; account: string; plan: unknown }[] = []
    const spent = new Set<string>()
    let hostContext: HostContext | undefined
    let grantNumber = 0
    const token = (planId: string, over: Partial<SignGrantRequest> = {}) =>
      signGrant({
        key: privateKey,
        kid: "host_test",
        audience: AUDIENCE,
        consumer: CONSUMER,
        capability: "actdemo.save_note",
        account: ACCOUNT,
        act: "actdemo.save",
        manifest: manifestHash(demo),
        input: { planId },
        iat: NOW,
        exp: NOW + 60,
        jti: `grant_${++grantNumber}`,
        cfm: true,
        ...over,
      })
    const handlers: HandlerTable = {
      status: handler({ description: "Read the plugin's status.", output: ACCOUNTS, run: async () => ({ accounts: [] }) }),
      plan_note: handler({
        description: "Dry-run a save.",
        input: TEXT,
        // A plan id is never the handler's: the register mints it. The rest is private plan data for call.plan.
        run: async (input) => ({ method: "save_note", text: input["text"], output: { saved: true }, trust: "untrusted" }),
      }),
      save_note: handler({
        description: "Save a note.",
        output: SAVED,
        run: async (input, call) => {
          // The commit's own fence: a granted operation runs, anything else is denied.
          let outside = "allowed"
          try {
            await hostContext!.permission.assert({ sessionID: call.sessionID, agent: call.agent, action: "actdemo.read", resources: ["default:notes.delete"] })
          } catch {
            outside = "denied"
          }
          let inside = "denied"
          try {
            await hostContext!.permission.assert({ sessionID: call.sessionID, agent: call.agent, action: "actdemo.read", resources: ["default:notes.create"] })
            inside = "allowed"
          } catch {
            inside = "denied"
          }
          ran.push({ input, account: call.account, plan: call.plan })
          return { output: { saved: true, probe: { inside, outside } }, trust: "untrusted" }
        },
      }),
    }
    const makePlugin = () =>
      Plugin.define({
        id: "actdemo",
        async setup(ctx) {
          hostContext = ctx
          const wrapped = Object.assign(Object.create(ctx), { options: { access: "all" } }) as HostContext
          const registration = await register(wrapped, demo, handlers, {
            grant: {
              keys: { keys: { host_test: publicKey } },
              audience: AUDIENCE,
              store: {
                async consume(claims) {
                  if (spent.has(claims.jti)) return false
                  spent.add(claims.jti)
                  return true
                },
              },
              now: () => NOW,
            },
          })
          return () => registration.dispose()
        },
      })
    let opencode = await startHost(makePlugin(), directory)
    try {
      let host = actHost(opencode, directory)
      const target = installed(demo)
      const grant = { consumer: CONSUMER, action: "actdemo.save", account: ACCOUNT, manifestHash: manifestHash(demo) }
      const plan = async () => {
        const preview = await act(host, { installed: target, action: "actdemo.save", grant, consumer: CONSUMER, phase: "preview", input: { text: "hello" } })
        assert.equal(preview.ok, true, preview.ok ? "" : preview.failure.message)
        if (!preview.ok || preview.phase !== "preview") throw new Error("no preview")
        return preview.preview.planId
      }
      const commit = async (planId: string, grantToken: string) =>
        act(host, { installed: target, action: "actdemo.save", grant, consumer: CONSUMER, phase: "commit", planId, grantToken })

      // 1. The preview answers a plan id the register minted: base64url, at least 128 random bits.
      const planId = await plan()
      assert.match(planId, /^[A-Za-z0-9_-]+$/)
      assert.ok(Buffer.from(planId, "base64url").length >= PLAN_ID_BYTES)
      assert.equal(ran.length, 0, "a preview runs no commit")

      // 2. A commit with no grant is refused by the register, and the plan stays committable.
      const allowed = await host.openSession({ rules: [{ action: "*", resource: "*", effect: "allow" }], title: "no grant" })
      try {
        const refused = await refusalOf(host.call({ package: target.package, method: "save_note", sessionID: allowed.sessionID, input: { planId } }))
        assert.equal(refused.code, "PERMISSION_DENIED")
      } finally {
        await allowed.close()
      }
      assert.equal(ran.length, 0)

      // 3. Every wrong binding is refused before the handler runs, and leaves the plan committable.
      const wrong = [
        { what: "another account", grantToken: token(planId, { account: "other" }), code: "ACCOUNT_MISMATCH", message: /another account/ },
        { what: "another scope", grantToken: token(planId, { scope: { channels: ["general"] } }), code: "GRANT_INVALID", message: /another scope/ },
        { what: "another action", grantToken: token(planId, { act: "actdemo.other" }), code: "GRANT_INVALID", message: /another action/ },
        { what: "another manifest", grantToken: token(planId, { manifest: `sha256:${"0".repeat(64)}` }), code: "GRANT_INVALID", message: /another manifest/ },
        { what: "another planId", grantToken: token("another-plan"), code: "GRANT_INVALID", message: /not the input/ },
      ]
      for (const refusal of wrong) {
        const outcome = await commit(planId, refusal.grantToken)
        assert.equal(outcome.ok, false, `a grant for ${refusal.what} must be refused`)
        if (outcome.ok) continue
        assert.equal(outcome.failure.code, refusal.code, `a grant for ${refusal.what} answers ${outcome.failure.code}`)
        assert.match(outcome.failure.message, refusal.message)
      }
      assert.equal(ran.length, 0, "a refused grant runs no handler")

      // 4. The valid commit runs with exactly { planId }, as the plan's account, in its own fence.
      const replayJti = "grant_replayed"
      const committed = await commit(planId, token(planId, { jti: replayJti }))
      assert.equal(committed.ok, true, committed.ok ? "" : committed.failure.message)
      if (!committed.ok || committed.phase !== "commit") return
      assert.deepEqual(committed.result.output, { saved: true, probe: { inside: "allowed", outside: "denied" } }, "a granted operation runs and an ungranted inner call is denied")
      assert.deepEqual(ran, [{ input: { planId }, account: ACCOUNT, plan: { method: "save_note", text: "hello", output: { saved: true }, trust: "untrusted" } }])

      // 5. A second commit of the spent plan is PLAN_USED, whatever fresh grant it carries.
      const second = await commit(planId, token(planId))
      assert.equal(second.ok, false)
      if (second.ok) return
      assert.equal(second.failure.code, "PLAN_USED")
      assert.equal(ran.length, 1, "a spent plan runs no second handler")

      // 6. A replayed grant on a fresh plan is GRANT_INVALID (GRANT_REPLAYED), and that plan still commits once.
      const replanned = await plan()
      assert.notEqual(replanned, planId, "every plan gets its own minted id")
      const replay = await commit(replanned, token(replanned, { jti: replayJti }))
      assert.equal(replay.ok, false)
      if (replay.ok) return
      assert.equal(replay.failure.code, "GRANT_INVALID")
      assert.match(replay.failure.message, /already been used|GRANT_REPLAYED/)
      const fresh = await commit(replanned, token(replanned))
      assert.equal(fresh.ok, true, fresh.ok ? "" : fresh.failure.message)
      assert.equal(ran.length, 2, "a refusal before the handler leaves the plan committable")

      // 7. A planId from before a reload is unknown to the new plugin instance, and is PLAN_INVALID.
      const stale = await plan()
      await opencode.close()
      opencode = await startHost(makePlugin(), directory)
      host = actHost(opencode, directory)
      const reloaded = await commit(stale, token(stale))
      assert.equal(reloaded.ok, false)
      if (reloaded.ok) return
      assert.equal(reloaded.failure.code, "PLAN_INVALID")
      assert.match(reloaded.failure.message, /no plan/)
    } finally {
      await opencode.close().catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }
  })
})
