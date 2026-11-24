import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, describe, test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { readInstalledManifest } from "../src/manifest.ts"
import { runConformance, t0, t1, renderGeneratedDocs } from "../src/conformance.ts"
import { manifestHash } from "../src/manifest.ts"
import { validPage } from "./support/valid-page.ts"
import { staticFindings } from "../src/internal/conformance/static.ts"

const here = dirname(fileURLToPath(import.meta.url))
const support = pathToFileURL(join(here, "support", "plugin.mjs")).href
const root = mkdtempSync(join(tmpdir(), "conformance-"))
after(() => rmSync(root, { recursive: true, force: true }))

let sequence = 0

/** A v0 manifest for a small plugin with accounts, an events source and one non-read method. */
function manifest(change: (value: any) => void = () => {}): any {
  const value = {
    version: 1,
    plugin: {
      name: "demo",
      title: "Demo",
      summary: "A demo connector for the conformance kit's tests.",
      vendor: { id: "demo", name: "Demo", domain: "demo.example" },
      icons: [{ src: "assets/icon.svg", type: "image/svg+xml" }],
      host: { opencode: ">=2.4.1 <2.5.0", tested: ["2.4.1"] },
    },
    accounts: { via: "integration", profile: { $ref: "#/options/properties/accounts/additionalProperties" }, owner: "mailto" },
    options: {
      type: "object",
      properties: {
        access: { type: "string", enum: ["all", "ask-changes", "read-only"], default: "all" },
        accounts: { type: "object", additionalProperties: { type: "object", properties: { region: { type: "string" } }, additionalProperties: false } },
        allowUntestedHost: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
    methods: {
      status: { class: "read", accounts: "none" },
      probe: { class: "read", accounts: "optional", operations: ["demo.users.get"] },
      events_list: { class: "read", accounts: "optional", operations: ["demo.messages.list", "demo.users.get"] },
      send_message: { class: "send", accounts: "optional", operations: ["demo.messages.create"] },
    },
    sources: [
      {
        id: "demo.messages",
        kind: "events",
        reads: "message",
        method: "events_list",
        input: { source: "messages" },
        operations: ["demo.messages.list", "demo.users.get"],
        cost: { class: "free" },
        maxBytes: 65_536,
        urlHosts: ["example.test"],
      },
    ],
    actions: [],
    events: { changed: {} },
  }
  change(value)
  return value
}

/** A page of the test source for one account. */
function page(account: string, change: (value: any) => void = () => {}): any {
  const value = validPage({
    source: "messages",
    plugin: "@we-the-rebel-alliance/demo-plugin",
    account,
    owner: { id: `mailto:${account}@example.test`, label: account },
    events: [{ external_id: `m-${account}`, occurred_at: "2026-11-01T09:00:00.000Z" }],
    cursor: `cursor-${account}`,
    more: false,
    asOf: "2026-11-13T09:00:00.000Z",
  })
  change(value)
  return value
}

/** A fixture the base manifest satisfies. */
function fixture(change: (value: any) => void = () => {}): any {
  const value = {
    plugin: "@we-the-rebel-alliance/demo-plugin",
    accounts: {
      aliases: ["work", "personal"],
      required: { method: "events_list", code: "ACCOUNT_REQUIRED" },
      unknown: { method: "events_list", account: "nobody_here", code: "ACCOUNT_UNKNOWN" },
      cursors: [{ method: "events_list", account: "work", other: "personal", code: "CURSOR_INVALID" }],
    },
    sources: {
      "demo.messages": {
        cases: [
          { name: "the work account", input: { source: "messages", account: "work" }, expect: "page", answer: page("work") },
          { name: "the personal account", input: { source: "messages", account: "personal" }, expect: "page", answer: page("personal") },
        ],
        probe: { answer: { source: "messages", account: "work", owner: { id: "mailto:work@example.test", label: "Work" }, trust: "untrusted" } },
      },
    },
    events: {
      emitted: ["changed"],
      status: {
        name: "demo",
        version: "1.0.0",
        host: { version: "2.4.1", range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] },
        state: "ready",
        accounts: [
          { alias: "work", state: "ready", owner: { id: "mailto:work@example.test", label: "Work" } },
          { alias: "personal", state: "ready", owner: { id: "mailto:personal@example.test", label: "Personal" } },
        ],
        unguardedAgents: [],
        nextStep: null,
      },
    },
  }
  change(value)
  return value
}

/** Write a plugin directory a consumer and T1 can read. */
function plugin(options: {
  readonly value?: any
  readonly recorded?: any
  readonly entry?: boolean
  readonly entryOptions?: Record<string, unknown>
  readonly skills?: boolean
  readonly skillDescription?: string
  readonly docs?: boolean
  readonly extraFiles?: Readonly<Record<string, string>>
}): string {
  const value = options.value ?? manifest()
  const name = value.plugin.name
  const directory = join(root, `plugin-${++sequence}`)
  mkdirSync(join(directory, "fixtures"), { recursive: true })
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify({ name: `@we-the-rebel-alliance/${name}-plugin`, version: "1.0.0", type: "module", exports: { "./server": "./index.js" }, capabilities: value }, null, 2)}\n`,
  )
  if (options.entry !== false) {
    writeFileSync(
      join(directory, "index.js"),
      `import { defineTestPlugin } from ${JSON.stringify(support)}\nexport default defineTestPlugin(new URL(".", import.meta.url).pathname, ${JSON.stringify(options.entryOptions ?? {})})\n`,
    )
  }
  if (options.recorded !== undefined) writeFileSync(join(directory, "fixtures", "conformance.json"), `${JSON.stringify(options.recorded, null, 2)}\n`)
  if (options.skills !== false) {
    mkdirSync(join(directory, "skills", name), { recursive: true })
    writeFileSync(
      join(directory, "skills", name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${options.skillDescription ?? "Read the demo source, and pick an account. Use for demo data only."}\n---\n\n# ${name}\n\nRead with \`tools.${name}.events_list\`.\n`,
    )
  }
  if (options.docs === true) {
    mkdirSync(join(directory, "docs"), { recursive: true })
    const docs = renderGeneratedDocs(value)
    writeFileSync(join(directory, "README.md"), `# Demo\n\n<!-- generated:capabilities -->\n${docs.capabilities}\n<!-- /generated:capabilities -->\n\n<!-- generated:errors -->\n${docs.errors}\n<!-- /generated:errors -->\n`)
  }
  for (const [path, text] of Object.entries(options.extraFiles ?? {})) {
    mkdirSync(dirname(join(directory, path)), { recursive: true })
    writeFileSync(join(directory, path), text)
  }
  return directory
}

