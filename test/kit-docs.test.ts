import assert from "node:assert/strict"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, test } from "node:test"
import { applySection, automationsSection, docsFindings, eventsSection, generatedSections, markers, methodsSection, optionsSection, profileSection, sourcesSection } from "../src/kit/docs.ts"
import { fullPlugin, manifest } from "./support/plugin.ts"

describe("the generated doc sections", () => {
  test("methods carry class, accounts, operations, plans, commits and the pin budget", () => {
    const value = manifest({
      methods: {
        status: { class: "read", accounts: "none" },
        events_list: { class: "read", operations: ["acme.events.list"] },
        plan: { class: "read", plans: true },
        send: { class: "send", operations: ["acme.send"], commits: "plan" },
        delete_item: { class: "delete" },
        pinned_read: { class: "read", pinned: true },
      },
    })
    const text = methodsSection(value)
    assert.match(text, /\| `send` \| send \| none \| `acme.send` \| — \| `plan` \| — \|/)
    assert.match(text, /\| `plan` \| read \| none \| — \| yes \| — \| — \|/)
    assert.match(text, /\| `delete_item` \| delete \| none \| — \| — \| — \| — \|/)
    assert.match(text, /\| `pinned_read` \| read \| none \| — \| — \| — \| yes \|/)
  })

  test("sources and actions show the read's kind, output, cost, scope and details", () => {
    const value = manifest({
      sources: [
        {
          id: "acme.feed",
          kind: "events",
          reads: "message",
          method: "events_list",
          service: { id: "acme.feed", label: "Acme Feed" },
          signals: ["bus", "webhook"],
          cadence: { suggestMinutes: 5, providerMinMinutes: 2 },
          cost: { class: "billed", units: [{ per: "post", usd: 0.01 }] },
          scope: { keys: ["channels"], describe: "Channels to read." },
          details: [{ id: "acme.feed.thread", method: "status", from: ["thread"] }],
        },
        { id: "acme.inbox", kind: "snapshot", output: "x-acme/inbox", method: "status", cost: { class: "free" } },
      ],
    })
    const text = sourcesSection(value)
    assert.match(text, /`acme\.feed` \| events \| reads: `message` \| `events_list` \| `acme\.feed` \(Acme Feed\) \| `bus`, `webhook` \| 5 min \| billed \(post \$0\.01\) \| `channels` \| `acme\.feed\.thread`/)
    assert.match(text, /`acme\.inbox` \| snapshot \| output: `x-acme\/inbox`/)
    assert.match(sourcesSection(manifest({ sources: [] })), /declares no sources/)
  })

  test("events, accounts, options and automations come from the manifest", () => {
    const value = manifest({
      accounts: { via: "mcp", owner: "mailto" },
      options: {
        type: "object",
        properties: {
          access: { type: "string", enum: ["all", "ask-changes", "read-only"], default: "all", description: "How much may run." },
          accounts: {
            type: "object",
            additionalProperties: { type: "object", properties: { email: { type: "string", description: "The account's address." } }, required: ["email"] },
          },
        },
      },
    })
    assert.match(eventsSection(value), /`rpc\.acme\.changed`/)
    assert.doesNotMatch(eventsSection(value), /account/)
    assert.match(profileSection(value), /`email` \| string \| yes \| — \| The account's address\./)
    assert.match(optionsSection(value), /`access` \| `all` \\\| `ask-changes` \\\| `read-only` \| no \| `all` \| How much may run\./)
    const recipe = automationsSection(value)
    assert.match(recipe, /### `acme\.feed`/)
    assert.match(recipe, /Suggested cadence: \*\*5 min\*\*; the provider allows one read every 2 min\./)
    assert.match(recipe, /tools\.acme\.events_list\(\{ \.\.\.input, cursor: state\?\.cursor \}\)/)
    assert.match(recipe, /Signals: `bus`\./)
    assert.match(automationsSection(manifest({ sources: [] })), /no timer recipe/)
  })

  test("a section replaces only the text between its markers", () => {
    const text = "before\n<!-- kit:start:x -->\nold\n<!-- kit:end:x -->\nafter\n"
    const applied = applySection(text, "x", "new")
    assert.equal(applied.missing, undefined)
    assert.equal(applied.text, "before\n<!-- kit:start:x -->\nnew\n<!-- kit:end:x -->\nafter\n")
    assert.equal(applySection("no markers", "x", "new").missing, "start")
    assert.equal(applySection("<!-- kit:start:x -->\nold", "x", "new").missing, "end")
  })

  test("every generated section names one file and one marker pair", () => {
    const sections = generatedSections(manifest())
    assert.deepEqual(
      sections.map((section) => section.section),
      ["readme.capabilities", "readme.errors", "capabilities.methods", "capabilities.sources", "capabilities.actions", "capabilities.events", "accounts.profile", "configuration.options", "automations.events"],
    )
    for (const section of sections) {
      assert.equal(markers(section.section).start, `<!-- kit:start:${section.section} -->`)
      assert.equal(markers(section.section).end, `<!-- kit:end:${section.section} -->`)
    }
  })
})

describe("docs freshness", () => {
  test("a current plugin has no finding; a stale section and a missing marker do", async () => {
    const local = fullPlugin()
    try {
      assert.deepEqual(docsFindings(local.dir, manifest()), [])
      const file = join(local.dir, "README.md")
      writeFileSync(file, readFileSync(file, "utf8").replace("| `send`", "| `post`"))
      const stale = docsFindings(local.dir, manifest())
      assert.ok(stale.some((finding) => finding.id === "DOCS.stale" && finding.path === "README.md"))
      writeFileSync(join(local.dir, "docs", "accounts.md"), "# accounts\n")
      const missing = docsFindings(local.dir, manifest())
      assert.ok(missing.some((finding) => finding.id === "DOCS.missing-marker" && finding.path === "docs/accounts.md"))
    } finally {
      local.cleanup()
    }
  })

  test("a missing AGENTS.md section is a finding, and a missing manifest is one finding", async () => {
    const local = fullPlugin()
    try {
      const file = join(local.dir, "AGENTS.md")
      writeFileSync(file, readFileSync(file, "utf8").replace("## Layout", "## Structure"))
      assert.ok(docsFindings(local.dir, manifest()).some((finding) => finding.id === "DOCS.agents-section" && finding.path === "AGENTS.md"))
      assert.deepEqual(docsFindings(local.dir, undefined).map((finding) => finding.id), ["DOCS.manifest"])
    } finally {
      local.cleanup()
    }
  })

  test("a missing doc file fails once, not once per section", async () => {
    const local = fullPlugin()
    try {
      mkdirSync(join(local.dir, "docs"), { recursive: true })
      const file = join(local.dir, "docs", "capabilities.md")
      rmSync(file)
      const findings = docsFindings(local.dir, manifest()).filter((finding) => finding.path === "docs/capabilities.md")
      assert.deepEqual(findings.map((finding) => finding.id), ["DOCS.missing-file"])
    } finally {
      local.cleanup()
    }
  })
})
