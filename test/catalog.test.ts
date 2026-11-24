import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, describe, test } from "node:test"
import { checkManifest, manifestHash } from "../src/manifest.ts"
import { evaluate, type Grant, type PermissionRule } from "../src/permission.ts"
import type { ReadHost, ReadRequest } from "../src/read.ts"
import {
  brokerRequest,
  isBrokerAnswer,
  isBrokerRequest,
  listInstalledPlugins,
  sourceReader,
  type BrokerAnswer,
  type BrokerRequest,
  type BrokerTransport,
  type CatalogHost,
  type HostPlugin,
} from "../src/catalog.ts"
import { installed, manifest } from "./support/manifest.ts"

const scratch = mkdtempSync(join(tmpdir(), "catalog-"))
after(() => rmSync(scratch, { recursive: true, force: true }))

/** A package.json on disk. `capabilities` omitted means the key is absent. */
function writePackage(directory: string, capabilities: unknown, name = "@example/demo", version = "1.0.0") {
  mkdirSync(directory, { recursive: true })
  const pkg: Record<string, unknown> = { name, version }
  if (capabilities !== undefined) pkg["capabilities"] = capabilities
  writeFileSync(join(directory, "package.json"), JSON.stringify(pkg))
}

const hostOf = (data: readonly HostPlugin[], root?: string): CatalogHost => ({
  plugin: { list: async () => ({ data }) },
  ...(root === undefined ? {} : { location: { directory: root } }),
})

