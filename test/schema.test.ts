import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { factProblems } from "../src/events.ts"
import { HINT_SCHEMA, ROUTINE_SCHEMA } from "../src/hints.ts"
import { SCHEMAS } from "../src/schemas.ts"
import { FACT_SCHEMAS, MAX_BYTES_DEFAULT, MAX_BYTES_LIMIT, SOURCES_SCHEMA } from "../src/schema.ts"

/** An override of `undefined` deletes the key, so "must have" cases are real absences. */
const strip = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))

const eventItem = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  strip({
    id: "gws.gmail",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "gmail" },
    accounts: { named: true },
    permission: { events: "gws.events_list", operations: ["gmail.users.messages.list", "gmail.users.messages.get"] },
    cost: { class: "free" },
    ...over,
  })

const snapshotItem = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  strip({
    id: "gws.calendar.today",
    kind: "snapshot",
    tool: "calendar_today",
    output: "agenda",
    accounts: { named: true },
    permission: { tool: "gws.calendar_today", operations: ["calendar.events.list"] },
    cost: { class: "free" },
    ...over,
  })

const declaration = (...items: Record<string, unknown>[]): Record<string, unknown> => ({ contractVersion: 1, items })
const problemsOf = (sources: unknown): readonly string[] => {
  const checked = SOURCES_SCHEMA.check(sources)
  return checked.ok ? [] : checked.problems
}

