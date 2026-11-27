import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, describe, test } from "node:test"
import * as z from "zod"
import {
  canonicalJson,
  checkManifest,
  findAction,
  findInstalledPackage,
  findMethod,
  findSource,
  manifestHash,
  manifestProblems,
  MANIFEST_SCHEMA,
  maxBytesOf,
  ownerOrgProblems,
  ownerProblems,
  readInstalledManifest,
  thumbnailUrlProblems,
} from "../src/manifest.ts"
import { installed, manifest } from "./support/manifest.ts"

const problems = (value: unknown): readonly string[] => manifestProblems(value)
const has = (value: unknown, text: string): void => {
  const found = problems(value)
  assert.ok(found.some((problem) => problem.includes(text)), `expected ${JSON.stringify(text)} in:\n${found.join("\n")}`)
}

const scratch = mkdtempSync(join(tmpdir(), "manifest-test-"))
after(() => rmSync(scratch, { recursive: true, force: true }))

/** The first problem of a refused read, or an empty string when it did not refuse. */
function firstProblem(checked: { readonly ok: boolean }): string {
  const value = checked as { ok: boolean; problems?: readonly string[] }
  return value.ok ? "" : (value.problems?.[0] ?? "")
}

describe("the manifest", () => {
  test("a complete manifest validates, and the parsed value keeps its x- keys", () => {
    const value = manifest((m) => {
      m["x-demo"] = { placement: "sidebar" }
    })
    const checked = checkManifest(value)
    assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("\n"))
    if (!checked.ok) return
    assert.equal(checked.value.plugin.name, "demo")
    assert.deepEqual(checked.value["x-demo"], { placement: "sidebar" })
    assert.equal(checked.value.methods.send_message?.class, "send")
  })

  test("refuses a version other than 1, and a plugin name with a hyphen, a capital or 32 characters", () => {
    has(manifest((m) => (m.version = 2)), "capabilities.version")
    has(manifest((m) => (m.plugin.name = "demo-app")), "capabilities.plugin.name")
    has(manifest((m) => (m.plugin.name = "Demo")), "capabilities.plugin.name")
    has(manifest((m) => (m.plugin.name = "a".repeat(32))), "capabilities.plugin.name")
  })

  test("accepts a one-letter plugin name, and keeps x- extension keys separate from account names", () => {
    const value = manifest((m) => {
      m.plugin.name = "x"
      m.sources[0].id = "x.messages"
      m.sources[1].id = "x.channels"
      m.actions[0].id = "x.messages.send"
      m["x-work"] = { placement: "sidebar" }
    })
    assert.deepEqual(problems(value), [])
    const checked = checkManifest(value)
    assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("\n"))
    if (!checked.ok) return
    assert.equal(checked.value.plugin.name, "x")
    assert.deepEqual(checked.value["x-work"], { placement: "sidebar" })
    assert.equal(checked.value.accounts?.via, "integration")
  })

  test("enforces the v0 host range and the tested release (D7)", () => {
    has(manifest((m) => (m.plugin.host.opencode = ">=2.3.0 <2.5.0")), "capabilities.plugin.host.opencode")
    has(manifest((m) => (m.plugin.host.opencode = "^2.4.1")), "capabilities.plugin.host.opencode")
    has(manifest((m) => (m.plugin.host.tested = ["2.4.0"])), "capabilities.plugin.host.tested")
    has(manifest((m) => (m.plugin.host.tested = ["2.4.1", "2.4.1"])), "capabilities.plugin.host.tested")
    assert.deepEqual(problems(manifest((m) => (m.plugin.host.tested = ["2.4.1", "2.4.2"]))), [])
  })

  test("names stray top-level keys by path, and allows only x-<app> beyond the manifest's own", () => {
    has(manifest((m) => (m.jelly = {})), "capabilities.jelly")
    has(manifest((m) => (m["x-Demo"] = {})), "capabilities.x-Demo")
    assert.deepEqual(problems(manifest((m) => (m["x-demo"] = true))), [])
  })

  test("requires one method and validates each method's class and cross-references", () => {
    has(manifest((m) => delete m.methods), "capabilities.methods")
    has(manifest((m) => (m.methods = {})), "capabilities.methods")
    has(manifest((m) => (m.methods.status.class = "destroy")), "capabilities.methods.status.class")
    has(manifest((m) => (m.methods.status.bogus = true)), "capabilities.methods.status.bogus")
    has(manifest((m) => (m.methods.send_message.commits = "no_such_method")), "capabilities.methods.send_message.commits")
    has(manifest((m) => (m.methods.send_message.commits = "status")), "does not declare plans: true")
    has(manifest((m) => (m.methods.status.commits = "status")), "a method cannot commit itself")
    has(manifest((m) => (m.methods.plan_send.commits = "send_message")), "either plans a change or commits one")
    has(manifest((m) => (m.methods.status.accounts = "required")), "capabilities.methods.status.accounts")
    has(manifest((m) => (m.methods.status.effect = "maybe")), "capabilities.methods.status.effect")
    has(manifest((m) => (m.methods.status.effect = "allow")), "capabilities.methods.status.effect")
    has(manifest((m) => (m.methods.status.agent = true)), "capabilities.methods.status.agent")
    has(manifest((m) => (m.methods.status.agent = false)), "capabilities.methods.status.agent")
    has(manifest((m) => (m.methods.status.pinned = false)), "capabilities.methods.status.pinned")
  })

  test("checks a method's name against its class (#44, linear#28)", () => {
    has(manifest((m) => (m.methods.delete_message = { class: "write" })), "a delete_* or remove_* method must be class delete")
    has(manifest((m) => (m.methods.remove_message = { class: "read" })), "a delete_* or remove_* method must be class delete")
    has(manifest((m) => (m.methods.send_digest = { class: "write" })), "a send_* or post_* method must be class send")
    has(manifest((m) => (m.methods.post_digest = { class: "read" })), "a send_* or post_* method must be class send")
    has(manifest((m) => (m.methods.share_file = { class: "write" })), "a share_* method must be class share")
    assert.deepEqual(problems(manifest((m) => (m.methods.delete_message = { class: "delete" }))), [])
    assert.deepEqual(problems(manifest((m) => (m.methods.share_file = { class: "share" }))), [])
    // A pass-through MCP tool is checked by its tool name too, after `mcp:`.
    has(manifest((m) => (m.methods["mcp:delete_message"] = { class: "read" })), "a delete_* or remove_* method must be class delete")
    assert.deepEqual(problems(manifest((m) => (m.methods["mcp:delete_message"] = { class: "delete" }))), [])
    has(manifest((m) => (m.methods["other:tool"] = { class: "read" })), "capabilities.methods.other:tool")
  })

  test("accepts vendor-cased MCP tool names and refuses malformed ones", () => {
    const jira = manifest((m) => {
      for (const [tool, methodClass] of [
        ["getJiraIssue", "read"],
        ["addOrEditJiraIssueComment", "write"],
        ["searchJiraIssuesUsingJql", "read"],
      ] as const) m.methods[`mcp:${tool}`] = { class: methodClass }
    })
    assert.deepEqual(problems(jira), [])
    has(manifest((m) => (m.methods["mcp:Bad Name"] = { class: "read" })), "capabilities.methods.mcp:Bad Name")
    has(manifest((m) => (m.methods["mcp:-x"] = { class: "read" })), "capabilities.methods.mcp:-x")
  })

  test("refuses MCP tool names that collide after OpenCode's rewrite, or differ only in case", () => {
    const both = problems(manifest((m) => {
      m.methods["mcp:files.delete"] = { class: "delete" }
      m.methods["mcp:files_delete"] = { class: "delete" }
    }))
    assert.ok(both.some((problem) => problem.startsWith("capabilities.methods.mcp:files.delete")), both.join("\n"))
    assert.ok(both.some((problem) => problem.startsWith("capabilities.methods.mcp:files_delete")), both.join("\n"))
    assert.deepEqual(problems(manifest((m) => (m.methods["mcp:files.delete"] = { class: "delete" }))), [])
    assert.deepEqual(problems(manifest((m) => (m.methods["mcp:files_delete"] = { class: "delete" }))), [])
    assert.deepEqual(problems(manifest((m) => (m.methods["mcp:*"] = { class: "read" }))), [])
    const cased = problems(manifest((m) => {
      m.methods["mcp:getIssue"] = { class: "read" }
      m.methods["mcp:GetIssue"] = { class: "read" }
    }))
    assert.ok(cased.some((problem) => problem.startsWith("capabilities.methods.mcp:getIssue") && problem.includes("collides with")), cased.join("\n"))
    assert.ok(cased.some((problem) => problem.startsWith("capabilities.methods.mcp:GetIssue") && problem.includes("collides with")), cased.join("\n"))
  })

  test("allows none or one pinned method, and none by default", () => {
    assert.deepEqual(problems(manifest()), [])
    has(manifest((m) => (m.methods.probe.pinned = true) && (m.methods.status.pinned = true)), "at most one method may be pinned")
    assert.deepEqual(problems(manifest((m) => (m.methods.events_list.pinned = true))), [])
  })

  test("accounts require their option schema, and a profile $ref into it", () => {
    has(manifest((m) => delete m.options.properties.accounts), "capabilities.options.properties.accounts")
    has(manifest((m) => delete m.options.properties.accounts.additionalProperties), "capabilities.options.properties.accounts.additionalProperties")
    has(manifest((m) => (m.accounts.profile.$ref = "#/options/properties/accounts")), "capabilities.accounts.profile.$ref")
    has(manifest((m) => (m.accounts.via = "oauth")), "capabilities.accounts.via")
    has(manifest((m) => (m.accounts.owner = "Mailto")), "capabilities.accounts.owner")
    assert.deepEqual(problems(manifest((m) => delete m.accounts.profile)), [])
  })

  test("options must be a JSON Schema object with access", () => {
    has(manifest((m) => (m.options = {})), "capabilities.options.type")
    has(manifest((m) => (m.options = { type: "string", properties: { access: {} } })), "capabilities.options.type")
    has(manifest((m) => delete m.options.properties.access), "capabilities.options.properties.access")
    has(manifest((m) => (m.options.properties.access = "all")), "capabilities.options.properties.access")
    has(manifest((m) => (m.options = { type: "nonsense" })), "capabilities.options")
  })

  test("sources: one name, a declared method, a kind's own fields, and at most 1 MB", () => {
    has(manifest((m) => (m.sources[0].id = "other.messages")), "capabilities.sources[0].id")
    has(manifest((m) => (m.sources[0].method = "no_such_method")), "capabilities.sources[0].method")
    has(manifest((m) => (m.sources[0].reads = "x-other/kind")), "capabilities.sources[0].reads")
    has(manifest((m) => (m.sources[0].maxBytes = 1_048_577)), "capabilities.sources[0].maxBytes")
    has(manifest((m) => (m.sources[0].cost = { class: "billed" })), "capabilities.sources[0].cost.units")
    has(manifest((m) => (m.sources[1].output = "weather")), "capabilities.sources[1].output")
    has(manifest((m) => (m.sources[1].output = "x-other/list")), "capabilities.sources[1].output")
    has(manifest((m) => (m.sources[1].details = m.sources[0].details)), "capabilities.sources[1].details")
    assert.deepEqual(problems(manifest((m) => (m.sources[1].output = "x-demo/list"))), [])
    assert.deepEqual(problems(manifest((m) => (m.sources[0].maxBytes = 1_048_576))), [])
  })

  test("sources: services agree on one label, and ids and detail ids are unique", () => {
    has(manifest((m) => (m.sources[1].service = { id: "demo.chat", label: "Conversation" })), "capabilities.sources[1].service.label")
    has(manifest((m) => (m.sources[1].id = "demo.messages")), '"demo.messages" is declared twice')
    has(manifest((m) => (m.sources[0].details = [m.sources[0].details[0], { ...m.sources[0].details[0] }])), "capabilities.sources[0].details")
    has(manifest((m) => (m.sources[0].details[0].method = "no_such_method")), "capabilities.sources[0].details[0].method")
    has(manifest((m) => (m.sources[0].scope.suggest.method = "no_such_method")), "capabilities.sources[0].scope.suggest.method")
    has(manifest((m) => (m.sources[0].signals = ["bus", "bus"])), "capabilities.sources[0].signals")
    has(manifest((m) => (m.sources[0].facts = ["not-a-fact"])), "capabilities.sources[0].facts")
    has(manifest((m) => (m.sources[0].hints = ["../secret.md"])), "capabilities.sources[0].hints")
    assert.deepEqual(problems(manifest((m) => (m.sources[0].service = undefined))), [])
  })

  test("thumbnails: declared only with urlHosts, and only on an events source (#42)", () => {
    has(manifest((m) => delete m.sources[0].urlHosts), "capabilities.sources[0].thumbnails")
    has(manifest((m) => (m.sources[1].thumbnails = true)), "capabilities.sources[1].thumbnails")
    has(manifest((m) => (m.sources[0].thumbnails = false)), "capabilities.sources[0].thumbnails")
    assert.deepEqual(problems(manifest((m) => (m.sources[0].thumbnails = true))), [])
  })

  test("actions: two different declared methods, and two JSON Schemas", () => {
    has(manifest((m) => (m.actions[0].id = "other.send")), "capabilities.actions[0].id")
    has(manifest((m) => (m.actions[0].preview = "send_message")), "capabilities.actions[0].commit")
    has(manifest((m) => (m.actions[0].preview = "no_such_method")), "capabilities.actions[0].preview")
    has(manifest((m) => (m.actions[0].commit = "no_such_method")), "capabilities.actions[0].commit")
    has(manifest((m) => (m.actions[0].input = "not a schema")), "capabilities.actions[0].input")
    has(manifest((m) => (m.actions[0].output = { type: "nonsense" })), "capabilities.actions[0].output")
    assert.deepEqual(problems(manifest((m) => (m.actions[0].effect = "local"))), [])
  })

  test("events declares only changed, status and account, each an empty object", () => {
    has(manifest((m) => (m.events = { changed: {}, status: {}, account: {}, other: {} })), "capabilities.events.other")
    has(manifest((m) => (m.events.status = { type: "object" })), "capabilities.events.status")
    assert.deepEqual(problems(manifest((m) => (m.events = {}))), [])
  })

  test("reports field errors, stray keys and cross-references in one pass", () => {
    const found = problems(manifest((m) => {
      m.plugin.name = "Bad-Name"
      m.stray = true
      m.sources[0].method = "no_such_method"
    }))
    assert.ok(found.some((problem) => problem.startsWith("capabilities.plugin.name:")), found.join("\n"))
    assert.ok(found.some((problem) => problem.startsWith("capabilities.stray:")), found.join("\n"))
    assert.ok(found.some((problem) => problem.startsWith("capabilities.sources[0].method:")), found.join("\n"))
  })

  test("requires status on every plugin, and probe on every plugin with accounts (§11)", () => {
    has(manifest((m) => delete m.methods.status), "capabilities.methods.status")
    assert.deepEqual(problems(manifest((m) => (m.methods.status = { class: "read" }))), [])
    has(manifest((m) => delete m.methods.probe), "capabilities.methods.probe")
    assert.deepEqual(problems(manifest((m) => { delete m.methods.probe; delete m.accounts })), [])
  })

  test("every problem names its path from capabilities, and manifestProblems returns them", () => {
    const found = problems(manifest((m) => (m.methods.send_message.class = "nope")))
    assert.ok(found.every((problem) => problem.startsWith("capabilities.")), found.join("\n"))
    assert.match(found[0] ?? "", /^capabilities\.methods\.send_message\.class: /)
  })
})