const errors = (findings: readonly { level: string }[]) => findings.filter((finding) => finding.level === "error")
const ids = (findings: readonly { id: string }[]) => findings.map((finding) => finding.id)

describe("the report", () => {
  test("a plugin that declares, records and loads cleanly has no findings", async () => {
    const report = await runConformance(plugin({ recorded: fixture() }))
    assert.deepEqual(report.findings, [])
    assert.equal(report.ok, true)
  })

  test("record: true turns the missing recordings into warnings and is still ok", async () => {
    const report = await runConformance(plugin({}), { record: true })
    assert.equal(report.ok, true)
    assert.ok(report.findings.length > 0)
    assert.deepEqual(errors(report.findings), [])
  })

  test("a manifest that does not validate is one finding per problem", async () => {
    const value = manifest()
    value.plugin.extra = true
    const report = await runConformance(plugin({ value, recorded: fixture() }))
    assert.equal(report.ok, false)
    assert.ok(ids(report.findings).includes("manifest.invalid"))
  })

  test("no host was run is a warning, and the rest still passes", async () => {
    const report = await runConformance(plugin({ recorded: fixture() }), { hosts: [] })
    assert.equal(report.ok, true)
    assert.ok(ids(report.findings).includes("T1.unchecked"))
  })
})

describe("the declaration", () => {
  test("a write verb in a read method's name is refused", async () => {
    const value = manifest((manifest) => {
      manifest.methods.create_note = { class: "read", accounts: "optional", operations: ["demo.notes.create"] }
    })
    const report = await runConformance(plugin({ value, recorded: fixture() }))
    assert.ok(ids(report.findings).includes("methods.class"))
  })

  test("a package name that does not derive from the plugin's name is refused", async () => {
    const directory = plugin({ recorded: fixture() })
    const file = join(directory, "package.json")
    const pkg = JSON.parse(readFileSync(file, "utf8"))
    pkg.name = "@example/other-plugin"
    writeFileSync(file, JSON.stringify(pkg))
    const report = await runConformance(directory)
    assert.ok(ids(report.findings).includes("names.package"))
  })

  test("a plan is a read and a commit is not", async () => {
    const value = manifest((manifest) => {
      manifest.methods.plan_send = { class: "write", plans: true, accounts: "optional" }
      manifest.methods.send_message.commits = "plan_send"
    })
    const report = await runConformance(plugin({ value, recorded: fixture() }))
    assert.ok(ids(report.findings).includes("methods.plans"))
  })

  test("options must default access to all, and their defaults must validate", async () => {
    const value = manifest((manifest) => {
      manifest.options.properties.access.default = "ask-changes"
      manifest.options.properties.region = { type: "string", default: 3 }
    })
    const report = await runConformance(plugin({ value, recorded: fixture() }))
    assert.ok(ids(report.findings).includes("options.access-default"))
    assert.ok(ids(report.findings).includes("options.defaults"))
  })
})