describe("the sources schema", () => {
  test("accepts an events item and a snapshot item", () => {
    assert.deepEqual(problemsOf(declaration(eventItem(), snapshotItem())), [])
  })

  test("the generated JSON Schema still expresses the rules zod writes", () => {
    const generated = SOURCES_SCHEMA.jsonSchema() as Record<string, any>
    assert.equal(generated["$schema"], "https://json-schema.org/draft/2020-12/schema")
    assert.equal(generated["additionalProperties"], false)
    assert.equal(generated["properties"]["contractVersion"]["const"], 1)
    const branches = generated["properties"]["items"]["items"]["oneOf"] as Record<string, any>[]
    assert.equal(branches.length, 2)
    const events = branches.find((branch) => branch["properties"]["kind"]["const"] === "events")
    const snapshot = branches.find((branch) => branch["properties"]["kind"]["const"] === "snapshot")
    assert.ok(events !== undefined && snapshot !== undefined)
    // An events item has no output, no maxAgeSec and no params: a property whose schema nothing matches.
    assert.deepEqual(events["properties"]["output"], { not: {} })
    assert.deepEqual(events["properties"]["maxAgeSec"], { not: {} })
    assert.deepEqual(events["properties"]["permission"]["properties"]["tool"], { not: {} })
    // A snapshot has no reads and no details.
    assert.deepEqual(snapshot["properties"]["reads"], { not: {} })
    assert.deepEqual(snapshot["properties"]["details"], { not: {} })
    assert.deepEqual(snapshot["properties"]["permission"]["properties"]["events"], { not: {} })
    assert.deepEqual(events["required"].includes("reads"), true)
    assert.deepEqual(snapshot["required"].includes("output"), true)
  })

  test("the contract version is exactly 1", () => {
    assert.ok(problemsOf({ contractVersion: 2, items: [eventItem()] }).some((problem) => /must be 1|Invalid input/.test(problem)))
    assert.ok(problemsOf({ contractVersion: "1", items: [eventItem()] }).some((problem) => /must be 1|Invalid input/.test(problem)))
  })

  test("an unknown key is refused at the top and on an item", () => {
    assert.ok(problemsOf({ contractVersion: 1, items: [eventItem()], extra: true }).length > 0)
    assert.ok(problemsOf(declaration(eventItem({ title: "Gmail" }))).some((problem) => /title/.test(problem)))
  })

  test("an item id is a dotted source id", () => {
    for (const id of ["gmail", "Gmail.mail", "gws..gmail", "gws.gmail.", "1gws.gmail"]) {
      assert.ok(problemsOf(declaration(eventItem({ id }))).length > 0, `${id} must be refused`)
    }
  })

  test("an events item reads something, and a snapshot carries no reads and no details", () => {
    assert.ok(problemsOf(declaration(eventItem({ reads: undefined }))).some((problem) => /reads/.test(problem)))
    assert.ok(problemsOf(declaration(eventItem({ output: "agenda" }))).some((problem) => /output/.test(problem)))
    assert.ok(problemsOf(declaration(eventItem({ maxAgeSec: 900 }))).some((problem) => /maxAgeSec/.test(problem)))
    assert.ok(problemsOf(declaration(eventItem({ params: {} }))).some((problem) => /params/.test(problem)))
    assert.ok(problemsOf(declaration(snapshotItem({ reads: "message" }))).some((problem) => /reads/.test(problem)))
    assert.ok(problemsOf(declaration(snapshotItem({ details: [] }))).some((problem) => /details/.test(problem)))
  })

  test("a snapshot output names a schema in the registry", () => {
    assert.ok(problemsOf(declaration(snapshotItem({ output: undefined }))).some((problem) => /output/.test(problem)))
    assert.ok(problemsOf(declaration(snapshotItem({ output: "Spreadsheet" }))).some((problem) => /output|lowercase name/.test(problem)))
    assert.deepEqual(problemsOf(declaration(snapshotItem({ output: "table" }))), [])
  })

  test("permission operations are required, and the action matches the kind", () => {
    assert.ok(problemsOf(declaration(eventItem({ permission: { events: "gws.events_list" } }))).some((problem) => /operations/.test(problem)))
    assert.ok(problemsOf(declaration(eventItem({ permission: { operations: [] } }))).some((problem) => /operations|at least/.test(problem)))
    assert.ok(problemsOf(declaration(eventItem({ permission: { operations: ["gmail.users.messages.list"] } }))).some((problem) => /events/.test(problem)))
    assert.ok(problemsOf(declaration(eventItem({ permission: { events: "gws.events_list", tool: "gws.read", operations: ["a.b.c.get"] } }))).some((problem) => /tool/.test(problem)))
    assert.ok(problemsOf(declaration(snapshotItem({ permission: { operations: ["calendar.events.list"] } }))).some((problem) => /tool/.test(problem)))
    assert.ok(problemsOf(declaration(snapshotItem({ permission: { events: "gws.events_list", operations: ["calendar.events.list"] } }))).some((problem) => /events/.test(problem)))
  })

  test("an action is dotted or a namespaced tool action", () => {
    assert.ok(problemsOf(declaration(eventItem({ permission: { events: "eventslist", operations: ["a.b.c.get"] } }))).some((problem) => /action|match/.test(problem)))
    assert.deepEqual(problemsOf(declaration(eventItem({ permission: { events: "slack_events_list", operations: ["a.b.c.get"] } }))), [])
  })

  test("a price may state a condition and the lowest rate that applies", () => {
    const units = (unit: unknown): readonly string[] => problemsOf(declaration(eventItem({ cost: { class: "metered", units: [unit] } })))
    assert.deepEqual(units({ per: "post", usd: 0.005, conditions: "X app owners only", min: 0.001 }), [])
    assert.deepEqual(units({ per: "post", usd: 0.005, min: 0.005 }), [])
    assert.deepEqual(units({ per: "post", usd: 0.005, conditions: "X app owners only" }), [])
    assert.ok(units({ per: "post", usd: 0.005, conditions: "" }).length > 0)
    assert.ok(units({ per: "post", usd: 0.005, conditions: "a".repeat(201) }).length > 0)
    assert.ok(units({ per: "post", usd: 0.005, min: -0.001 }).length > 0)
    assert.ok(units({ per: "post", usd: 0.005, min: 0.01 }).length > 0)
  })

  test("cost states a class, and a billed source states its units and probe cost", () => {
    assert.ok(problemsOf(declaration(eventItem({ cost: { class: "expensive" } }))).some((problem) => /free, metered or billed|one of/.test(problem)))
    assert.ok(problemsOf(declaration(eventItem({ cost: { class: "billed" } }))).some((problem) => /units/.test(problem)))
    assert.ok(problemsOf(declaration(eventItem({ cost: { class: "billed", units: [{ per: "post", usd: 0.005 }] } }))).some((problem) => /probe/.test(problem)))
    assert.ok(problemsOf(declaration(eventItem({ cost: { class: "free", units: [{ per: "post", usd: 0.005 }] } }))).some((problem) => /free/.test(problem)))
    assert.deepEqual(problemsOf(declaration(eventItem({ cost: { class: "billed", units: [{ per: "post", usd: 0.005 }], probe: { per: "call", usd: 0.01 } } }))), [])
    assert.ok(problemsOf(declaration(eventItem({ cost: { class: "metered", probe: { per: "call", usd: 0.01 } } }))).some((problem) => /units/.test(problem)))
  })

  test("maxBytes defaults to 64 KB and never exceeds 1 MB", () => {
    assert.equal(MAX_BYTES_DEFAULT, 65536)
    assert.equal(MAX_BYTES_LIMIT, 1048576)
    assert.ok(problemsOf(declaration(eventItem({ maxBytes: MAX_BYTES_LIMIT + 1 }))).length > 0)
    assert.deepEqual(problemsOf(declaration(eventItem({ maxBytes: 1 }))), [])
    assert.deepEqual(problemsOf(declaration(eventItem({ maxBytes: MAX_BYTES_LIMIT }))), [])
  })

  test("permission.readsIdentity is a boolean, and absent by default", () => {
    const item = (readsIdentity: unknown): readonly string[] =>
      problemsOf(declaration(eventItem({ permission: { events: "gws.events_list", operations: ["gmail.users.getProfile"], readsIdentity } })))
    assert.deepEqual(item(true), [])
    assert.deepEqual(item(false), [])
    assert.deepEqual(item(undefined), [])
    assert.ok(item("true").length > 0)
  })

  test("permission.identity may be empty: the probe asserts only its action", () => {
    const item = (identity: unknown): readonly string[] =>
      problemsOf(declaration(eventItem({ permission: { events: "gws.events_list", operations: ["gmail.users.messages.list"], identity } })))
    assert.deepEqual(item([]), [])
    assert.deepEqual(item(undefined), [])
    assert.ok(item([""]).length > 0)
  })

  test("details carry an id, a tool and event field names only", () => {
    const withDetails = (details: unknown): readonly string[] => problemsOf(declaration(eventItem({ details })))
    assert.deepEqual(withDetails([{ id: "slack.workspace.thread", tool: "slack_read_thread", from: ["thread"] }]), [])
    assert.ok(withDetails([{ id: "slack.workspace.thread", tool: "slack_read_thread", from: [] }]).length > 0)
    assert.ok(withDetails([{ id: "slack.workspace.thread", tool: "slack_read_thread" }]).some((problem) => /from/.test(problem)))
    for (const field of ["title", "text", "body", "message_ts"]) {
      assert.ok(withDetails([{ id: "slack.workspace.thread", tool: "slack_read_thread", from: [field] }]).length > 0, `${field} must be refused`)
    }
  })

  test("scope names its keys and the sentence a person confirms", () => {
    const withScope = (scope: unknown): readonly string[] => problemsOf(declaration(eventItem({ scope })))
    assert.deepEqual(withScope({ keys: ["channels", "labels"], describe: "Which conversations" }), [])
    assert.deepEqual(withScope({ keys: [], describe: "Nothing to choose" }), [])
    assert.ok(withScope({ keys: ["Channels"], describe: "Which" }).length > 0)
    assert.ok(withScope({ keys: ["channels"] }).some((problem) => /describe/.test(problem)))
    assert.ok(withScope({ keys: ["channels"], describe: "Which", extra: true }).length > 0)
    assert.deepEqual(withScope({ keys: ["channels"], describe: "Which", suggest: { tool: "slack_list_user_channels", operations: ["slack_list_user_channels"] } }), [])
    assert.ok(withScope({ keys: ["channels"], describe: "Which", suggest: "slack_list_user_channels" }).length > 0)
    assert.ok(withScope({ keys: ["channels"], describe: "Which", suggest: { tool: "List Channels", operations: ["slack_list_user_channels"] } }).length > 0)
  })

  test("urlHosts is a list of host patterns", () => {
    assert.deepEqual(problemsOf(declaration(eventItem({ urlHosts: ["slack.com", "*.slack-edge.com"] }))), [])
    assert.ok(problemsOf(declaration(eventItem({ urlHosts: "slack.com" }))).some((problem) => /array/.test(problem)))
    assert.ok(problemsOf(declaration(eventItem({ urlHosts: ["https://slack.com/"] }))).length > 0)
    assert.ok(problemsOf(declaration(eventItem({ urlHosts: ["a".repeat(300)] }))).some((problem) => /253/.test(problem)))
  })

  test("accounts, cadence, retention and params keep their shapes", () => {
    assert.deepEqual(problemsOf(declaration(eventItem({ accounts: undefined }))), [])
    assert.ok(problemsOf(declaration(eventItem({ accounts: { named: "yes" } }))).length > 0)
    assert.deepEqual(problemsOf(declaration(eventItem({ cadence: { providerMinMinutes: 15 }, retentionDays: 30 }))), [])
    assert.ok(problemsOf(declaration(eventItem({ cadence: { providerMinMinutes: 0 } }))).length > 0)
    assert.ok(problemsOf(declaration(eventItem({ cadence: { everyMinutes: 30 } }))).length > 0)
    assert.ok(problemsOf(declaration(eventItem({ params: "x" }))).length > 0)
    assert.deepEqual(problemsOf(declaration(snapshotItem({ maxAgeSec: 900, params: { window: { relative: true } } }))), [])
  })
})

