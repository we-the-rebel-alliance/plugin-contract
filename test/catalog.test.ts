import assert from "node:assert/strict"
import { createHash } from "node:crypto"
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

/** A generation root as arborist writes it: the root package.json names the added dependency. */
function writeGeneration(cache: string, key: string, generation: string, dependencies: Record<string, string> = {}): string {
  const root = join(cache, "npm", key, generation)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies }))
  return root
}

/** A registry install at `<cache>/npm/<key>/<generation>/node_modules/<name>`. */
function installRegistry(cache: string, key: string, generation: string, name = "@example/demo", version = "1.0.0"): string {
  const root = writeGeneration(cache, key, generation)
  const directory = join(root, "node_modules", name)
  writePackage(directory, manifest(), name, version)
  return directory
}

/** The cache key 2.4.1 builds for a Git target: `git-<slug>-<sha256(target)[0..12]>`. */
const gitKey = (target: string, slug: string) => `git-${slug}-${createHash("sha256").update(target).digest("hex").slice(0, 12)}`

const active = (source: HostPlugin["source"]): HostPlugin => ({ state: { status: "active" }, source })

const hostOf = (data: readonly HostPlugin[]): CatalogHost => ({ plugin: { list: async () => ({ data }) } })

describe("listInstalledPlugins", () => {
  test("locates scoped and unscoped registry packages in the 2.4.1 cache", async () => {
    const cache = join(scratch, "registry", "opencode")
    const scoped = installRegistry(cache, "@example/demo@1.0.0", "1700000000000", "@example/demo", "1.0.0")
    const plain = installRegistry(cache, "plain@latest", "1700000000001", "plain", "2.0.0")
    const listing = await listInstalledPlugins(
      hostOf([
        active({ type: "package", target: "@example/demo", version: "1.0.0" }),
        active({ type: "package", target: "plain", version: "2.0.0" }),
        active({ type: "builtin" }),
        active({ type: "sdk" }),
      ]),
      { cacheDirectory: cache },
    )
    assert.deepEqual(listing.problems, [])
    assert.equal(listing.plugins.length, 2)
    const byTarget = new Map(listing.plugins.map((plugin) => [plugin.target, plugin]))
    assert.equal(byTarget.get("@example/demo")?.directory, scoped)
    assert.equal(byTarget.get("@example/demo")?.package, "@example/demo")
    assert.equal(byTarget.get("@example/demo")?.manifest.sources[0]?.id, "demo.messages")
    assert.equal(byTarget.get("plain")?.directory, plain)
    assert.equal(byTarget.get("plain")?.version, "2.0.0")
    for (const plugin of listing.plugins) {
      assert.equal(plugin.hash, manifestHash(plugin.manifest))
      assert.match(plugin.hash, /^sha256:[0-9a-f]{64}$/)
    }
  })

  test("locates a Git target by its 2.4.1 key and the generation's dependency name", async () => {
    const cache = join(scratch, "git", "opencode")
    const target = "github:example/checkout#v1.0.0"
    const key = gitKey(target, "checkout")
    assert.match(key, /^git-checkout-[0-9a-f]{12}$/)
    const generation = writeGeneration(cache, key, "1700000000100", { "@example/checkout": target })
    const directory = join(generation, "node_modules", "@example", "checkout")
    writePackage(directory, manifest(), "@example/checkout", "1.0.0")
    const shorthand = "example/checkout-two"
    const shorthandKey = gitKey(shorthand, "checkout-two")
    const shorthandGeneration = writeGeneration(cache, shorthandKey, "1700000000200", { "@example/checkout-two": shorthand })
    const shorthandDirectory = join(shorthandGeneration, "node_modules", "@example", "checkout-two")
    writePackage(shorthandDirectory, manifest(), "@example/checkout-two", "1.0.0")
    const listing = await listInstalledPlugins(hostOf([active({ type: "package", target, version: "e40fee4" }), active({ type: "package", target: shorthand, version: "e40fee5" })]), { cacheDirectory: cache })
    assert.deepEqual(listing.problems, [])
    assert.equal(listing.plugins.length, 2)
    const byTarget = new Map(listing.plugins.map((plugin) => [plugin.target, plugin]))
    assert.equal(byTarget.get(target)?.directory, directory)
    assert.equal(byTarget.get(target)?.target, target)
    // A Git target's version is a commit revision, so it is not compared with the package's version.
    assert.equal(byTarget.get(target)?.version, "1.0.0")
    assert.equal(byTarget.get(shorthand)?.directory, shorthandDirectory)
  })

  test("uses the repository name when a Git generation names no dependency", async () => {
    const cache = join(scratch, "git-fallback", "opencode")
    const target = "git+https://example.com/example/fallback.git#main"
    const key = gitKey(target, "fallback")
    const generation = writeGeneration(cache, key, "1700000000300")
    const directory = join(generation, "node_modules", "fallback")
    writePackage(directory, manifest(), "fallback", "1.0.0")
    const listing = await listInstalledPlugins(hostOf([active({ type: "package", target, version: "abc1234" })]), { cacheDirectory: cache })
    assert.deepEqual(listing.problems, [])
    assert.equal(listing.plugins[0]?.directory, directory)
  })

  test("chooses the newest generation that has no .rejected sibling", async () => {
    const cache = join(scratch, "rejected", "opencode")
    const older = installRegistry(cache, "@example/demo@latest", "100", "@example/demo", "1.0.0")
    installRegistry(cache, "@example/demo@latest", "200", "@example/demo", "2.0.0")
    writeFileSync(join(cache, "npm", "@example/demo@latest", "200.rejected"), "")
    const listing = await listInstalledPlugins(hostOf([active({ type: "package", target: "@example/demo", version: "1.0.0" })]), { cacheDirectory: cache })
    assert.deepEqual(listing.problems, [])
    assert.equal(listing.plugins[0]?.directory, older)
    assert.equal(listing.plugins[0]?.version, "1.0.0")
  })

  test("finds a range's own cache entry by the host's version", async () => {
    const cache = join(scratch, "range", "opencode")
    installRegistry(cache, "@example/demo@latest", "299", "@example/demo", "2.0.0")
    const directory = installRegistry(cache, "@example/demo@^1.0.0", "300", "@example/demo", "1.2.0")
    const listing = await listInstalledPlugins(hostOf([active({ type: "package", target: "@example/demo", version: "1.2.0" })]), { cacheDirectory: cache })
    assert.deepEqual(listing.problems, [])
    assert.equal(listing.plugins[0]?.directory, directory)
  })

  test("a host resolve wins over the cache", async () => {
    const cache = join(scratch, "resolve", "opencode")
    installRegistry(cache, "@example/demo@latest", "400", "@example/demo", "1.0.0")
    const checkout = join(scratch, "resolve", "checkout")
    writePackage(checkout, manifest(), "@example/demo", "9.9.9")
    const listing = await listInstalledPlugins(hostOf([active({ type: "package", target: "@example/demo", version: "9.9.9" })]), {
      cacheDirectory: cache,
      resolve: (target) => (target === "@example/demo" ? checkout : undefined),
    })
    assert.deepEqual(listing.problems, [])
    assert.equal(listing.plugins[0]?.directory, checkout)
  })

  test("defaults to <XDG_CACHE_HOME>/opencode", async () => {
    const xdg = join(scratch, "xdg")
    const previous = process.env["XDG_CACHE_HOME"]
    process.env["XDG_CACHE_HOME"] = xdg
    try {
      const directory = installRegistry(join(xdg, "opencode"), "plain@latest", "1", "plain")
      const listing = await listInstalledPlugins(hostOf([active({ type: "package", target: "plain" })]))
      assert.deepEqual(listing.problems, [])
      assert.equal(listing.plugins[0]?.directory, directory)
    } finally {
      if (previous === undefined) delete process.env["XDG_CACHE_HOME"]
      else process.env["XDG_CACHE_HOME"] = previous
    }
  })

  test("reports a failed plugin with the host's error and reference, and does not list it", async () => {
    const directory = join(scratch, "failed", "local")
    writePackage(directory, manifest(), "@example/failed")
    const listing = await listInstalledPlugins(
      hostOf([{ state: { status: "failed", error: "the setup threw", ref: "err_abc123" }, source: { type: "local", path: directory } }]),
    )
    assert.deepEqual(listing.plugins, [])
    assert.equal(listing.problems.length, 1)
    assert.match(listing.problems[0]?.problems[0] ?? "", /failed to load: the setup threw \(err_abc123\)/)
  })

  test("reports a single-file local plugin accurately", async () => {
    const file = join(scratch, "single", "index.ts")
    mkdirSync(join(scratch, "single"), { recursive: true })
    writeFileSync(file, "export default {}\n")
    const listing = await listInstalledPlugins(hostOf([active({ type: "local", path: file })]))
    assert.deepEqual(listing.plugins, [])
    assert.match(listing.problems[0]?.problems[0] ?? "", /a single-file local plugin has no package\.json manifest/)
    assert.doesNotMatch(listing.problems[0]?.problems[0] ?? "", /not JSON/)
  })

  test("reports a missing package, a package with no manifest, an invalid manifest and another version", async () => {
    const cache = join(scratch, "problems", "opencode")
    installRegistry(cache, "@example/demo@2.0.0", "500", "@example/demo", "1.0.0")
    const impostor = join(writeGeneration(cache, "@example/impostor@latest", "503"), "node_modules", "@example", "impostor")
    writePackage(impostor, manifest(), "@example/other")
    const bare = join(writeGeneration(cache, "@example/bare@latest", "501"), "node_modules", "@example", "bare")
    mkdirSync(bare, { recursive: true })
    writeFileSync(join(bare, "package.json"), JSON.stringify({ name: "@example/bare", version: "1.0.0" }))
    const broken = join(writeGeneration(cache, "@example/broken@latest", "502"), "node_modules", "@example", "broken")
    mkdirSync(broken, { recursive: true })
    writeFileSync(join(broken, "package.json"), JSON.stringify({ name: "@example/broken", version: "1.0.0", capabilities: { version: 1 } }))
    const listing = await listInstalledPlugins(
      hostOf([
        active({ type: "package", target: "@example/demo", version: "2.0.0" }),
        active({ type: "package", target: "@example/bare" }),
        active({ type: "package", target: "@example/broken" }),
        active({ type: "package", target: "@example/missing" }),
        active({ type: "package", target: "@example/impostor" }),
      ]),
      { cacheDirectory: cache },
    )
    assert.deepEqual(listing.plugins, [])
    assert.equal(listing.problems.length, 5)
    const problem = (target: string) => listing.problems.find((entry) => entry.target === target)?.problems.join("\n") ?? ""
    assert.match(problem("@example/demo"), /is version 1\.0\.0, not the 2\.0\.0/)
    assert.match(problem("@example/bare"), /declares no manifest/)
    assert.match(problem("@example/broken"), /capabilities\.plugin: Required/)
    assert.match(problem("@example/missing"), /no installed package/)
    assert.match(problem("@example/impostor"), /the installed package is @example\/other, not the @example\/impostor the host names/)
  })

  test("refuses a target whose spec would leave the cache", async () => {
    const cache = join(scratch, "traversal", "opencode")
    const listing = await listInstalledPlugins(hostOf([active({ type: "package", target: "@example/demo@../../etc" })]), { cacheDirectory: cache })
    assert.deepEqual(listing.plugins, [])
    assert.match(listing.problems[0]?.problems[0] ?? "", /not an npm or Git package target/)
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
    const cache = join(scratch, "twice", "opencode")
    const directory = installRegistry(cache, "@example/demo@latest", "600", "@example/demo")
    const listing = await listInstalledPlugins(
      hostOf([active({ type: "package", target: "@example/demo" }), active({ type: "local", path: directory })]),
      { cacheDirectory: cache },
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

  test("is recognised only with a consumer, the source, the manifest hash and no unknown key", () => {
    const request = brokerRequest(todayRequest())
    assert.equal(isBrokerRequest(request), true)
    assert.equal(isBrokerRequest({ ...request, consumer: "" }), false)
    const { consumer: _consumer, ...withoutConsumer } = request
    assert.equal(isBrokerRequest(withoutConsumer), false)
    assert.equal(isBrokerRequest({ ...request, package: "" }), false)
    assert.equal(isBrokerRequest({ ...request, manifestHash: undefined }), false)
    assert.equal(isBrokerRequest({ ...request, manifestHash: "sha256:abc" }), false)
    assert.equal(isBrokerRequest({ ...request, manifestHash: `sha256:${"a".repeat(63)}` }), false)
    assert.equal(isBrokerRequest({ ...request, manifestHash: `SHA256:${"a".repeat(64)}` }), false)
    assert.equal(isBrokerRequest({ ...request, unknown: true }), false)
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