describe("canonical JSON and the manifest hash", () => {
  test("sorts keys at every depth and keeps arrays in order", () => {
    assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}')
    assert.equal(canonicalJson([{ z: 1, a: 2 }]), '[{"a":2,"z":1}]')
    assert.equal(canonicalJson({ b: undefined, a: 1 }), '{"a":1}')
    assert.equal(canonicalJson([undefined, 1]), "[null,1]")
    assert.equal(canonicalJson({ n: -0 }), '{"n":0}')
  })

  test("refuses a value JSON cannot represent", () => {
    assert.throws(() => canonicalJson({ n: Number.NaN }), /not finite/)
    assert.throws(() => canonicalJson({ n: 1n }), /bigint/)
    assert.equal(canonicalJson(undefined as never), "null")
    const cycle: Record<string, unknown> = {}
    cycle["self"] = cycle
    assert.throws(() => canonicalJson(cycle), /cycle/)
  })

  test("does not change with key order, and changes with any value", () => {
    const value = manifest()
    const reordered = JSON.parse(canonicalJson(value))
    assert.equal(manifestHash(reordered), manifestHash(value))
    assert.match(manifestHash(value), /^sha256:[0-9a-f]{64}$/)
    assert.notEqual(manifestHash(manifest((m) => (m.plugin.summary = "Another summary."))), manifestHash(value))
    assert.notEqual(manifestHash(manifest((m) => (m.sources[0].operations.push("demo.messages.delete")))), manifestHash(value))
  })

  test("a complete manifest's hash is pinned, so a change to the fixture is a change to the test", () => {
    assert.equal(manifestHash(manifest()), "sha256:6286185b6159f232427c199ca151ae96195c25d5f7c5f586f5b27dffe41ec4b8")
  })

  test("hashes a source's service, so moving one is a change for consent (D11)", () => {
    const bare = manifestHash(manifest((m) => delete m.sources[0].service))
    const gmail = manifestHash(manifest((m) => (m.sources[0].service = { id: "demo.chat", label: "Chat" })))
    const moved = manifestHash(manifest((m) => (m.sources[0].service = { id: "demo.mail", label: "Chat" })))
    const renamed = manifestHash(manifest((m) => (m.sources[0].service = { id: "demo.chat", label: "Conversation" })))
    assert.equal(new Set([bare, gmail, moved, renamed]).size, 4)
  })
})