describe("listInstalledPlugins", () => {
  test("lists a local plugin and a package target, each validated and hashed from disk", async () => {
    const root = join(scratch, "lists", "root")
    const local = join(scratch, "lists", "local")
    writePackage(local, manifest(), "@example/local")
    writePackage(join(root, "node_modules", "@example", "demo"), manifest(), "@example/demo")
    const listing = await listInstalledPlugins(
      hostOf([
        { id: "local", source: { type: "local", path: local } },
        { id: "demo", source: { type: "package", target: "@example/demo", version: "1.0.0" } },
        { id: "builtin", source: { type: "builtin" } },
        { id: "sdk", source: { type: "sdk" } },
      ]),
      { roots: [root] },
    )
    assert.deepEqual(listing.problems, [])
    assert.equal(listing.plugins.length, 2)
    for (const plugin of listing.plugins) {
      assert.equal(plugin.hash, manifestHash(plugin.manifest))
      assert.match(plugin.hash, /^sha256:[0-9a-f]{64}$/)
    }
    const byTarget = new Map(listing.plugins.map((plugin) => [plugin.target, plugin]))
    assert.equal(byTarget.get(local)?.package, "@example/local")
    assert.equal(byTarget.get(local)?.version, "1.0.0")
    assert.equal(byTarget.get(local)?.directory, local)
    assert.equal(byTarget.get("@example/demo")?.package, "@example/demo")
    assert.equal(byTarget.get("@example/demo")?.directory, join(root, "node_modules", "@example", "demo"))
    assert.equal(byTarget.get("@example/demo")?.manifest.sources[0]?.id, "demo.messages")
  })

  test("uses the host's directory as the default root, and a host resolve for a target no root holds", async () => {
    const root = join(scratch, "default", "root")
    const checkout = join(scratch, "default", "checkout")
    writePackage(join(root, "node_modules", "@example", "demo"), manifest(), "@example/demo")
    writePackage(checkout, manifest(), "@example/checkout")
    const fromRoot = await listInstalledPlugins(hostOf([{ source: { type: "package", target: "@example/demo" } }], root))
    assert.equal(fromRoot.plugins.length, 1)
    const resolved = await listInstalledPlugins(hostOf([{ source: { type: "package", target: "github:example/checkout", version: "e40fee4" } }], root), {
      resolve: (target) => (target === "github:example/checkout" ? checkout : undefined),
    })
    assert.deepEqual(resolved.problems, [])
    assert.equal(resolved.plugins[0]?.directory, checkout)
    assert.equal(resolved.plugins[0]?.target, "github:example/checkout")
  })

  test("reports a missing package, a package with no manifest, an invalid manifest and another version", async () => {
    const root = join(scratch, "problems", "root")
    writePackage(join(root, "node_modules", "@example", "demo"), manifest(), "@example/demo", "1.0.0")
    writePackage(join(root, "node_modules", "@example", "bare"), undefined, "@example/bare")
    writePackage(join(root, "node_modules", "@example", "broken"), { version: 1 }, "@example/broken")
    const listing = await listInstalledPlugins(
      hostOf([
        { source: { type: "package", target: "@example/demo", version: "2.0.0" } },
        { source: { type: "package", target: "@example/bare" } },
        { source: { type: "package", target: "@example/broken" } },
        { source: { type: "package", target: "@example/missing" } },
      ]),
      { roots: [root] },
    )
    assert.deepEqual(listing.plugins, [])
    assert.equal(listing.problems.length, 4)
    const problem = (target: string) => listing.problems.find((entry) => entry.target === target)?.problems.join("\n") ?? ""
    assert.match(problem("@example/demo"), /is version 1\.0\.0, not the 2\.0\.0/)
    assert.match(problem("@example/bare"), /declares no manifest/)
    assert.match(problem("@example/broken"), /capabilities\.plugin: Required/)
    assert.match(problem("@example/missing"), /no installed package/)
  })

  test("reports a plugin list that cannot be read instead of throwing", async () => {
    const host: CatalogHost = {
      plugin: {
        list: async () => {
          throw new Error("the host is offline")
        },
      },
    }
    const listing = await listInstalledPlugins(host)
    assert.deepEqual(listing.plugins, [])
    assert.match(listing.problems[0]?.problems[0] ?? "", /the host is offline/)
  })

  test("lists one entry for a package that is installed twice by two targets", async () => {
    const root = join(scratch, "twice", "root")
    const directory = join(root, "node_modules", "@example", "demo")
    writePackage(directory, manifest(), "@example/demo")
    const listing = await listInstalledPlugins(
      hostOf([
        { source: { type: "package", target: "@example/demo" } },
        { source: { type: "local", path: directory } },
      ]),
      { roots: [root] },
    )
    assert.equal(listing.plugins.length, 1)
    assert.deepEqual(listing.problems, [])
  })
})

const checked = checkManifest(manifest())
assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("\n"))
if (!checked.ok) throw new Error("fixture")
const demo = installed(checked.value)
const ana = "ana@example.com"
const context = { now: new Date("2026-11-13T09:41:27Z"), timeZone: "Europe/Amsterdam", me: "mailto:ana@example.com" }

/** A host that records each session's rules and answers each call from `answer`, checking the call against the rules. */
function fakeHost(answer: (method: string, input: Readonly<Record<string, unknown>>) => unknown, asserts: (input: Readonly<Record<string, unknown>>) => [string, string][] = () => []) {
  const sessions = new Map<string, readonly PermissionRule[]>()
  const calls: { method: string; input: Readonly<Record<string, unknown>>; rules: readonly PermissionRule[] }[] = []
  let closed = 0
  const host: ReadHost = {
    async openSession({ rules }) {
      const sessionID = `ses_${sessions.size + 1}`
      sessions.set(sessionID, rules)
      return { sessionID, close: async () => void closed++ }
    },
    async call({ method, sessionID, input }) {
      const rules = sessions.get(sessionID)!
      calls.push({ method, input, rules })
      for (const [action, resource] of asserts(input)) {
        if (evaluate(rules, action, resource) !== "allow") throw Object.assign(new Error(`PERMISSION_DENIED: ${action} on ${resource} was refused. Next step: grant it.`), { code: "PERMISSION_DENIED" })
      }
      return answer(method, input)
    },
  }
  return { host, calls, closed: () => closed }
}

