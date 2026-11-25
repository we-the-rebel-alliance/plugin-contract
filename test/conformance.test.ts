import assert from "node:assert/strict"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { REASON_MAX } from "../src/accounts.ts"
import { serverOf, toolAction } from "../src/access.ts"
import { runConformance, t0, t1 } from "../src/conformance.ts"
import { readInstalledManifest, type Manifest } from "../src/manifest.ts"
import { staticFindings } from "../src/internal/conformance/static.ts"
import { grantAliasFindings, GRANT_ASSERT_TIMEOUT_MS, hostRuntimeProblem } from "../src/internal/conformance/host.ts"
import type { AssertResult, HostRun } from "../src/internal/host/index.ts"
import { declarationFindings, optionsFindings } from "../src/internal/conformance/declaration.ts"
import { accountFindings } from "../src/internal/conformance/accounts.ts"
import { actionFindings } from "../src/internal/conformance/actions.ts"
import { busFindings, statusFindings } from "../src/internal/conformance/status.ts"
import { grantFindings, rpcConfirmationFindings } from "../src/internal/conformance/grants.ts"
import { detailFindings, eventsFindings, probeFindings, suggestFindings } from "../src/internal/events-conformance.ts"

const here = dirname(fileURLToPath(import.meta.url))
const fixtureDirectory = join(here, "fixtures", "fixture-plugin")
const root = mkdtempSync(join(tmpdir(), "conformance-"))
after(() => rmSync(root, { recursive: true, force: true }))

let sequence = 0
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const ids = (findings: readonly { id: string }[]): string[] => findings.map((finding) => finding.id)
const errors = (findings: readonly { level: string }[]): unknown[] => findings.filter((finding) => finding.level === "error")
const nodeMajor = Number(process.versions.node.split(".")[0])
const skipHost = nodeMajor < 24 ? "the embedded host needs Node 24's explicit resource management (`await using`)" : false

/** The fixture's manifest and fixture, as the kit reads them. */
function fixture(): { manifest: Manifest; packageName: string; installed: { package: string; manifest: Manifest }; recorded: any } {
  const installed = readInstalledManifest(fixtureDirectory)
  assert.ok(installed.ok, installed.ok ? "" : installed.problems.join("\n"))
  const recorded = JSON.parse(readFileSync(join(fixtureDirectory, "fixtures", "conformance.json"), "utf8"))
  return { manifest: installed.value.manifest, packageName: installed.value.package, installed: installed.value, recorded }
}

/** A writable copy of the fixture plugin. */
function copy(): string {
  const directory = join(root, `fixture-${++sequence}`)
  cpSync(fixtureDirectory, directory, { recursive: true })
  // A fixture copy lives outside the repository: point its dist imports at this worktree's build.
  const entry = join(directory, "index.js")
  writeFileSync(entry, readFileSync(entry, "utf8").replaceAll("../../../dist/", `${join(here, "..", "dist")}/`))
  return directory
}