describe("readInstalledManifest", () => {
  const write = (name: string, value: unknown): string => {
    const directory = join(scratch, name)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, "package.json"), typeof value === "string" ? value : JSON.stringify(value))
    return directory
  }

  test("reads capabilities from disk, validates and hashes it", () => {
    const value = manifest()
    const directory = write("demo", { name: "@example/demo", version: "1.0.0", capabilities: value })
    const read = readInstalledManifest(directory)
    assert.equal(read.ok, true, read.ok ? "" : read.problems.join("\n"))
    if (!read.ok) return
    assert.equal(read.value.package, "@example/demo")
    assert.equal(read.value.version, "1.0.0")
    assert.equal(read.value.hash, manifestHash(value))
    assert.equal(read.value.manifest.plugin.name, "demo")
  })

  test("refuses another version than the install names, a package with no capabilities, and no package", () => {
    const value = manifest()
    const directory = write("versioned", { name: "@example/demo", version: "1.0.0", capabilities: value })
    assert.match(firstProblem(readInstalledManifest(directory, { version: "9.9.9" })), /is version 1\.0\.0, not the 9\.9\.9/)
    const bare = write("bare", { name: "@example/bare", version: "1.0.0" })
    assert.match(firstProblem(readInstalledManifest(bare)), /declares no manifest/)
    assert.match(firstProblem(readInstalledManifest(join(scratch, "missing"))), /there is no package\.json there/)
    const broken = write("broken", "{ not json")
    assert.match(firstProblem(readInstalledManifest(broken)), /is not JSON/)
    const invalid = write("invalid", { name: "@example/demo", version: "1.0.0", capabilities: manifest((m) => (m.version = 2)) })
    assert.match(firstProblem(readInstalledManifest(invalid)), /@example\/demo 1\.0\.0: capabilities\.version/)
  })

  test("finds a package installed above a directory, as Node would", () => {
    const project = join(scratch, "project")
    const target = join(project, "node_modules", "@example", "demo")
    mkdirSync(target, { recursive: true })
    cpSync(join(scratch, "demo", "package.json"), join(target, "package.json"))
    const deep = join(project, "src", "deep")
    mkdirSync(deep, { recursive: true })
    assert.equal(findInstalledPackage("@example/demo", deep), target)
    assert.equal(findInstalledPackage("@example/none", deep), undefined)
    assert.equal(findInstalledPackage("../escape", deep), undefined)
  })
})