describe("T0", () => {
  test("the namespace line is at most 400 characters", () => {
    const value = manifest((manifest) => {
      manifest.plugin.summary = "x".repeat(401)
    })
    const findings = staticFindings(plugin({ recorded: fixture() }), value)
    assert.ok(ids(findings).includes("T0.namespace-length"))
  })

  test("a skill description over 300 characters is refused", async () => {
    const directory = plugin({ recorded: fixture(), skillDescription: "x".repeat(301) })
    assert.ok(ids(await t0(directory)).includes("T0.skill-length"))
  })

  test("no skill is a warning", async () => {
    const findings = await t0(plugin({ recorded: fixture(), skills: false }))
    assert.deepEqual(errors(findings), [])
    assert.ok(ids(findings).includes("T0.skills-missing"))
  })

  test("a text naming a tool that does not exist is refused", async () => {
    const directory = plugin({ recorded: fixture(), extraFiles: { "AGENTS.md": "Call `tools.demo.missing_method`." } })
    assert.ok(ids(await t0(directory)).includes("T0.tools"))
  })

  test("a pinned method without evidence is refused, and with evidence it is not", async () => {
    const value = manifest((manifest) => {
      manifest.methods.events_list.pinned = true
    })
    const without = await t0(plugin({ value, recorded: fixture() }))
    assert.ok(ids(without).includes("T0.pinned"))
    const withEvidence = await t0(plugin({ value, recorded: fixture((fixture) => (fixture.pinned = { events_list: "41 of 44 sessions call it" })) }))
    assert.ok(!ids(withEvidence).includes("T0.pinned"))
  })

  test("generated docs are current, and drift is refused", async () => {
    const current = await t0(plugin({ recorded: fixture(), docs: true }))
    assert.ok(!ids(current).some((id) => id.startsWith("T0.docs-")))
    const drifted = await t0(plugin({ recorded: fixture(), extraFiles: { "README.md": "<!-- generated:capabilities -->\nstale\n<!-- /generated:capabilities -->\n" } }))
    assert.ok(ids(drifted).includes("T0.docs-capabilities"))
    const unmarked = await t0(plugin({ recorded: fixture(), extraFiles: { "docs/capabilities.md": "# Capabilities\n" } }))
    assert.ok(ids(unmarked).includes("T0.docs-capabilities"))
  })

  test("a manifest that does not validate is a T0.manifest finding", async () => {
    const value = manifest()
    value.version = 2
    assert.ok(ids(await t0(plugin({ value, recorded: fixture() }))).includes("T0.manifest"))
  })
})