const grantFor = (source: string, extra: Partial<Grant> = {}, of = demo): Grant => ({
  consumer: "notes.home",
  source,
  account: ana,
  manifestHash: of.hash,
  ...extra,
})

const snapshot = { source: "channels", account: ana, data: { items: [{ id: "n1", text: "One" }, { id: "n2", text: "Two" }], editable: false }, asOf: "2026-11-13T09:41:00Z", trust: "untrusted" }
const todayRequest = (extra: Partial<ReadRequest> = {}): ReadRequest => ({
  installed: demo,
  source: "demo.channels",
  consumer: "notes.home",
  grant: grantFor("demo.channels"),
  context,
  ...extra,
})

describe("the broker request", () => {
  const brokerAnswer = (answer: unknown) => {
    const seen: BrokerRequest[] = []
    const transport: BrokerTransport = async (request) => {
      seen.push(request)
      if (answer instanceof Error) throw answer
      return answer as BrokerAnswer
    }
    return { transport, seen }
  }

  test("is keyed on the consumer, and describes the source's manifest, never the grant", () => {
    const request = brokerRequest(todayRequest({ pick: ["items[].text"] }))
    assert.equal(request.consumer, "notes.home")
    assert.equal(request.package, "@example/demo")
    assert.equal(request.version, "1.0.0")
    assert.equal(request.manifestHash, demo.hash)
    assert.match(request.manifestHash, /^sha256:/)
    assert.equal(request.source, "demo.channels")
    assert.equal(request.account, ana)
    assert.deepEqual(request.pick, ["items[].text"])
    assert.equal("grant" in request, false)
    assert.equal("manifest" in request, false)
  })

  test("is recognised only with a consumer, the source and its manifest hash", () => {
    const request = brokerRequest(todayRequest())
    assert.equal(isBrokerRequest(request), true)
    assert.equal(isBrokerRequest({ ...request, consumer: "" }), false)
    const { consumer: _consumer, ...withoutConsumer } = request
    assert.equal(isBrokerRequest(withoutConsumer), false)
    assert.equal(isBrokerRequest({ ...request, package: "" }), false)
    assert.equal(isBrokerRequest({ ...request, manifestHash: undefined }), false)
    assert.equal(isBrokerRequest({ ...request, limit: 0 }), false)
    assert.equal(isBrokerRequest({ ...request, pick: ["ok", 2] }), false)
    assert.equal(isBrokerRequest({ ...request, scope: { channels: ["C1"] } }), true)
    assert.equal(isBrokerRequest({ ...request, scope: { channels: "C1" } }), false)
    assert.equal(isBrokerRequest(null), false)
  })

  test("reads embedded without a broker", async () => {
    const fake = fakeHost(() => snapshot)
    const outcome = await sourceReader({ host: fake.host }).read(todayRequest())
    assert.equal(outcome.via, "embedded")
    assert.equal(outcome.ok, true)
    assert.equal(fake.calls.length, 1)
  })

  test("sends the broker references and the read, never the manifest or the grant", async () => {
    const { transport, seen } = brokerAnswer({ offered: true, ok: true, value: snapshot, asOf: "2026-11-13T09:41:00Z", cached: true })
    const fake = fakeHost(() => snapshot)
    const outcome = await sourceReader({ host: fake.host, broker: transport }).read(todayRequest({ pick: ["items[].text"] }))
    assert.deepEqual(seen[0], {
      package: "@example/demo",
      version: "1.0.0",
      manifestHash: demo.hash,
      consumer: "notes.home",
      source: "demo.channels",
      account: ana,
      pick: ["items[].text"],
    })
    assert.equal(outcome.via, "broker")
    assert.equal(outcome.cached, true)
    assert.ok(outcome.ok && outcome.kind === "snapshot")
    if (outcome.ok && outcome.kind === "snapshot") assert.deepEqual(outcome.snapshot.data, { items: [{ text: "One" }, { text: "Two" }] })
    assert.equal(fake.calls.length, 0)
  })

  test("checks a broker's value as an embedded read does", async () => {
    const { transport } = brokerAnswer({ offered: true, ok: true, value: { ...snapshot, trust: "trusted" } })
    const outcome = await sourceReader({ host: fakeHost(() => snapshot).host, broker: transport }).read(todayRequest())
    assert.equal(outcome.ok ? "ok" : outcome.failure.code, "SCHEMA_VIOLATION")
    assert.equal(outcome.via, "broker")
  })

  test("reads embedded when the broker is off, the transport fails or the answer is not a broker's", async () => {
    for (const answer of [{ offered: false }, new Error("no host"), { offered: "yes" }, null]) {
      const fake = fakeHost(() => snapshot)
      const outcome = await sourceReader({ host: fake.host, broker: brokerAnswer(answer).transport }).read(todayRequest())
      assert.equal(outcome.via, "embedded")
      assert.equal(outcome.ok, true)
      assert.equal(fake.calls.length, 1)
    }
  })

  test("reads a refusal through the error table, with the host's codes as the table's", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ code: "BUDGET_EXCEEDED", message: "BUDGET_EXCEEDED: today's budget is spent. Next step: Raise it." }, "BUDGET_EXCEEDED"],
      [{ code: "PERMISSION_DENIED", message: "the notes app has no grant" }, "PERMISSION_DENIED"],
      [{ code: "NOT_GRANTED", message: "an unknown code" }, "UNAVAILABLE"],
      [{ code: "NEEDS_SIGN_IN", message: "the Google sign-in expired" }, "NEEDS_SIGN_IN"],
      [{ code: "RATE_LIMITED", message: "slow down", retryAfterSec: 30 }, "RATE_LIMITED"],
    ]
    for (const [refusal, expected] of cases) {
      const fake = fakeHost(() => snapshot)
      const outcome = await sourceReader({ host: fake.host, broker: brokerAnswer({ offered: true, ok: false, ...refusal }).transport }).read(todayRequest())
      assert.equal(outcome.ok ? "ok" : outcome.failure.code, expected)
      assert.equal(outcome.via, "broker")
      assert.equal(fake.calls.length, 0, "a refusal is final: no embedded read behind the broker's back")
      if (!outcome.ok && expected === "RATE_LIMITED") assert.equal(outcome.failure.retryAfterSec, 30)
    }
  })

  test("refuses before asking the broker: another consumer, a changed manifest, a turned-off source", async () => {
    const cases: [ReadRequest, string][] = [
      [todayRequest({ consumer: "notes" }), "PERMISSION_DENIED"],
      [todayRequest({ grant: grantFor("demo.channels", { manifestHash: "sha256:old" }) }), "PERMISSION_DENIED"],
      [todayRequest({ grant: grantFor("demo.channels", { disabled: true }) }), "SOURCE_DISABLED"],
    ]
    for (const [request, expected] of cases) {
      const { transport, seen } = brokerAnswer({ offered: true, ok: true, value: snapshot })
      const outcome = await sourceReader({ host: fakeHost(() => snapshot).host, broker: transport }).read(request)
      assert.equal(outcome.ok ? "ok" : outcome.failure.code, expected)
      assert.equal(seen.length, 0)
    }
  })

  test("knows a broker answer's shape", () => {
    assert.equal(isBrokerAnswer({ offered: false }), true)
    assert.equal(isBrokerAnswer({ offered: true, ok: true, value: null }), true)
    assert.equal(isBrokerAnswer({ offered: true, ok: false, code: "X", message: "y" }), true)
    assert.equal(isBrokerAnswer({ offered: true, ok: true }), false)
    assert.equal(isBrokerAnswer({ offered: true, ok: false, code: 1 }), false)
  })
})