describe("the helpers the app-facing modules use", () => {
  test("findSource, findAction, findMethod and maxBytesOf", () => {
    const value = manifest()
    const checked = checkManifest(value)
    assert.ok(checked.ok)
    if (!checked.ok) return
    assert.equal(findSource(checked.value, "demo.messages")?.kind, "events")
    assert.equal(findSource(checked.value, "demo.none"), undefined)
    assert.equal(findAction(checked.value, "demo.messages.send")?.effect, "notify")
    assert.equal(findAction(checked.value, "demo.none"), undefined)
    assert.equal(findMethod(checked.value, "send_message")?.class, "send")
    assert.equal(maxBytesOf(findSource(checked.value, "demo.messages")!), 262_144)
    assert.equal(maxBytesOf(findSource(checked.value, "demo.channels")!), 65_536)
  })
})

describe("thumbnail URLs (#42)", () => {
  const hosts = ["files.example", "*.cdn.example"]

  test("accepts an https URL on a declared host, including a wildcard subdomain", () => {
    assert.deepEqual(thumbnailUrlProblems("https://files.example/a/b.png", hosts), [])
    assert.deepEqual(thumbnailUrlProblems("https://img.cdn.example/a.png", hosts), [])
    assert.deepEqual(thumbnailUrlProblems(`https://files.example/${"a".repeat(2_000)}`, hosts), [])
  })

  test("refuses a scheme, a query, a fragment, user info, a foreign host and a long URL", () => {
    assert.match(thumbnailUrlProblems("http://files.example/a.png", hosts).join("; "), /https/)
    assert.match(thumbnailUrlProblems("https://files.example/a.png?token=x", hosts).join("; "), /query string/)
    assert.match(thumbnailUrlProblems("https://files.example/a.png#part", hosts).join("; "), /fragment/)
    assert.match(thumbnailUrlProblems("https://user:pass@files.example/a.png", hosts).join("; "), /user info/)
    assert.match(thumbnailUrlProblems("https://evil.example/a.png", hosts).join("; "), /urlHosts/)
    assert.match(thumbnailUrlProblems(`https://files.example/${"a".repeat(2_048)}`, hosts).join("; "), /2048/)
    assert.match(thumbnailUrlProblems(null, hosts).join("; "), /non-empty https URL/)
    // A wildcard matches a subdomain, not the bare domain.
    assert.match(thumbnailUrlProblems("https://cdn.example/a.png", hosts).join("; "), /urlHosts/)
  })
})