/** A real plugin entry built from the fixture manifest, for one broken property at a time. */
function writeCustom(directory: string, options: { readonly rules?: boolean; readonly unchecked?: boolean; readonly codemode?: boolean; readonly events?: boolean; readonly hostRange?: boolean; readonly pinned?: boolean; readonly id?: string; readonly missingTool?: string } = {}): void {
  const settings = { rules: true, unchecked: false, codemode: true, events: true, hostRange: true, pinned: true, id: "fixture", ...options }
  writeFileSync(
    join(directory, "index.js"),
    `import { readFileSync } from "node:fs"
import { effectFor, withRules } from ${JSON.stringify(join(here, "..", "dist", "access.js"))}
const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).capabilities
const settings = ${JSON.stringify(settings)}
function inRange(version) { const m = /^(\\d+)\\.(\\d+)\\.(\\d+)/.exec(String(version)); return m !== null && Number(m[1]) === 2 && Number(m[2]) === 4 && Number(m[3]) >= 1 }
export default {
  id: settings.id,
  async setup(context) {
    if (settings.hostRange && !inRange(context.app.version) && context.options?.allowUntestedHost !== true) throw new Error("HOST_UNTESTED: no. Next step: use 2.4.1.")
    const methods = Object.entries(manifest.methods).filter(([method]) => !method.startsWith("mcp:"))
    await context.tool.transform((tool) => {
      tool.namespace({ name: "fixture", description: manifest.plugin.summary })
      for (const [method, item] of methods) { if (method === settings.missingTool) continue; tool.add({ name: method, description: method, input: { type: "object" }, output: { type: "object" }, options: { namespace: "fixture", permission: "fixture." + method, codemode: settings.codemode ? (item.pinned === true && settings.pinned ? { pinned: true } : true) : false }, execute: async () => ({}) }) }
    })
    await context.rpc.register({ id: "fixture", methods: Object.fromEntries(methods.map(([method]) => [method, { input: { type: "object" }, output: { type: "object" } }])), events: settings.events ? Object.fromEntries(Object.keys(manifest.events).map((event) => [event, { schema: { type: "object" } }])) : {} }, Object.fromEntries(methods.map(([method, item]) => [method, async (input) => { if (!settings.unchecked && item.class !== "read") await context.permission.assert({ sessionID: input.sessionID ?? "ses_conformance", action: "fixture." + method, resources: ["*"] }); return { ok: true } }])))
    if (settings.rules) await context.agent.transform((agents) => { for (const agent of agents.list()) agents.update(agent.id, (info) => { const additions = [{ action: "fixture.*", resource: "*", effect: "allow" }]; for (const [method, item] of methods) { const effect = effectFor(item, context.options?.access ?? "all"); if (effect !== "allow") additions.push({ action: "fixture." + method, resource: "*", effect }) } info.permissions = withRules(info.permissions, additions) }) })
  },
}
`,
  )
}