describe("a source that declares facts, hints and routines (#45)", () => {
  const facts = (value: unknown): readonly string[] => problemsOf(declaration(eventItem({ facts: value })))
  const files = (key: "hints" | "routines", value: unknown): readonly string[] => problemsOf(declaration(eventItem({ [key]: value })))

  test("facts are declared by type, from the three core types, on an events source only", () => {
    assert.deepEqual(facts(["commitment"]), [])
    assert.deepEqual(facts(["commitment", "person.attribute", "meeting.attended"]), [])
    assert.ok(facts(["decision"]).some((problem) => /commitment, person\.attribute, meeting\.attended/.test(problem)))
    assert.ok(facts(["x-demo/guess"]).length > 0)
    assert.ok(facts([]).length > 0)
    assert.ok(problemsOf(declaration(snapshotItem({ facts: ["commitment"] }))).length > 0)
  })

  test("hint and routine paths are relative Markdown files", () => {
    assert.deepEqual(files("hints", ["hints/mail.md"]), [])
    assert.deepEqual(files("routines", ["routines/meeting-actions.md"]), [])
    for (const refused of ["hints/mail.txt", "/hints/mail.md", "../mail.md", "hints/../mail.md", "", "hints\\mail.md"]) {
      assert.ok(files("hints", [refused]).length > 0, `${refused} must be refused`)
      assert.ok(files("routines", [refused]).length > 0, `${refused} must be refused`)
    }
    assert.ok(files("hints", "hints/mail.md").length > 0)
    assert.ok(files("hints", []).length > 0)
    assert.ok(files("hints", [`hints/${"a".repeat(200)}.md`]).length > 0)
  })

  test("nothing else changes: an item without them still validates, and an unknown key is still refused", () => {
    assert.deepEqual(problemsOf(declaration(eventItem())), [])
    assert.ok(problemsOf(declaration(eventItem({ hint: "hints/mail.md" }))).some((problem) => /hint/.test(problem)))
  })

  test("the generated JSON Schema carries the three keys", () => {
    const generated = SOURCES_SCHEMA.jsonSchema() as Record<string, any>
    const branches = generated["properties"]["items"]["items"]["oneOf"] as Record<string, any>[]
    const events = branches.find((branch) => branch["properties"]["kind"]["const"] === "events")
    const snapshot = branches.find((branch) => branch["properties"]["kind"]["const"] === "snapshot")
    assert.ok(events !== undefined && snapshot !== undefined)
    assert.deepEqual(events["properties"]["facts"]["items"]["enum"], ["commitment", "person.attribute", "meeting.attended"])
    assert.equal(events["properties"]["hints"]["items"]["type"], "string")
    assert.equal(events["properties"]["routines"]["items"]["type"], "string")
    // A snapshot carries hints and routines, and no facts: a snapshot has no events to derive one from.
    assert.deepEqual(snapshot["properties"]["facts"], { not: {} })
    assert.equal(snapshot["properties"]["hints"]["items"]["type"], "string")
  })
})