describe("a probe owner's organizations (#44 item 2)", () => {
  const owner = {
    id: "mailto:ana@example.com",
    label: "Ana",
    orgs: [
      { id: "domain:example.com", label: "example.com" },
      { id: "slack-team:T0123", label: "Example" },
    ],
  }

  test("accepts an owner with at most five scheme-qualified organizations, and verified: false", () => {
    assert.deepEqual(ownerProblems(owner), [])
    assert.deepEqual(ownerProblems({ ...owner, verified: false }), [])
    assert.deepEqual(ownerOrgProblems(undefined), [])
    assert.deepEqual(ownerOrgProblems([]), [])
  })

  test("refuses more than five, an unqualified or repeated id, a stray field and verified: true", () => {
    const many = { id: "mailto:a@example.com", label: "A", orgs: Array.from({ length: 6 }, (_, index) => ({ id: `domain:e${index}.example`, label: `E${index}` })) }
    assert.match(ownerProblems(many).join("; "), /at most 5/)
    assert.match(ownerProblems({ ...owner, orgs: [{ id: "example.com", label: "Example" }] }).join("; "), /scheme-qualified/)
    assert.match(ownerProblems({ ...owner, orgs: [owner.orgs[0], owner.orgs[0]] }).join("; "), /repeats an organization/)
    assert.match(ownerProblems({ ...owner, orgs: [{ id: "domain:example.com", label: "Example", extra: true }] }).join("; "), /does not define/)
    assert.match(ownerProblems({ ...owner, verified: true }).join("; "), /verified must be false/)
    assert.match(ownerProblems({ id: "ana", label: "Ana" }).join("; "), /scheme-qualified/)
  })
})