describe("the fixture plugin, and the real host", () => {
  test("runConformance accepts the fixture", { timeout: 30_000 }, async () => {
    const report = await runConformance(fixtureDirectory)
    if (hostRuntimeProblem() === undefined) {
      assert.deepEqual(errors(report.findings), [])
      assert.equal(report.ok, true)
    } else {
      assert.equal(report.ok, false)
      assert.equal(report.findings.some((finding) => finding.id === "T1.host-unavailable" && finding.level === "error"), true)
    }
  })

  test("T1 loads it on 2.4.1 and it refuses 2.5.0", { skip: skipHost, timeout: 30_000 }, async () => {
    assert.deepEqual(await t1(fixtureDirectory, "2.4.1"), [])
    assert.deepEqual(await t1(fixtureDirectory, "2.5.0"), [])
  })

  test("HostRun.assert answers ok for an allow and PERMISSION_DENIED for the host's own deny", { skip: skipHost, timeout: 30_000 }, async () => {
    const { createHost } = await import("../src/internal/host/index.ts")
    const run = await createHost({ directory: fixtureDirectory, version: "2.4.1", pluginId: "fixture", options: { access: "all" } })
    try {
      assert.equal(run.failure, undefined, run.failure ?? "")
      const allowed = await run.session([])
      assert.deepEqual(await run.assert({ sessionID: allowed, action: "fixture.status", resources: ["*"] }), { ok: true })
      // The host's deny carries no contract code of its own: the harness reads its `Permission.BlockedError` as the code.
      const denied = await run.session([{ action: "fixture.status", resource: "*", effect: "deny" }])
      const refused = await run.assert({ sessionID: denied, action: "fixture.status", resources: ["*"] })
      assert.equal(refused.ok, false)
      assert.equal(refused.ok ? "" : refused.code, "PERMISSION_DENIED")
    } finally {
      await run.close()
    }
  })

  test("T1 records the real namespace, tools, Code Mode entries and RPC events", { skip: skipHost, timeout: 30_000 }, async () => {
    const namespace = await import("../src/internal/conformance/host.ts").then((module) => module.namespaceOf(fixtureDirectory, fixture().manifest))
    assert.equal(namespace, fixture().manifest.plugin.summary)
    const inspection = await import("../src/internal/conformance/host.ts").then((module) => module.inspectHost(fixtureDirectory, fixture().manifest, "2.4.1", { accounts: ["work", "personal"], realAccounts: true, inputs: fixture().recorded.rpc.inputs }))
    assert.deepEqual(inspection.findings, [])
    assert.ok(inspection.run?.tools.some((tool) => tool.permission === "fixture.pinned_status" && typeof tool.codemode === "object" && tool.codemode.pinned === true))
    assert.ok(inspection.run?.rpc?.events.includes("changed"))
  })

  test("a plugin with no permission rules is refused", { skip: skipHost, timeout: 30_000 }, async () => {
    const directory = copy()
    writeCustom(directory, { rules: false })
    assert.ok(ids(await t1(directory, "2.4.1")).includes("T1.permissions"))
  })

  test("LD-5: a non-read RPC with an allow rule and no grant must be refused", { skip: skipHost, timeout: 30_000 }, async () => {
    const directory = copy()
    writeCustom(directory, { unchecked: true })
    assert.ok(ids(await t1(directory, "2.4.1")).includes("T1.rpc-confirmation"))
  })

  test("LD-5 direct: an allow rule is not a confirmation even when the handler asks", { skip: skipHost, timeout: 30_000 }, async () => {
    const directory = copy()
    writeCustom(directory, { rules: true, unchecked: false })
    const found = await t1(directory, "2.4.1")
    assert.ok(ids(found).includes("T1.rpc-confirmation"))
  })

  test("a tool outside Code Mode is refused", { skip: skipHost, timeout: 30_000 }, async () => {
    const directory = copy()
    writeCustom(directory, { codemode: false })
    assert.ok(ids(await t1(directory, "2.4.1")).includes("T1.codemode"))
  })

  test("an RPC events block that does not match the manifest is refused", { skip: skipHost, timeout: 30_000 }, async () => {
    const directory = copy()
    writeCustom(directory, { events: false })
    assert.ok(ids(await t1(directory, "2.4.1")).includes("T1.events"))
  })

  test("a plugin that does not refuse an unsupported host is refused", { skip: skipHost, timeout: 30_000 }, async () => {
    const directory = copy()
    writeCustom(directory, { hostRange: false })
    assert.ok(ids(await t1(directory, "2.5.0")).includes("T1.unsupported-host"))
  })

  test("a pinned entry that is not in the manifest, and a missing pin, are refused", { skip: skipHost, timeout: 30_000 }, async () => {
    const directory = copy()
    writeCustom(directory, { pinned: false })
    assert.ok(ids(await t1(directory, "2.4.1")).includes("T1.codemode"))
  })

  test("a pinned tool over the token budget is refused", { skip: skipHost, timeout: 30_000 }, async () => {
    const directory = copy()
    const entry = join(directory, "index.js")
    writeFileSync(entry, readFileSync(entry, "utf8").replace('description: "Read the pinned status."', `description: "${"x".repeat(5000)}"`))
    assert.ok(ids(await t1(directory, "2.4.1")).includes("T1.pinned-budget"))
  })

  test("real account behaviour: a plugin that ignores its two aliases is refused", { skip: skipHost, timeout: 30_000 }, async () => {
    const directory = copy()
    writeCustom(directory, {})
    assert.ok(ids(await t1(directory, "2.4.1")).includes("T1.accounts"))
  })

  test("a setup error holding a secret is not printed", { skip: skipHost, timeout: 30_000 }, async () => {
    const directory = copy()
    writeFileSync(join(directory, "index.js"), 'export default { id: "fixture", async setup() { throw new Error("ghp_0123456789abcdefghijklmnopqrstuvwxyz") } }\n')
    const found = await t1(directory, "2.4.1")
    const text = found.map((finding) => finding.message).join("\n")
    assert.ok(ids(found).includes("T1.load"))
    assert.equal(text.includes("ghp_"), false)
  })

  test("a plugin with no server entry does not load", { skip: skipHost, timeout: 30_000 }, async () => {
    const directory = copy()
    rmSync(join(directory, "index.js"))
    assert.ok(ids(await t1(directory, "2.4.1")).includes("T1.load"))
  })

  test("a declared method with no tool is a doors finding", { skip: skipHost, timeout: 30_000 }, async () => {
    const directory = copy()
    writeCustom(directory, { missingTool: "status" })
    assert.ok(ids(await t1(directory, "2.4.1")).includes("T1.doors"))
  })

  test("a plugin with the wrong id is refused", { skip: skipHost, timeout: 30_000 }, async () => {
    const directory = copy()
    writeCustom(directory, { id: "other" })
    assert.ok(ids(await t1(directory, "2.4.1")).includes("T1.id"))
  })

  test("record:true and no fixture is warnings only", async () => {
    const directory = copy()
    rmSync(join(directory, "fixtures"), { recursive: true, force: true })
    const report = await runConformance(directory, { hosts: [], record: true })
    assert.equal(report.ok, true)
    assert.deepEqual(errors(report.findings), [])
  })

  test("hosts: [] skips T1 with a warning", async () => {
    const report = await runConformance(fixtureDirectory, { hosts: [] })
    assert.equal(report.ok, true)
    assert.ok(ids(report.findings).includes("T1.unchecked"))
  })
})