describe("T1", () => {
  test("a plugin loads, its doors and permissions hold, and it refuses an unsupported host", async () => {
    const directory = plugin({ recorded: fixture() })
    assert.deepEqual(await t1(directory, "2.4.1"), [])
    assert.deepEqual(await t1(directory, "2.5.0"), [])
  })

  test("a plugin id that is not the manifest's name is refused", async () => {
    const findings = await t1(plugin({ recorded: fixture(), entryOptions: { id: "other" } }), "2.4.1")
    assert.ok(ids(findings).includes("T1.id"))
  })

  test("a plugin with no permission rules is refused", async () => {
    const findings = await t1(plugin({ recorded: fixture(), entryOptions: { noRules: true } }), "2.4.1")
    assert.ok(ids(findings).includes("T1.permissions"))
  })

  test("a plugin with no tool namespace is refused", async () => {
    const findings = await t1(plugin({ recorded: fixture(), entryOptions: { noNamespace: true } }), "2.4.1")
    assert.ok(ids(findings).includes("T1.doors"))
  })

  test("LD-5: a non-read method over RPC without an answered ask is refused", async () => {
    const good = await t1(plugin({ recorded: fixture() }), "2.4.1")
    assert.ok(!ids(good).includes("T1.rpc-confirmation"))
    const bad = await t1(plugin({ recorded: fixture(), entryOptions: { uncheckedRpc: true } }), "2.4.1")
    assert.ok(ids(bad).includes("T1.rpc-confirmation"))
  })

  test("a plugin that does not refuse an unsupported host is refused", async () => {
    const findings = await t1(plugin({ recorded: fixture(), entryOptions: { refuseUntested: false } }), "2.5.0")
    assert.ok(ids(findings).includes("T1.unsupported-host"))
  })

  test("a plugin with no server entry does not load", async () => {
    const findings = await t1(plugin({ recorded: fixture(), entry: false }), "2.4.1")
    assert.ok(ids(findings).includes("T1.load"))
  })
})

describe("accounts", () => {
  test("one alias is not two-account behaviour", async () => {
    const report = await runConformance(plugin({ recorded: fixture((fixture) => (fixture.accounts.aliases = ["work"])) }))
    assert.ok(ids(report.findings).includes("accounts.aliases"))
  })

  test("the two refusals carry ACCOUNT_REQUIRED and ACCOUNT_UNKNOWN", async () => {
    const report = await runConformance(
      plugin({
        recorded: fixture((fixture) => {
          fixture.accounts.required.code = "INPUT_INVALID"
          fixture.accounts.unknown.code = "INPUT_INVALID"
        }),
      }),
    )
    assert.ok(ids(report.findings).includes("accounts.required"))
    assert.ok(ids(report.findings).includes("accounts.unknown"))
  })

  test("a cursor is bound to its account", async () => {
    const report = await runConformance(plugin({ recorded: fixture((fixture) => (fixture.accounts.cursors = [])) }))
    assert.ok(ids(report.findings).includes("accounts.cursors"))
  })

  test("a local plugin has one account", async () => {
    const value = manifest((manifest) => {
      manifest.accounts.via = "local"
    })
    const report = await runConformance(plugin({ value, recorded: fixture() }))
    assert.ok(ids(report.findings).includes("accounts.local"))
  })
})

describe("events and thumbnails", () => {
  const withThumbnails = (change: (value: any) => void = () => {}) =>
    manifest((manifest) => {
      manifest.sources[0].thumbnails = true
      manifest.sources[0].urlHosts = ["example.test"]
      change(manifest)
    })

  test("a thumbnail appears when asked, on a declared host, outside the hash", async () => {
    const value = withThumbnails()
    const directory = plugin({
      value,
      recorded: fixture((fixture) => {
        fixture.sources["demo.messages"].cases[0].input.thumbnails = true
        fixture.sources["demo.messages"].cases[0].answer = page("work", (page) => {
          page.events[0].thumbnail = "https://example.test/thumb.png"
        })
      }),
    })
    const report = await runConformance(directory)
    assert.equal(report.ok, true)
    assert.ok(!ids(report.findings).includes("pages.thumbnail"))
  })

  test("a thumbnail with a query string is refused", async () => {
    const report = await runConformance(
      plugin({
        value: withThumbnails(),
        recorded: fixture((fixture) => {
          fixture.sources["demo.messages"].cases[0].input.thumbnails = true
          fixture.sources["demo.messages"].cases[0].answer = page("work", (page) => {
            page.events[0].thumbnail = "https://example.test/thumb.png?token=1"
          })
        }),
      }),
    )
    assert.ok(ids(report.findings).includes("pages.shape"))
  })

  test("a thumbnail on a source that does not declare thumbnails is refused", async () => {
    const report = await runConformance(
      plugin({
        recorded: fixture((fixture) => {
          fixture.sources["demo.messages"].cases[0].answer = page("work", (page) => {
            page.events[0].thumbnail = "https://example.test/thumb.png"
          })
        }),
      }),
    )
    assert.ok(ids(report.findings).includes("pages.thumbnail") || ids(report.findings).includes("pages.shape"))
  })

  test("a failed entry holds the cursor back", async () => {
    const report = await runConformance(
      plugin({
        recorded: fixture((fixture) => {
          fixture.sources["demo.messages"].cases[0].answer = page("work", (page) => {
            page.failed = [{ external_id: "m-missing", code: "RATE_LIMITED" }]
            page.cursor = "another"
          })
        }),
      }),
    )
    assert.ok(ids(report.findings).includes("pages.cursor"))
  })

  test("a secret in an event is refused", async () => {
    const report = await runConformance(
      plugin({
        recorded: fixture((fixture) => {
          fixture.sources["demo.messages"].cases[0].answer = page("work", (page) => {
            const { hash, ...rest } = page.events[0]
            page.events[0] = { ...rest, text: "token ghp_0123456789abcdefghijklmnopqrstuvwxyz", hash }
          })
        }),
      }),
    )
    assert.ok(ids(report.findings).includes("pages.secrets") || ids(report.findings).includes("pages.shape"))
  })
})