describe("capabilities.errors", () => {
  const skills = { SKILLS_INVALID: { surface: "status", meaning: "a bundled skills/<id>/SKILL.md is missing or has invalid frontmatter; the plugin still starts" } }

  test("is optional, and a plugin that declares none is unchanged", () => {
    assert.deepEqual(problems(manifest()), [])
    assert.deepEqual(problems(manifest((m) => (m.errors = {}))), [])
  })

  test("accepts a plugin's own code with its surface and meaning", () => {
    const checked = checkManifest(manifest((m) => (m.errors = skills)))
    assert.ok(checked.ok)
    assert.deepEqual(checked.value.errors, skills)
  })

  test("refuses a surface, a meaning or a key the table does not define", () => {
    has(manifest((m) => (m.errors = { SKILLS_INVALID: { surface: "tool", meaning: "x" } })), "capabilities.errors.SKILLS_INVALID.surface")
    has(manifest((m) => (m.errors = { SKILLS_INVALID: { meaning: "x" } })), "capabilities.errors.SKILLS_INVALID.surface")
    has(manifest((m) => (m.errors = { SKILLS_INVALID: { surface: "status" } })), "capabilities.errors.SKILLS_INVALID.meaning")
    has(manifest((m) => (m.errors = { SKILLS_INVALID: { surface: "status", meaning: "" } })), "capabilities.errors.SKILLS_INVALID.meaning")
    has(manifest((m) => (m.errors = { SKILLS_INVALID: { surface: "status", meaning: "two\nlines" } })), "one line of plain text")
    has(manifest((m) => (m.errors = { SKILLS_INVALID: { surface: "status", meaning: "x".repeat(201) } })), "capabilities.errors.SKILLS_INVALID.meaning")
    has(manifest((m) => (m.errors = { SKILLS_INVALID: { surface: "status", meaning: "x", next: "y" } })), "capabilities.errors.SKILLS_INVALID.next")
    has(manifest((m) => (m.errors = [])), "capabilities.errors")
  })

  test("refuses a code that is not upper case, or that the contract's table holds already", () => {
    has(manifest((m) => (m.errors = { skills_invalid: skills.SKILLS_INVALID })), "capabilities.errors.skills_invalid")
    has(manifest((m) => (m.errors = { "SKILLS-INVALID": skills.SKILLS_INVALID })), "capabilities.errors.SKILLS-INVALID")
    has(manifest((m) => (m.errors = { [`A${"B".repeat(40)}`]: skills.SKILLS_INVALID })), "at most 40 characters")
    has(manifest((m) => (m.errors = { UNAVAILABLE: skills.SKILLS_INVALID })), "is in the contract's error table already")
  })

  test("is part of the hash, and the published JSON Schema accepts it", () => {
    assert.notEqual(manifestHash(manifest()), manifestHash(manifest((m) => (m.errors = skills))))
    const schema = MANIFEST_SCHEMA.jsonSchema()
    assert.ok((schema["properties"] as Record<string, unknown>)["errors"])
    assert.equal(z.fromJSONSchema(schema as never).safeParse(manifest((m) => (m.errors = skills))).success, true)
  })
})