describe("T0", () => {
  test("the fixture is clean", async () => {
    const found = await t0(fixtureDirectory)
    if (nodeMajor >= 24) assert.deepEqual(found, [])
    else assert.deepEqual(errors(found), [])
  })
  test("the registered namespace line is the one T0 measures", () => {
    const { manifest } = fixture()
    assert.ok(ids(staticFindings(fixtureDirectory, manifest, { namespace: "x".repeat(401) })).includes("T0.namespace-length"))
  })
  test("a skill description over 300 characters, folded over lines, is refused", () => {
    const directory = copy()
    const file = join(directory, "skills", "fixture", "SKILL.md")
    const text = readFileSync(file, "utf8").replace(/description: >[\s\S]*?\n---/, `description: >\n  ${"x".repeat(301)}\n---`)
    writeFileSync(file, text)
    assert.ok(ids(staticFindings(directory, fixture().manifest, { namespace: "fixture" })).includes("T0.skill-length"))
  })
  test("a text naming an undeclared tool is refused, and a declared mcp: tool is accepted", () => {
    const directory = copy()
    writeFileSync(join(directory, "AGENTS.md"), "Call `tools.fixture.missing_method`, then `fixture_list_files`.\n")
    const found = ids(staticFindings(directory, fixture().manifest, { namespace: "fixture" }))
    assert.ok(found.includes("T0.tools"))
    const good = copy()
    writeFileSync(join(good, "AGENTS.md"), "Call `fixture_list_files`.\n")
    assert.ok(!ids(staticFindings(good, fixture().manifest, { namespace: "fixture" })).includes("T0.tools"))
  })
  test("a pinned method without evidence is refused", () => {
    const directory = copy()
    const fixtureFile = join(directory, "fixtures", "conformance.json")
    const value = JSON.parse(readFileSync(fixtureFile, "utf8"))
    value.pinned = {}
    writeFileSync(fixtureFile, JSON.stringify(value))
    assert.ok(ids(staticFindings(directory, fixture().manifest, { namespace: "fixture" })).includes("T0.pinned"))
  })
  test("generated docs are current, and drift is refused", () => {
    const directory = copy()
    const file = join(directory, "docs", "capabilities.md")
    writeFileSync(file, "# Capabilities\n\n<!-- generated:capabilities -->\nstale\n<!-- /generated:capabilities -->\n")
    assert.ok(ids(staticFindings(directory, fixture().manifest, { namespace: "fixture" })).includes("T0.docs-capabilities"))
  })
})

describe("the declaration", () => {
  test("a write verb in a read method's name is refused, and a riskier class is never downgraded", () => {
    const { installed } = fixture()
    const bad = clone(installed.manifest) as any
    bad.methods.create_note = { class: "read", accounts: "optional" }
    assert.ok(ids(declarationFindings({ ...installed, manifest: bad })).includes("methods.class"))
    const riskier = clone(installed.manifest) as any
    riskier.methods.export_note = { class: "delete", accounts: "optional" }
    assert.ok(!ids(declarationFindings({ ...installed, manifest: riskier })).includes("methods.class"))
  })

  test("a plan must be read, and its commit must name a different method", () => {
    const { installed } = fixture()
    const value = clone(installed.manifest) as any
    value.methods.plan_send.class = "write"
    const found = ids(declarationFindings({ ...installed, manifest: value }))
    assert.ok(found.includes("methods.plans") || found.includes("methods.commits"))
  })

  test("wrong defaults for access and allowUntestedHost are errors", () => {
    const { manifest } = fixture()
    const value = clone(manifest) as any
    value.options.properties.access.default = "ask-changes"
    value.options.properties.allowUntestedHost.default = true
    const found = optionsFindings(value)
    assert.ok(ids(found).includes("options.access-default"))
    assert.ok(ids(found).includes("options.untested-default"))
    assert.ok(errors(found).length >= 2)
  })

  test("a public-suffix or shared urlHost is refused, and so is a *.github.io thumbnail", () => {
    const { installed, manifest } = fixture()
    const value = clone(manifest) as any
    value.sources[0].urlHosts = ["*.github.io", "files.example.com"]
    assert.ok(ids(declarationFindings({ ...installed, manifest: value })).includes("sources.urlHosts"))
  })

  test("the package name derives from the plugin's name", () => {
    const { installed } = fixture()
    assert.ok(ids(declarationFindings({ ...installed, package: "@example/other-plugin" })).includes("names.package"))
  })
})