describe("the v0.3 schemas (#45 §8)", () => {
  test("every new schema is published, by the name its file takes", () => {
    const names = SCHEMAS.map((schema) => schema.name)
    for (const name of ["fact.commitment", "fact.person.attribute", "fact.meeting.attended", "hint", "routine"]) {
      assert.ok(names.includes(name), `${name} is not one of the published schemas`)
    }
  })

  test("each fact schema is closed, and agrees with the check a page makes", () => {
    assert.deepEqual(Object.keys(FACT_SCHEMAS), ["commitment", "person.attribute", "meeting.attended"])
    for (const [name, schema] of Object.entries(FACT_SCHEMAS)) {
      assert.equal(schema.jsonSchema()["additionalProperties"], false, name)
    }
    const actors = new Set(["slack:U01", "slack:U02"])
    const cases: readonly (readonly [Record<string, unknown>, boolean])[] = [
      [{ type: "commitment", key: "issue-42", title: "Send the report", owner: "slack:U01", state: "open" }, true],
      [{ type: "commitment", key: "issue-42", title: "Send the report", owner: "slack:U01", state: "open", due: "2026-11-30", url: "https://example.com/x", counterparty: "slack:U02" }, true],
      [{ type: "commitment", key: "issue-42", title: "Send the report", owner: "slack:U01" }, false],
      [{ type: "commitment", key: "issue-42", title: "Send the report", owner: "slack:U01", state: "open", due: "30 November" }, false],
      [{ type: "commitment", key: "issue-42", title: "Send the report", owner: "slack:U01", state: "open", url: "http://example.com" }, false],
      [{ type: "commitment", key: "issue-42", title: "Send the report", owner: "slack:U01", state: "open", version: "0.3.0" }, false],
      [{ type: "person.attribute", actor: "slack:U01", org: "Example" }, true],
      [{ type: "person.attribute", actor: "slack:U01" }, false],
      [{ type: "person.attribute", actor: "slack:U01", team: "a".repeat(121) }, false],
      [{ type: "meeting.attended", actor: "slack:U01", response: "needs_action", organizer: false }, true],
      [{ type: "meeting.attended", actor: "slack:U01", response: "accepted" }, false],
      [{ type: "meeting.attended", actor: "slack:U01", response: "maybe", organizer: true }, false],
    ]
    for (const [fact, ok] of cases) {
      const label = JSON.stringify(fact)
      assert.equal(FACT_SCHEMAS[fact["type"] as keyof typeof FACT_SCHEMAS].check(fact).ok, ok, label)
      assert.equal(factProblems(fact, actors).length === 0, ok, label)
    }
    // The one rule a schema cannot carry: an actor reference names an actor on the same event.
    assert.equal(factProblems({ type: "commitment", key: "k", title: "t", owner: "slack:nobody", state: "open" }, actors).length, 1)
    assert.equal(FACT_SCHEMAS["commitment"]!.check({ type: "commitment", key: "k", title: "t", owner: "slack:nobody", state: "open" }).ok, true)
  })

  test("the hint and routine schemas are the ones a file is checked with", () => {
    assert.equal(HINT_SCHEMA.name, "hint")
    assert.equal(ROUTINE_SCHEMA.name, "routine")
    assert.equal(HINT_SCHEMA.check({ source: "granola.meetings", kinds: ["meeting"] }).ok, true)
    assert.equal(ROUTINE_SCHEMA.check({ id: "a", title: "b", reads: { sources: ["granola.meetings"], kinds: ["meeting"] }, produces: [] }).ok, false)
  })
})