describe("MANIFEST_SCHEMA", () => {
  test("is named capabilities and generates a JSON Schema with every top-level key", () => {
    assert.equal(MANIFEST_SCHEMA.name, "capabilities")
    const schema = MANIFEST_SCHEMA.jsonSchema()
    assert.equal(schema["type"], "object")
    const properties = schema["properties"] as Record<string, unknown>
    for (const key of ["version", "plugin", "accounts", "options", "methods", "sources", "actions", "events"]) assert.ok(properties[key], key)
  })

  test("publishes only the manifest's keys and x-<app>, and the JSON Schema itself refuses a stray key", () => {
    const schema = MANIFEST_SCHEMA.jsonSchema()
    assert.equal(schema["additionalProperties"], false)
    assert.deepEqual(schema["patternProperties"], { "^x-[a-z][a-z0-9-]*$": {} })
    const published = z.fromJSONSchema(schema as never)
    assert.equal(published.safeParse(manifest()).success, true)
    assert.equal(published.safeParse(manifest((m) => (m["x-demo"] = { placement: "sidebar" }))).success, true)
    assert.equal(published.safeParse(manifest((m) => (m["stray"] = true))).success, false)
  })

  test("parse throws one error listing every problem", () => {
    assert.throws(() => MANIFEST_SCHEMA.parse(manifest((m) => (m.methods = {}))), /capabilities\.methods/)
  })
})

describe("the installed fixture", () => {
  test("a real manifest hash is what a grant stores", () => {
    const value = installed(manifest())
    assert.equal(value.hash, manifestHash(value.manifest))
  })
})