describe("recorded sources, accounts, status, actions and grants", () => {
  test("the fixture's pages, probe, detail and suggest are clean", () => {
    const { manifest, recorded } = fixture()
    const source = manifest.sources[0]!
    assert.ok(source.kind === "events")
    const entry = recorded.sources["fixture.messages"]
    assert.deepEqual(eventsFindings({ plugin: "@we-the-rebel-alliance/fixture-plugin", source, recorded: entry }), [])
    assert.deepEqual(probeFindings(source, entry.probe.answer, "work"), [])
    const detail = source.details?.[0]
    assert.ok(detail)
    assert.deepEqual(detailFindings(source, entry.details, "work"), [])
    assert.deepEqual(suggestFindings(source, entry.suggest.answer), [])
  })

  test("a thumbnail on a public suffix, or asked for by a source that did not declare it, is refused", () => {
    const { manifest, recorded } = fixture()
    const source = manifest.sources[0]!
    if (source.kind !== "events") throw new Error("fixture")
    const entry = clone(recorded.sources["fixture.messages"])
    entry.cases[0].answer.events[0].thumbnail = "https://user.github.io/thumb.png"
    const unsafe = clone(manifest) as any
    unsafe.sources[0].urlHosts = ["*.github.io"]
    assert.ok(ids(eventsFindings({ plugin: "@we-the-rebel-alliance/fixture-plugin", source: unsafe.sources[0], recorded: entry })).includes("pages.thumbnail"))
    const undeclared = clone(manifest) as any
    delete undeclared.sources[0].thumbnails
    const found = eventsFindings({ plugin: "@we-the-rebel-alliance/fixture-plugin", source: undeclared.sources[0], recorded: entry })
    assert.ok(ids(found).includes("pages.thumbnail"))
  })

  test("a failed entry holds the cursor, and a secret is refused", () => {
    const { manifest, recorded } = fixture()
    const source = manifest.sources[0]!
    if (source.kind !== "events") throw new Error("fixture")
    const failed = clone(recorded.sources["fixture.messages"])
    failed.cases[0].answer.failed = [{ external_id: "m-missing", code: "RATE_LIMITED" }]
    failed.cases[0].answer.cursor = "other"
    assert.ok(ids(eventsFindings({ plugin: "@we-the-rebel-alliance/fixture-plugin", source, recorded: failed })).includes("pages.cursor"))
    const secret = clone(recorded.sources["fixture.messages"])
    secret.cases[0].answer.events[0].text = "token ghp_0123456789abcdefghijklmnopqrstuvwxyz"
    assert.ok(ids(eventsFindings({ plugin: "@we-the-rebel-alliance/fixture-plugin", source, recorded: secret })).includes("pages.secrets") || ids(eventsFindings({ plugin: "@we-the-rebel-alliance/fixture-plugin", source, recorded: secret })).includes("pages.shape"))
  })

  test("one alias, the wrong refusal codes, and no cursor are refused", () => {
    const { manifest, recorded } = fixture()
    const one = clone(recorded.accounts)
    one.aliases = ["work"]
    assert.ok(ids(accountFindings(manifest, one)).includes("accounts.aliases"))
    const wrong = clone(recorded.accounts)
    wrong.required.code = "INPUT_INVALID"
    wrong.unknown.code = "INPUT_INVALID"
    wrong.cursors = []
    const found = ids(accountFindings(manifest, wrong))
    assert.ok(found.includes("accounts.required"))
    assert.ok(found.includes("accounts.unknown"))
    assert.ok(found.includes("accounts.cursors"))
  })

  test("a plugin with no cursor-bearing source is not asked for a cursor", () => {
    const { manifest, recorded } = fixture()
    const without = clone(recorded.accounts)
    without.cursors = []
    // The fixture declares an events source, so the recording must carry a cursor.
    assert.ok(ids(accountFindings(manifest, without)).includes("accounts.cursors"))
    // A plugin with no source has nothing to page.
    const noSources = clone(manifest) as any
    noSources.sources = []
    assert.ok(!ids(accountFindings(noSources, without)).includes("accounts.cursors"))
    // A snapshot returns the latest state, not a page: it has no cursor either.
    const snapshotOnly = clone(manifest) as any
    snapshotOnly.sources = [{ id: "fixture.messages", kind: "snapshot", method: "events_list", output: "agenda", cost: { class: "free" } }]
    assert.ok(!ids(accountFindings(snapshotOnly, without)).includes("accounts.cursors"))
  })

  test("events, status and actions are declared and recorded", () => {
    const { manifest, recorded } = fixture()
    const missing = clone(recorded.events)
    missing.emitted = ["changed"]
    assert.ok(ids(busFindings(manifest, missing)).includes("events.emitted"))
    const status = clone(recorded.events.status)
    status.name = "other"
    status.accounts = []
    assert.ok(ids(statusFindings(manifest, "1.0.0", status, ["work", "personal"])).includes("status.name"))
    const action = clone(recorded.actions)
    action[0].preview = undefined
    assert.ok(ids(actionFindings(manifest, action)).includes("actions.recorded"))
  })

  test("a redacted reason on a not-ready account is accepted; an oversized, non-string or unknown field is refused", () => {
    const { manifest, recorded } = fixture()
    const status = clone(recorded.events.status)
    const account = status.accounts.find((entry: { alias: string }) => entry.alias === "work")
    assert.ok(account, "the fixture records the work account")
    account.state = "needs_sign_in"
    account.reason = "The sign-in expired; sign in again."
    assert.deepEqual(statusFindings(manifest, "1.0.0", status, ["work", "personal"]), [])

    const long = clone(status)
    long.accounts.find((entry: { alias: string }) => entry.alias === "work").reason = "x".repeat(REASON_MAX + 1)
    assert.ok(ids(statusFindings(manifest, "1.0.0", long, ["work", "personal"])).includes("status.accounts"))

    const notString = clone(status)
    notString.accounts.find((entry: { alias: string }) => entry.alias === "work").reason = 42
    assert.ok(ids(statusFindings(manifest, "1.0.0", notString, ["work", "personal"])).includes("status.accounts"))

    const unknown = clone(status)
    unknown.accounts.find((entry: { alias: string }) => entry.alias === "work").extra = "x"
    assert.ok(ids(statusFindings(manifest, "1.0.0", unknown, ["work", "personal"])).includes("status.accounts"))
  })

  test("the grant recording verifies, and a missing negative case is refused", async () => {
    const { manifest, recorded } = fixture()
    assert.deepEqual(await grantFindings(manifest, recorded.grants), [])
    const missing = clone(recorded.grants)
    missing.cases = missing.cases.filter((entry: { name: string }) => entry.name !== "replayed")
    assert.ok(ids(await grantFindings(manifest, missing)).includes("grants.cases"))
  })

  test("a recorded non-read RPC refusal carries PERMISSION_DENIED", () => {
    const { manifest } = fixture()
    const found = rpcConfirmationFindings(manifest, { calls: [{ method: "write_note", ask: "denied", expect: { code: "UNAVAILABLE" } }] })
    assert.ok(ids(found).includes("rpc.confirmation"))
  })
})