describe("grants and the RPC door", () => {
  const withAction = () =>
    manifest((manifest) => {
      manifest.methods.plan_send = { class: "read", plans: true, accounts: "optional" }
      manifest.methods.send_message.commits = "plan_send"
      manifest.actions = [
        { id: "demo.messages.send", effect: "notify", preview: "plan_send", commit: "send_message", input: { type: "object" }, output: { type: "object" } },
        { id: "demo.mail.send", effect: "notify", preview: "plan_send", commit: "send_message", input: { type: "object" }, output: { type: "object" } },
      ]
    })

  test("recorded grants verify, including #40's four refusals", async () => {
    const names = ["valid", "wrong-aud", "replayed", "expired", "digest-mismatch"]
    const cases = names.map((name) => JSON.parse(readFileSync(join(here, "fixtures", "grant", `${name}.json`), "utf8")))
    const publicKey = readFileSync(join(here, "fixtures", "grant", "public-key.pem"), "utf8")
    const recorded = fixture((fixture) => {
      fixture.grants = { publicKey, cases: cases.map((entry) => ({ name: entry.name, token: entry.token, input: entry.input, request: entry.request, store: entry.store, expect: entry.expect })) }
    })
    const report = await runConformance(plugin({ value: withAction(), recorded }))
    assert.deepEqual(report.findings.filter((finding) => finding.id.startsWith("grants")), [])
  })

  test("a missing negative case is a finding", async () => {
    const cases = ["valid"].map((name) => JSON.parse(readFileSync(join(here, "fixtures", "grant", `${name}.json`), "utf8")))
    const publicKey = readFileSync(join(here, "fixtures", "grant", "public-key.pem"), "utf8")
    const recorded = fixture((fixture) => {
      fixture.grants = { publicKey, cases: cases.map((entry) => ({ name: entry.name, token: entry.token, input: entry.input, request: entry.request, store: entry.store, expect: entry.expect })) }
    })
    const report = await runConformance(plugin({ value: withAction(), recorded }))
    assert.ok(ids(report.findings).includes("grants.cases"))
  })

  test("LD-5 recorded: a non-read RPC call with the ask denied is refused", async () => {
    const report = await runConformance(
      plugin({
        recorded: fixture((fixture) => {
          fixture.rpc = { calls: [{ method: "send_message", ask: "denied", expect: { code: "UNAVAILABLE" } }] }
        }),
      }),
    )
    assert.ok(ids(report.findings).includes("rpc.confirmation"))
  })
})

describe("the manifest a report is keyed on", () => {
  test("a manifest read from disk hashes canonically, and the report uses that package", () => {
    const directory = plugin({ recorded: fixture() })
    const installed = readInstalledManifest(directory)
    assert.ok(installed.ok)
    const value = manifest()
    assert.equal(installed.value.hash, manifestHash(value))
    assert.equal(installed.value.package, "@we-the-rebel-alliance/demo-plugin")
  })
})