describe("T1.grant-alias: the deny side is exactly PERMISSION_DENIED, and never a hang", () => {
  /** The mcp example's fence: two aliases, each own MCP server, and the operation the grant names. */
  let fence: { manifest: Manifest; aliases: readonly string[]; allowed: string; denied: string } | undefined
  function fenceOf(): { manifest: Manifest; aliases: readonly string[]; allowed: string; denied: string } {
    if (fence !== undefined) return fence
    const installed = readInstalledManifest(join(here, "..", "examples", "mcp"))
    assert.ok(installed.ok, installed.ok ? "" : installed.problems.join("\n"))
    const manifest = installed.value.manifest
    const aliases = ["work", "personal"] as const
    const source = manifest.sources.find((entry) => (entry.operations ?? []).some((operation) => !operation.includes(".")))
    assert.ok(source, "the mcp example declares a source with a bare MCP operation")
    const operation = (source.operations ?? []).find((entry) => !entry.includes("."))
    assert.ok(operation)
    const work = serverOf(manifest.plugin.name, aliases[0], aliases)
    const personal = serverOf(manifest.plugin.name, aliases[1], aliases)
    assert.ok(work.ok && personal.ok)
    fence = { manifest, aliases, allowed: toolAction(work.value, operation), denied: toolAction(personal.value, operation) }
    return fence
  }

  /** The host a grant-alias check reads: a session id and the assert answers the test scripts; nothing else is used. */
  function stubRun(assert: HostRun["assert"]): HostRun {
    return {
      host: "embedded-sdk",
      version: "2.4.1",
      tools: [],
      agents: [],
      asks: [],
      call: async () => ({ ok: false, code: "UNAVAILABLE", message: "the stub has no RPC" }),
      session: async () => "ses_grant_alias",
      assert,
      close: async () => {},
    }
  }

  test("a leaky host that allows the other alias's tool is a T1.grant-alias error", async () => {
    const { manifest, aliases, denied } = fenceOf()
    const found = await grantAliasFindings(manifest, stubRun(async () => ({ ok: true })), aliases)
    assert.deepEqual(ids(found), ["T1.grant-alias"])
    assert.match(found[0]!.message, new RegExp(`allows personal's tool ${denied}`))
  })

  test("a host that asks never answers: the check reports TIMEOUT after its bound instead of hanging", async () => {
    const { manifest, aliases, allowed } = fenceOf()
    const run = stubRun((input) => (input.action === allowed ? Promise.resolve({ ok: true }) : new Promise<AssertResult>(() => {})))
    const started = Date.now()
    const found = await grantAliasFindings(manifest, run, aliases)
    const elapsed = Date.now() - started
    assert.deepEqual(ids(found), ["T1.grant-alias"])
    assert.match(found[0]!.message, /TIMEOUT/)
    assert.ok(elapsed >= GRANT_ASSERT_TIMEOUT_MS - 50, `the check waited ${elapsed} ms for the host's answer`)
    assert.ok(elapsed < GRANT_ASSERT_TIMEOUT_MS * 8, `the check did not hang: ${elapsed} ms`)
  })

  test("a host that denies the other alias with PERMISSION_DENIED passes", async () => {
    const { manifest, aliases, allowed } = fenceOf()
    const run = stubRun(async (input) => (input.action === allowed ? { ok: true } : { ok: false, code: "PERMISSION_DENIED", message: "Permission denied" }))
    assert.deepEqual(await grantAliasFindings(manifest, run, aliases), [])
  })

  test("a deny with another code is a finding: only PERMISSION_DENIED proves the fence", async () => {
    const { manifest, aliases, allowed } = fenceOf()
    const run = stubRun(async (input) => (input.action === allowed ? { ok: true } : { ok: false, code: "UNAVAILABLE", message: "the tool failed" }))
    const found = await grantAliasFindings(manifest, run, aliases)
    assert.deepEqual(ids(found), ["T1.grant-alias"])
    assert.match(found[0]!.message, /does not deny personal's tool .* with PERMISSION_DENIED: the host answered UNAVAILABLE/)
  })

  test("a host that denies the granted alias's own tool is a finding", async () => {
    const { manifest, aliases } = fenceOf()
    const found = await grantAliasFindings(manifest, stubRun(async () => ({ ok: false, code: "PERMISSION_DENIED", message: "Permission denied" })), aliases)
    assert.deepEqual(ids(found), ["T1.grant-alias"])
    assert.match(found[0]!.message, /does not allow its own tool/)
  })

  test("one alias is no fence to prove: the check asserts nothing", async () => {
    const { manifest } = fenceOf()
    let asserted = 0
    const run = stubRun(async () => {
      asserted++
      return { ok: true }
    })
    assert.deepEqual(await grantAliasFindings(manifest, run, ["work"]), [])
    assert.equal(asserted, 0)
  })
})
