// The review's cases, one test per finding: every check the reviewer defeated, and every false refusal.
import assert from "node:assert/strict"
import { validPage } from "./support/valid-page.ts"
import { readFileSync } from "node:fs"
import { describe, test } from "node:test"
import { SOURCES_SCHEMA } from "../src/schema.ts"
import {
  declarationProblems,
  nameProblem,
  operationProblem,
  pageProblems,
  sourceConformance,
  urlHostProblem,
  type ConformanceCalls,
  type ToolDeclaration,
} from "../src/conformance.ts"

const PLUGIN = "@joe-broadhead/opencode-slack"
const ACCOUNT = "T0PILOT01"
const ISO = "2026-11-13T09:00:00.000Z"

const problemsOf = (sources: unknown): readonly string[] => {
  const checked = SOURCES_SCHEMA.check(sources)
  return checked.ok ? [] : checked.problems
}
const declarationOf = (item: Record<string, unknown>): { contractVersion: 1; items: Record<string, unknown>[] } => ({ contractVersion: 1, items: [item] })
const sourceOf = (item: Record<string, unknown>): never => {
  const checked = SOURCES_SCHEMA.check(declarationOf(item))
  if (!checked.ok) throw new Error(checked.problems.join("; "))
  return checked.value.items[0] as never
}

// §2.2's three items, verbatim from design comment index 4. The X item has no `accounts`, and each has a `cost`.
const designItems = (): Record<string, unknown>[] => [
  {
    id: "gws.gmail",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "gmail" },
    accounts: { named: true },
    scope: { keys: ["label"], describe: "Which labels" },
    details: [{ id: "gws.gmail.message", tool: "read", from: ["external_id"] }],
    permission: { events: "gws.events_list", operations: ["gmail.users.history.list", "gmail.users.messages.list", "gmail.users.messages.get"] },
    private: true,
    cost: { class: "free" },
    maxBytes: 262144,
    retentionDays: 30,
  },
  {
    id: "gws.calendar.today",
    kind: "snapshot",
    tool: "calendar_today",
    output: "agenda",
    params: { window: { relative: true } },
    accounts: { named: true },
    permission: { tool: "gws.calendar_today", operations: ["calendar.events.list"] },
    private: true,
    cost: { class: "free" },
    maxAgeSec: 900,
    maxBytes: 65536,
  },
  {
    id: "x.mentions",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "mentions" },
    permission: { events: "x.events_list", operations: ["x.users.mentions"] },
    cost: { class: "billed", units: [{ per: "post", usd: 0.005 }, { per: "author", usd: 0.01 }], probe: { per: "call", usd: 0.01 } },
    cadence: { providerMinMinutes: 15 },
  },
]

describe("the required fields of §2.2", () => {
  test("the design's three items validate verbatim, and accounts is optional", () => {
    assert.deepEqual(problemsOf({ contractVersion: 1, items: designItems() }), [])
  })

  test("a source without accounts validates", () => {
    const item = { ...(designItems()[2] as Record<string, unknown>) }
    assert.deepEqual(problemsOf(declarationOf(item)), [])
  })
})

describe("the cost rules are in the generated JSON Schema", () => {
  const costBranches = (): Record<string, any>[] => {
    const generated = SOURCES_SCHEMA.jsonSchema() as Record<string, any>
    const branches = generated["properties"]["items"]["items"]["oneOf"] as Record<string, any>[]
    const events = branches.find((branch) => branch["properties"]["kind"]["const"] === "events")
    if (events === undefined) throw new Error("the generated schema has no events branch")
    return events["properties"]["cost"]["oneOf"] as Record<string, any>[]
  }

  test("cost is a union of free, metered and billed, each with what it requires", () => {
    const branches = costBranches()
    assert.equal(branches.length, 3)
    const byClass = Object.fromEntries(branches.map((branch) => [branch["properties"]["class"]["const"], branch]))
    assert.deepEqual(byClass["free"]["properties"]["units"], { not: {} })
    assert.deepEqual(byClass["free"]["properties"]["probe"], { not: {} })
    assert.ok(byClass["billed"]["required"].includes("units") && byClass["billed"]["required"].includes("probe"))
    assert.ok(byClass["metered"]["required"].includes("units"))
    assert.equal(byClass["metered"]["required"].includes("probe"), false)
  })

  test("a price may carry a consent condition and a minimum rate", () => {
    const metered = costBranches().find((branch) => branch["properties"]["class"]["const"] === "metered")
    if (metered === undefined) throw new Error("the generated schema has no metered branch")
    const unit = metered["properties"]["units"]["items"]
    assert.equal(unit["properties"]["conditions"]["maxLength"], 200)
    assert.equal(unit["properties"]["min"]["minimum"], 0)
    assert.equal((unit["required"] as string[]).includes("conditions"), false)
    assert.equal((unit["required"] as string[]).includes("min"), false)
  })

  test("the schema refuses the cost shapes the rule refused", () => {
    assert.ok(problemsOf(declarationOf({ ...(designItems()[2] as Record<string, unknown>), cost: { class: "billed", units: [{ per: "post", usd: 1 }] } })).length > 0)
    assert.ok(problemsOf(declarationOf({ ...(designItems()[2] as Record<string, unknown>), cost: { class: "free", units: [{ per: "post", usd: 1 }] } })).length > 0)
  })
})

describe("the limits §2.2 does not state", () => {
  test("maxBytes shows its default and keeps the 1 MB ceiling", () => {
    const generated = SOURCES_SCHEMA.jsonSchema() as Record<string, any>
    const branches = generated["properties"]["items"]["items"]["oneOf"] as Record<string, any>[]
    const events = branches.find((branch) => branch["properties"]["kind"]["const"] === "events")
    if (events === undefined) throw new Error("the generated schema has no events branch")
    assert.equal(events["properties"]["maxBytes"]["default"], 65536)
    assert.equal(events["properties"]["maxBytes"]["maximum"], 1048576)
    assert.notEqual(events["properties"]["maxBytes"]["minimum"], 1024)
    // A declaration may omit it: the default is an annotation, never a required key.
    assert.equal((events["required"] as string[]).includes("maxBytes"), false)
  })

  test("a page under 1024 bytes is not refused, and maxAgeSec, retentionDays and usd have no ceiling", () => {
    const item = designItems()[0] as Record<string, unknown>
    assert.deepEqual(problemsOf(declarationOf({ ...item, maxBytes: 1 })), [])
    assert.deepEqual(problemsOf(declarationOf({ ...item, retentionDays: 4000 })), [])
    assert.deepEqual(problemsOf(declarationOf({ ...(designItems()[1] as Record<string, unknown>), maxAgeSec: 999999 })), [])
    assert.deepEqual(
      problemsOf(declarationOf({ ...(designItems()[2] as Record<string, unknown>), cost: { class: "billed", units: [{ per: "post", usd: 500 }], probe: { per: "call", usd: 1 } } })),
      [],
    )
  })
})

describe("output names a schema, and the registry is the app's", () => {
  test("any name validates, and the registry's names are not copied here", () => {
    assert.deepEqual(problemsOf(declarationOf({ ...(designItems()[1] as Record<string, unknown>), output: "futureschema" })), [])
    assert.ok(problemsOf(declarationOf({ ...(designItems()[1] as Record<string, unknown>), output: "Not A Name" })).length > 0)
  })
})

describe("names and verbs, tokenised", () => {
  test("a read verb in the name, wherever it sits, is accepted", () => {
    for (const name of ["get_issue", "batchGet", "events_list", "calendar_today", "read", "slack_read_channel", "slack_list_user_channels", "list_deleted_items"]) {
      assert.equal(nameProblem(name), undefined, name)
    }
    for (const operation of ["calendar.events.instances", "drive.files.export", "gmail.users.messages.batchGet", "gmail.users.messages.get", "slack_read_channel", "slack_list_user_channels"]) {
      assert.equal(operationProblem(operation), undefined, operation)
    }
  })

  test("a write verb in the verb position is refused", () => {
    for (const name of ["send_message", "delete_issue", "slack_send_message", "messages_send", "post_status"]) {
      assert.match(String(nameProblem(name)), /write verb|not a read verb/, name)
    }
    for (const operation of ["gmail.users.messages.send", "gmail.users.messages.insert", "gmail.users.messages.batchModify", "calendar.events.quickAdd", "gmail.users.messages.emptyTrash", "gmail.users.messages.untrash", "calendar.events.watch", "slack_send_message"]) {
      assert.ok(operationProblem(operation) !== undefined, operation)
    }
  })

  test("a compound is refused", () => {
    for (const name of ["getAndSend", "get_and_send", "readThenDelete", "list_and_delete"]) {
      assert.match(String(nameProblem(name)), /joins two actions/, name)
    }
  })

  test("a write verb in a non-verb position is fine", () => {
    assert.equal(nameProblem("get_issue"), undefined)
    assert.equal(nameProblem("list_deleted_items"), undefined)
  })
})

describe("scope.suggest keeps its own operations out of the running grant", () => {
  const suggested = (over: Record<string, unknown> = {}): Record<string, unknown> => validPage({
    id: "slack.workspace",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "slack" },
    accounts: { named: false },
    scope: { keys: ["channels"], describe: "Channels", suggest: { tool: "slack_list_user_channels", operations: ["slack_list_user_channels"] } },
    permission: { events: "slack_events_list", operations: ["slack_read_user_profile", "slack_read_channel"] },
    cost: { class: "free" },
    ...over,
  })
  const tools: ToolDeclaration[] = [
    { id: "events_list", readOnly: true },
    { id: "slack_list_user_channels", readOnly: true },
  ]

  test("a suggest object validates, and its operations are never in the running grant", () => {
    assert.deepEqual(problemsOf(declarationOf(suggested())), [])
    const both = suggested({ permission: { events: "slack_events_list", operations: ["slack_read_channel", "slack_list_user_channels"] } })
    assert.ok(declarationProblems(declarationOf(both), { tools }).some((problem) => /scope.suggest.*operations.*permission\.operations|must not appear/.test(problem)))
  })

  test("suggest must name a declared read-only tool", () => {
    assert.ok(declarationProblems(declarationOf(suggested()), { tools: [{ id: "events_list", readOnly: true }, { id: "slack_list_user_channels", readOnly: false }] }).some((problem) => /readOnly/.test(problem)))
    assert.ok(declarationProblems(declarationOf(suggested()), { tools: [{ id: "events_list", readOnly: true }] }).some((problem) => /does not declare/.test(problem)))
  })
})

describe("urlHosts uses the full Public Suffix List", () => {
  test("private-section and ICANN suffixes are refused", () => {
    for (const host of ["*.blogspot.co.uk", "*.uk.com", "*.ondigitalocean.app", "*.co.uk", "co.uk", "*.github.io", "*.com"]) {
      assert.ok(urlHostProblem(host) !== null, host)
    }
    for (const host of ["files.example.co.uk", "*.example.co.uk", "slack.com", "*.slack.com", "mail.google.com"]) {
      assert.equal(urlHostProblem(host), null, host)
    }
  })
})

describe("a report is incomplete when a check did not run", () => {
  const item = (): Record<string, unknown> => validPage({
    id: "slack.workspace",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "slack" },
    accounts: { named: false },
    permission: { events: "slack_events_list", operations: ["slack_slack_read_channel", "slack_slack_read_user_profile"] },
    cost: { class: "free" },
  })

  test("a source with no cases is incomplete, and not ok", async () => {
    const calls: ConformanceCalls = {
      probe: async (input, context) => {
        await context.permission.assert({ action: "slack_events_list" })
        await context.permission.assert({ action: "slack_slack_read_user_profile" })
        return { source: "slack", account: (input as { account: string }).account, owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted" }
      },
    }
    const report = await sourceConformance({
      plugin: PLUGIN,
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }],
      calls,
      identityOperations: ["slack_read_user_profile"],
    })
    assert.equal(report.ok, false)
    assert.equal(report.incomplete, true)
    assert.ok(report.checks.some((check) => check.name === "page-result" && check.ran === false && check.notApplicable === false))
  })

  test("a snapshot's unused grants still run, and a source that asserts only its action is incomplete", async () => {
    const snapshot: Record<string, unknown> = {
      id: "gws.calendar.today",
      kind: "snapshot",
      tool: "calendar_today",
      output: "agenda",
      permission: { tool: "gws.calendar_today", operations: ["calendar.events.list"] },
      cost: { class: "free" },
    }
    const report = await sourceConformance({
      plugin: "@joe-broadhead/opencode-gws",
      source: sourceOf(snapshot),
      tools: [{ id: "calendar_today", readOnly: true }],
      calls: {
        probe: async (input, context) => {
          await context.permission.assert({ action: "gws.calendar_today" })
          return { source: "slack", account: (input as { account: string }).account, owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted" }
        },
        snapshot: async (_input, context) => {
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:calendar.events.list"] })
          return { data: {}, asOf: ISO }
        },
      },
      snapshotCases: [{ window: "today" }],
    })
    assert.equal(report.ok, true, report.problems.join("; "))
    assert.equal(report.checks.find((check) => check.name === "unused-grants")?.ran, true)
  })
})

describe("probe may assert only the identity operations", () => {
  const item = (): Record<string, unknown> => validPage({
    id: "gws.gmail",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "gws" },
    accounts: { named: true },
    permission: { events: "gws.events_list", operations: ["gmail.users.getProfile", "gmail.users.messages.list"] },
    cost: { class: "free" },
  })
  const page = (): Record<string, unknown> => validPage({
    source: "gws",
    plugin: "@joe-broadhead/opencode-gws",
    account: "sam.rivera@example.com",
    owner: null,
    asOf: ISO,
    trust: "untrusted",
    events: [],
    cursor: "c1",
    more: false,
    refused: [],
    failed: [],
  })

  const run = (probeAction: string, probeResource: string) =>
    sourceConformance({
      plugin: "@joe-broadhead/opencode-gws",
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }],
      identityOperations: ["gmail.users.getProfile"],
      cases: [{ name: "a page", input: { account: "sam.rivera@example.com" } }],
      calls: {
        list: async (_input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.messages.list"] })
          return page()
        },
        probe: async (input, context) => {
          await context.permission.assert({ action: probeAction, resources: [probeResource] })
          return { source: "gws", account: (input as { account: string }).account, owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted" }
        },
      },
    })

  test("a probe that reads the profile passes, and one that reads messages fails", async () => {
    const good = await run("gws.read", "sam.rivera@example.com:gmail.users.getProfile")
    assert.deepEqual(good.problems, [], good.problems.join("; "))
    const bad = await run("gws.read", "sam.rivera@example.com:gmail.users.messages.list")
    assert.ok(bad.problems.some((problem) => /probe.*messages\.list.*not an identity operation/.test(problem)), bad.problems.join("; "))
  })
})

describe("details must refuse an event outside the confirmed scope", () => {
  const item = (): Record<string, unknown> => validPage({
    id: "slack.workspace",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "slack" },
    accounts: { named: false },
    scope: { keys: ["channels"], describe: "Channels" },
    details: [{ id: "slack.workspace.thread", tool: "slack_read_thread", from: ["thread"] }],
    permission: { events: "slack_events_list", operations: ["slack_read_user_profile", "slack_read_channel", "slack_read_thread"] },
    cost: { class: "free" },
  })
  const page = (): Record<string, unknown> => validPage({
    source: "slack",
    plugin: PLUGIN,
    account: ACCOUNT,
    owner: null,
    asOf: ISO,
    trust: "untrusted",
    events: [],
    cursor: "c1",
    more: false,
    refused: [],
    failed: [],
  })
  const run = (refuseOutside: boolean) =>
    sourceConformance({
      plugin: PLUGIN,
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }, { id: "slack_read_thread", readOnly: true }],
      identityOperations: ["slack_read_user_profile"],
      cases: [{ name: "a page", input: {} }],
      detailCases: [
        { id: "slack.workspace.thread", scope: { channels: ["C0PILOT001"] }, event: { thread: "slack-thread:C0PILOT001:1" } },
        { id: "slack.workspace.thread", scope: { channels: ["C0PILOT001"] }, event: { thread: "slack-thread:C0PILOT003:1" }, expect: { refuses: "PERMISSION_DENIED" } },
      ],
      calls: {
        list: async (_input, context) => {
          await context.permission.assert({ action: "slack_events_list" })
          await context.permission.assert({ action: "slack_slack_read_channel" })
          return page()
        },
        probe: async (input, context) => {
          await context.permission.assert({ action: "slack_events_list" })
          await context.permission.assert({ action: "slack_slack_read_user_profile" })
          return { source: "slack", account: (input as { account: string }).account, owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted" }
        },
        details: {
          "slack.workspace.thread": async (input, context) => {
            if (input.fields["thread"] === "slack-thread:C0PILOT003:1") {
              if (refuseOutside) throw new Error("PERMISSION_DENIED: that thread is in a channel nobody confirmed. Next step: confirm the channel it belongs to.")
              return page()
            }
            await context.permission.assert({ action: "slack_slack_read_thread" })
            return page()
          },
        },
      },
    })

  test("the out-of-scope call must be refused, and the in-scope call must succeed", async () => {
    const good = await run(true)
    assert.deepEqual(good.problems, [], good.problems.join("; "))
    const bad = await run(false)
    assert.ok(bad.problems.some((problem) => /outside the confirmed scope.*must be refused/.test(problem)), bad.problems.join("; "))
  })

  test("a detail with no out-of-scope case is incomplete", async () => {
    const report = await sourceConformance({
      plugin: PLUGIN,
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }, { id: "slack_read_thread", readOnly: true }],
      identityOperations: ["slack_read_user_profile"],
      cases: [{ name: "a page", input: {} }],
      detailCases: [{ id: "slack.workspace.thread", scope: { channels: ["C0PILOT001"] } }],
      calls: {
        list: async (_input, context) => {
          await context.permission.assert({ action: "slack_events_list" })
          await context.permission.assert({ action: "slack_slack_read_channel" })
          return page()
        },
        probe: async (input, context) => {
          await context.permission.assert({ action: "slack_events_list" })
          await context.permission.assert({ action: "slack_slack_read_user_profile" })
          return { source: "slack", account: (input as { account: string }).account, owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted" }
        },
        details: { "slack.workspace.thread": async () => page() },
      },
    })
    assert.equal(report.incomplete, true)
    assert.ok(report.problems.some((problem) => /no case outside the confirmed scope/.test(problem)))
  })
})

describe("the three mutations the reviewer killed", () => {
  const item = (): Record<string, unknown> => validPage({
    id: "slack.workspace",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "slack" },
    accounts: { named: false },
    permission: { events: "slack_events_list", operations: ["slack_read_user_profile", "slack_read_channel"] },
    cost: { class: "free" },
  })
  const page = (): Record<string, unknown> => validPage({
    source: "slack",
    plugin: PLUGIN,
    account: ACCOUNT,
    owner: null,
    asOf: ISO,
    trust: "untrusted",
    events: [],
    cursor: "c1",
    more: false,
    refused: [],
    failed: [],
  })

  test("a probe that answers any content key is refused", async () => {
    const report = await sourceConformance({
      plugin: PLUGIN,
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }],
      identityOperations: ["slack_read_user_profile"],
      cases: [{ name: "a page", input: {} }],
      calls: {
        list: async (_input, context) => {
          await context.permission.assert({ action: "slack_events_list" })
          await context.permission.assert({ action: "slack_slack_read_channel" })
          return page()
        },
        probe: async (input, context) => {
          await context.permission.assert({ action: "slack_events_list" })
          await context.permission.assert({ action: "slack_slack_read_user_profile" })
          return { source: "slack", account: (input as { account: string }).account, owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted", data: { messages: [] } }
        },
      },
    })
    assert.ok(report.problems.some((problem) => /reads no content/.test(problem)))
  })

  test("a suggest tool that is not read-only is refused", () => {
    const suggested = {
      ...item(),
      scope: { keys: ["channels"], describe: "Channels", suggest: { tool: "slack_list_user_channels", operations: [] } },
    }
    assert.ok(declarationProblems(declarationOf(suggested), { tools: [{ id: "events_list", readOnly: true }, { id: "slack_list_user_channels", readOnly: false }] }).some((problem) => /readOnly/.test(problem)))
  })

  test("an expiry answered with the wrong code is refused", async () => {
    const report = await sourceConformance({
      plugin: PLUGIN,
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }],
      identityOperations: ["slack_read_user_profile"],
      cases: [{ name: "an expired cursor", input: { cursor: "stale" }, expect: "expired" }],
      calls: {
        list: async (_input, context) => {
          await context.permission.assert({ action: "slack_events_list" })
          await context.permission.assert({ action: "slack_slack_read_channel" })
          throw new Error("CURSOR_INVALID: that cursor is not ours. Next step: read without a cursor.")
        },
        probe: async (input, context) => {
          await context.permission.assert({ action: "slack_events_list" })
          await context.permission.assert({ action: "slack_slack_read_user_profile" })
          return { source: "slack", account: (input as { account: string }).account, owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted" }
        },
      },
    })
    assert.ok(report.problems.some((problem) => /not CURSOR_EXPIRED or a gap/.test(problem)))
  })
})

// The rules the generated JSON Schema cannot carry. The PR body lists exactly these names, and each one proves it is
// conformance-only: the schema accepts the declaration and the kit refuses it.
describe("the conformance-only rules", () => {
  const tools: ToolDeclaration[] = [
    { id: "events_list", readOnly: true },
    { id: "slack_read_thread", readOnly: true },
    { id: "slack_list_user_channels", readOnly: true },
  ]
  const base = (over: Record<string, unknown> = {}): Record<string, unknown> => validPage({
    id: "slack.workspace",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "slack" },
    accounts: { named: false },
    permission: { events: "slack_events_list", operations: ["slack_read_channel"] },
    cost: { class: "free" },
    ...over,
  })
  const cases: readonly { readonly rule: string; readonly item: () => Record<string, unknown> }[] = [
    { rule: "a write verb in a name", item: () => base({ tool: "slack_send_message" }) },
    { rule: "a compound name", item: () => base({ tool: "slack_get_and_send" }) },
    { rule: "an operation's last segment carries a write verb", item: () => base({ permission: { events: "slack_events_list", operations: ["gmail.users.messages.insert"] } }) },
    { rule: "an action outside the source's namespace", item: () => base({ permission: { events: "gws.events_list", operations: ["slack_read_channel"] } }) },
    { rule: "a urlHosts pattern too broad to mean anything", item: () => base({ urlHosts: ["*.co.uk"] }) },
    { rule: "a duplicate source id", item: () => base() },
    { rule: "a tool not declared read-only", item: () => base({ tool: "slack_send_message" }) },
    { rule: "a suggest operation also in the running grant", item: () => base({ scope: { keys: ["channels"], describe: "Channels", suggest: { tool: "slack_list_user_channels", operations: ["slack_list_user_channels"] } }, permission: { events: "slack_events_list", operations: ["slack_read_channel", "slack_list_user_channels"] } }) },
    { rule: "an extension name in another namespace", item: () => base({ reads: "x-other/suggestion" }) },
    {
      rule: "an output schema over 32 KB",
      item: () => ({
        id: "mem.receipts",
        kind: "snapshot",
        tool: "snapshot_read",
        output: "x-mem/receipt",
        outputSchema: { type: "object", properties: Object.fromEntries(Array.from({ length: 900 }, (_, index) => [`k${index}`, { type: "string", description: "x".repeat(40) }])) },
        accounts: { named: false },
        permission: { tool: "mem.snapshot_read", operations: ["mem.receipts.list"] },
        cost: { class: "free" },
      }),
    },
  ]

  const file = readFileSync(new URL("../test/conformance-only.json", import.meta.url), "utf8")
  const listed = JSON.parse(file) as readonly string[]

  test("each rule is conformance-only, and the published list is exactly these rules", () => {
    assert.deepEqual([...listed].sort(), cases.map((entry) => entry.rule).sort())
    for (const entry of cases) {
      const sources = entry.rule === "a duplicate source id" ? { contractVersion: 1, items: [base(), base()] } : declarationOf(entry.item())
      assert.deepEqual(problemsOf(sources), [], `${entry.rule}: the schema must accept it`)
      assert.ok(declarationProblems(sources, { tools }).length > 0, `${entry.rule}: the kit must refuse it`)
    }
  })
})

// The re-check's cases.

describe("the running session's unused-grant check", () => {
  const item = (): Record<string, unknown> => validPage({
    id: "gws.gmail",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "gws" },
    accounts: { named: true },
    permission: { events: "gws.events_list", operations: ["gmail.users.getProfile", "gmail.users.messages.list"] },
    cost: { class: "free" },
  })
  const page = (): Record<string, unknown> => validPage({
    source: "gws",
    plugin: "@joe-broadhead/opencode-gws",
    account: "sam.rivera@example.com",
    cursor: "c1",
    more: false,
    events: [],
    refused: [],
    failed: [],
  })

  test("a content operation no page asserts is reported by the running session", async () => {
    const report = await sourceConformance({
      plugin: "@joe-broadhead/opencode-gws",
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }],
      identityOperations: ["gmail.users.getProfile"],
      cases: [{ name: "a page", input: {} }],
      calls: {
        // It asserts its own action, never the content operation: switching off the running check lets this pass.
        list: async (_input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          return page()
        },
        probe: async (input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.getProfile"] })
          return { source: "gws", account: (input as { account: string }).account, owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted" }
        },
      },
    })
    assert.ok(
      report.problems.some((problem) => /gws\.read on \{account\}:gmail\.users\.messages\.list.*no read asserts/.test(problem)),
      report.problems.join("; "),
    )
    assert.equal(report.ok, false)
  })
})

describe("identity operations", () => {
  const item = (over: Record<string, unknown> = {}): Record<string, unknown> => validPage({
    id: "gws.gmail",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "gws" },
    accounts: { named: true },
    permission: { events: "gws.events_list", operations: ["gmail.users.getProfile", "gmail.users.messages.list"] },
    cost: { class: "free" },
    ...over,
  })
  const page = (): Record<string, unknown> => validPage({
    source: "gws",
    plugin: "@joe-broadhead/opencode-gws",
    account: "sam.rivera@example.com",
    cursor: "c1",
    more: false,
    events: [],
    refused: [],
    failed: [],
  })
  const run = (identityOperations: string[], pageAssertsIdentity = false) =>
    sourceConformance({
      plugin: "@joe-broadhead/opencode-gws",
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }],
      identityOperations,
      cases: [{ name: "a page", input: {} }],
      calls: {
        list: async (_input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          if (!pageAssertsIdentity) await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.messages.list"] })
          if (pageAssertsIdentity) await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.getProfile"] })
          return page()
        },
        probe: async (input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          for (const operation of identityOperations) {
            await context.permission.assert({ action: "gws.read", resources: [`sam.rivera@example.com:${operation}`] })
          }
          return { source: "gws", account: (input as { account: string }).account, owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted" }
        },
      },
    })

  test("an identity operation must also be declared as one of the source's operations", async () => {
    const report = await run(["gmail.users.getProfile"])
    assert.deepEqual(report.problems, [], report.problems.join("; "))
    assert.deepEqual(report.identityOperations, ["gmail.users.getProfile"])
    const undeclared = await run(["gmail.users.getDraft"])
    assert.ok(undeclared.problems.some((problem) => /getDraft.*not among permission\.operations/.test(problem)), undeclared.problems.join("; "))
  })

  test("readsIdentity lets a content read assert an identity operation, and still requires it declared", async () => {
    const declared = item({
      permission: { events: "gws.events_list", operations: ["gmail.users.getProfile", "gmail.users.messages.list"], readsIdentity: true },
    })
    const report = await sourceConformance({
      plugin: "@joe-broadhead/opencode-gws",
      source: sourceOf(declared),
      tools: [{ id: "events_list", readOnly: true }],
      identityOperations: ["gmail.users.getProfile"],
      cases: [{ name: "a page", input: {} }],
      calls: {
        list: async (_input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.messages.list"] })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.getProfile"] })
          return page()
        },
        probe: async (_input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.getProfile"] })
          return { source: "gws", account: "sam.rivera@example.com", owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted" }
        },
      },
    })
    assert.ok(!report.problems.some((problem) => /identity operation/.test(problem)), report.problems.join("; "))
    const undeclared = await sourceConformance({
      plugin: "@joe-broadhead/opencode-gws",
      source: sourceOf(item({ permission: { events: "gws.events_list", operations: ["gmail.users.messages.list"], readsIdentity: true } })),
      tools: [{ id: "events_list", readOnly: true }],
      identityOperations: ["gmail.users.getProfile"],
      cases: [{ name: "a page", input: {} }],
      calls: {
        list: async (_input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.messages.list"] })
          return page()
        },
        probe: async (_input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          return { source: "gws", account: "sam.rivera@example.com", owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted" }
        },
      },
    })
    assert.ok(undeclared.problems.some((problem) => /getProfile.*not among permission\.operations/.test(problem)), undeclared.problems.join("; "))
  })

  test("an empty permission.identity declares a probe that asserts only its action", async () => {
    const empty = validPage({
      id: "gws.gmail",
      kind: "events",
      reads: "message",
      tool: "events_list",
      input: { source: "gws" },
      accounts: { named: true },
      permission: { events: "gws.events_list", operations: ["gmail.users.messages.list"], identity: [] },
      cost: { class: "free" },
    })
    const report = await sourceConformance({
      plugin: "@joe-broadhead/opencode-gws",
      source: sourceOf(empty),
      tools: [{ id: "events_list", readOnly: true }],
      sources: { probe: { action: "gws.probe" } },
      account: "sam.rivera@example.com",
      // A declaration's empty identity is declared, not absent: the fallback does not apply.
      identityOperations: ["gmail.users.getProfile"],
      cases: [
        { name: "a page", input: {} },
        { name: "a page with a failed event", input: { cursor: "c2" } },
        { name: "a page with a refused event", input: { cursor: "c3" } },
        { name: "an expired cursor", input: { cursor: "stale" }, expect: "expired" },
      ],
      calls: {
        list: async (input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.messages.list"] })
          if (input["cursor"] === "c2") return { ...page(), failed: [{ external_id: "18f0000000000002", code: "RATE_LIMITED" }], cursor: "c2" }
          if (input["cursor"] === "c3") return { ...page(), refused: [{ external_id: "18f0000000000003", reason: "secret" }], cursor: "c3" }
          if (input["cursor"] === "stale") return { ...page(), gap: { reason: "expired", since: ISO }, cursor: "fresh" }
          return page()
        },
        probe: async (_input, context) => {
          await context.permission.assert({ action: "gws.probe" })
          return { source: "gws", account: "sam.rivera@example.com", owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted" }
        },
      },
    })
    assert.deepEqual(report.problems, [], report.problems.join("; "))
    assert.deepEqual(report.identityOperations, [])
    assert.equal(report.probeAction, "gws.probe")
    assert.equal(report.ok, true)
  })

  test("a content run that asserts an identity operation is refused", async () => {
    const report = await run(["gmail.users.getProfile"], true)
    assert.ok(report.problems.some((problem) => /content read asserts gws\.read on .*gmail\.users\.getProfile/.test(problem)), report.problems.join("; "))
  })

  test("a detail read that asserts an identity operation is refused", async () => {
    const withDetail = {
      ...item(),
      details: [{ id: "gws.gmail.message", tool: "gws_read", from: ["external_id"] }],
    }
    const report = await sourceConformance({
      plugin: "@joe-broadhead/opencode-gws",
      source: sourceOf(withDetail),
      tools: [{ id: "events_list", readOnly: true }, { id: "gws_read", readOnly: true }],
      identityOperations: ["gmail.users.getProfile"],
      cases: [{ name: "a page", input: {} }],
      detailCases: [{ id: "gws.gmail.message", scope: {}, event: { external_id: "18f0000000000001" } }],
      calls: {
        list: async (_input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.messages.list"] })
          return page()
        },
        probe: async (input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.getProfile"] })
          return { source: "gws", account: (input as { account: string }).account, owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted" }
        },
        details: {
          "gws.gmail.message": async (_input, context) => {
            await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.getProfile"] })
            return page()
          },
        },
      },
    })
    assert.ok(report.problems.some((problem) => /details.*identity operation/.test(problem)), report.problems.join("; "))
  })
})

describe("the verb rule keeps Memory's promise", () => {
  test("a tool name whose verb is a write verb, or that carries one, is refused", () => {
    for (const name of ["read_delete", "messages.getDelete", "getAndSend", "send_message", "delete_issue", "slack_post_message", "calendar_delete"]) {
      assert.ok(nameProblem(name) !== undefined, name)
    }
  })

  test("a noun after the first token is allowed, and a read verb anywhere makes it a read", () => {
    for (const name of ["get_issue", "list_comments", "get_post", "read", "events_list", "calendar_today", "slack_read_channel", "list_deleted_items"]) {
      assert.equal(nameProblem(name), undefined, name)
    }
  })

  test("the write list covers the words a plugin actually uses", () => {
    for (const name of [
      "chat_postMessage",
      "slack_post_message",
      "post_message",
      "postMessage",
      "execute_sql",
      "run_script",
      "trigger_deploy",
      "start_job",
      "stop_job",
      "sign_document",
      "pay_invoice",
      "assign_reviewer",
      "rename_file",
      "restore_backup",
      "react_message",
      "retweet_post",
    ]) {
      assert.ok(nameProblem(name) !== undefined, name)
    }
    for (const operation of ["chat.postMessage", "conversations.join", "repos.transfer", "slack_post_message", "execute_sql", "run_script", "chat.postMessage"]) {
      assert.ok(operationProblem(operation) !== undefined, operation)
    }
  })

  test("a single-token noun-verb last segment is a read, and a noun with an object is not", () => {
    assert.equal(operationProblem("drive.files.export"), undefined)
    assert.equal(operationProblem("calendar.events.instances"), undefined)
    assert.equal(operationProblem("x.users.mentions"), undefined)
    assert.ok(operationProblem("chat.postMessage") !== undefined)
    assert.ok(operationProblem("files.exportAll") !== undefined)
  })

  test("an operation keeps its last segment free of a write verb, and may lead with a noun", () => {
    for (const operation of ["x.users.mentions", "drive.files.export", "calendar.events.instances", "gmail.users.messages.batchGet", "gmail.users.messages.get", "slack_read_channel"]) {
      assert.equal(operationProblem(operation), undefined, operation)
    }
    for (const operation of ["gmail.users.messages.insert", "gmail.users.messages.batchModify", "calendar.events.quickAdd", "gmail.users.messages.emptyTrash", "gmail.users.messages.untrash", "calendar.events.watch", "gmail.users.messages.send", "messages.getDelete"]) {
      assert.ok(operationProblem(operation) !== undefined, operation)
    }
  })
})

describe("an out-of-scope detail read refuses with a defined code", () => {
  const item = (): Record<string, unknown> => validPage({
    id: "slack.workspace",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "slack" },
    accounts: { named: false },
    scope: { keys: ["channels"], describe: "Channels" },
    details: [{ id: "slack.workspace.thread", tool: "slack_read_thread", from: ["thread"] }],
    permission: { events: "slack_events_list", operations: ["slack_read_user_profile", "slack_read_channel", "slack_read_thread"] },
    cost: { class: "free" },
  })
  const page = (): Record<string, unknown> => validPage({
    source: "slack",
    plugin: PLUGIN,
    account: ACCOUNT,
    cursor: "c1",
    more: false,
    events: [],
    refused: [],
    failed: [],
  })
  const run = (code: string, message = `${code}: that thread is in a channel nobody confirmed. Next step: confirm the channel it belongs to.`) =>
    sourceConformance({
      plugin: PLUGIN,
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }, { id: "slack_read_thread", readOnly: true }],
      identityOperations: ["slack_read_user_profile"],
      cases: [{ name: "a page", input: {} }],
      detailCases: [
        { id: "slack.workspace.thread", scope: { channels: ["C0PILOT001"] }, event: { thread: "slack-thread:C0PILOT001:1" } },
        { id: "slack.workspace.thread", scope: { channels: ["C0PILOT001"] }, event: { thread: "slack-thread:C0PILOT003:1" }, expect: { refuses: code } },
      ],
      calls: {
        list: async (_input, context) => {
          await context.permission.assert({ action: "slack_events_list" })
          await context.permission.assert({ action: "slack_slack_read_channel" })
          return page()
        },
        probe: async (input, context) => {
          await context.permission.assert({ action: "slack_events_list" })
          await context.permission.assert({ action: "slack_slack_read_user_profile" })
          return { source: "slack", account: (input as { account: string }).account, owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted" }
        },
        details: {
          "slack.workspace.thread": async (input, context) => {
            if (input.fields["thread"] === "slack-thread:C0PILOT003:1") throw new Error(message)
            await context.permission.assert({ action: "slack_slack_read_thread" })
            return page()
          },
        },
      },
    })

  test("PERMISSION_DENIED is the code, and any other code is refused", async () => {
    const good = await run("PERMISSION_DENIED")
    assert.deepEqual(good.problems, [], good.problems.join("; "))
    for (const code of ["SCOPE_UNKNOWN", "CURSOR_INVALID", "NOPE"]) {
      const bad = await run(code)
      assert.ok(bad.problems.some((problem) => /PERMISSION_DENIED/.test(problem)), `${code}: ${bad.problems.join("; ")}`)
    }
  })

  test("the code without the family's next step is refused", async () => {
    const bad = await run("PERMISSION_DENIED", "PERMISSION_DENIED: that thread is in a channel nobody confirmed.")
    assert.ok(bad.problems.some((problem) => /not PERMISSION_DENIED: … Next step: …/.test(problem)), bad.problems.join("; "))
    const answered = await sourceConformance({
      plugin: PLUGIN,
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }, { id: "slack_read_thread", readOnly: true }],
      identityOperations: ["slack_read_user_profile"],
      cases: [{ name: "a page", input: {} }],
      detailCases: [
        { id: "slack.workspace.thread", scope: { channels: ["C0PILOT001"] }, event: { thread: "slack-thread:C0PILOT001:1" } },
        { id: "slack.workspace.thread", scope: { channels: ["C0PILOT001"] }, event: { thread: "slack-thread:C0PILOT003:1" }, expect: { refuses: "PERMISSION_DENIED" } },
      ],
      calls: {
        list: async (_input, context) => {
          await context.permission.assert({ action: "slack_events_list" })
          await context.permission.assert({ action: "slack_slack_read_channel" })
          return page()
        },
        probe: async (input, context) => {
          await context.permission.assert({ action: "slack_events_list" })
          await context.permission.assert({ action: "slack_slack_read_user_profile" })
          return { source: "slack", account: (input as { account: string }).account, owner: { id: "slack:U0PILOTOWN", label: "Pilot Owner" }, trust: "untrusted" }
        },
        details: {
          "slack.workspace.thread": async (input, context) => {
            if (input.fields["thread"] === "slack-thread:C0PILOT003:1") return page()
            await context.permission.assert({ action: "slack_slack_read_thread" })
            return page()
          },
        },
      },
    })
    assert.ok(answered.problems.some((problem) => /answered a call outside the confirmed scope/.test(problem)), answered.problems.join("; "))
  })
})

describe("the page fields that are absent, and the limits §2.2 does not state", () => {
  const item = (): Record<string, unknown> => validPage({
    id: "slack.workspace",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "slack" },
    accounts: { named: false },
    permission: { events: "slack_events_list", operations: ["slack_read_user_profile", "slack_read_channel"] },
    cost: { class: "free" },
  })
  const options = () => ({ source: sourceOf(item()), plugin: PLUGIN, input: {} })

  test("a page without refused[] or failed[] is accepted", () => {
    assert.deepEqual(pageProblems(validPage({ source: "slack", cursor: "c1", more: false, events: [] }), options()), [])
  })

  test("a cursor over 1024 characters is refused by the events contract", () => {
    assert.ok(pageProblems(validPage({ source: "slack", cursor: "c".repeat(5000), more: true, events: [] }), options()).some((problem) => /cursor/.test(problem)))
  })

  test("scope keys and price units have no ceiling §2.2 does not state", () => {
    const keys = Array.from({ length: 12 }, (_, index) => `key${index}`)
    const checked = SOURCES_SCHEMA.check(declarationOf({ ...item(), scope: { keys, describe: "Which" } }))
    assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("; "))
    const units = Array.from({ length: 12 }, (_, index) => ({ per: `unit${index}`, usd: 1 }))
    const priced = SOURCES_SCHEMA.check(declarationOf({ ...item(), cost: { class: "metered", units } }))
    assert.equal(priced.ok, true, priced.ok ? "" : priced.problems.join("; "))
  })
})

describe("a page fetched atomically", () => {
  const item = (): Record<string, unknown> => validPage({
    id: "gws.calendar",
    kind: "events",
    reads: "meeting",
    tool: "events_list",
    input: { source: "calendar" },
    accounts: { named: true },
    permission: { events: "gws.events_list", operations: ["calendar.calendarList.get", "calendar.events.list"] },
    cost: { class: "free" },
  })
  const page = (over: Record<string, unknown> = {}): Record<string, unknown> => validPage({
    source: "calendar",
    plugin: "@joe-broadhead/opencode-gws",
    account: "sam.rivera@example.com",
    owner: { id: "mailto:sam.rivera@example.com", label: "Sam Rivera" },
    asOf: ISO,
    trust: "untrusted",
    events: [],
    cursor: "c1",
    more: false,
    refused: [{ external_id: "evt-z", reason: "owner" }],
    failed: [],
    ...over,
  })
  const run = (atomicPages?: { reason: string }) =>
    sourceConformance({
      plugin: "@joe-broadhead/opencode-gws",
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }],
      identityOperations: ["calendar.calendarList.get"],
      cases: [
        { name: "a page", input: {} },
        { name: "an expired cursor", input: { cursor: "stale" }, expect: "expired" },
      ],
      ...(atomicPages === undefined ? {} : { atomicPages }),
      calls: {
        list: async (input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:calendar.events.list"] })
          if (input["cursor"] === "stale") return page({ gap: { reason: "expired", since: ISO }, cursor: "fresh" })
          return page()
        },
        probe: async (input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:calendar.calendarList.get"] })
          return { source: "calendar", account: (input as { account: string }).account, owner: { id: "mailto:sam.rivera@example.com", label: "Sam Rivera" }, trust: "untrusted" }
        },
      },
    })

  test("without a reason, a source that cannot fail one item is incomplete", async () => {
    const report = await run()
    assert.equal(report.incomplete, true)
    assert.equal(report.checks.find((check) => check.name === "failed-holds-cursor")?.ran, false)
    assert.equal(report.checks.find((check) => check.name === "failed-holds-cursor")?.notApplicable, false)
  })

  test("with a reason, the check does not apply, the reason is shown, and the report is ok", async () => {
    const report = await run({ reason: "events.list answers the whole page in one call, so no item can fail alone" })
    const check = report.checks.find((entry) => entry.name === "failed-holds-cursor")
    assert.equal(check?.notApplicable, true)
    assert.equal(check?.reason, "events.list answers the whole page in one call, so no item can fail alone")
    assert.deepEqual(report.problems, [])
    assert.equal(report.ok, true)
    assert.equal(report.incomplete, false)
  })

  test("an empty reason is no reason: the check applies, and the report is incomplete", async () => {
    for (const reason of ["", "   "]) {
      const report = await run({ reason })
      const check = report.checks.find((entry) => entry.name === "failed-holds-cursor")
      assert.equal(check?.notApplicable, false, reason)
      assert.equal(report.incomplete, true, reason)
    }
  })
})

describe("a source whose cursors never expire", () => {
  const item = (): Record<string, unknown> => validPage({
    id: "gws.gmail",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "gmail" },
    accounts: { named: true },
    permission: { events: "gws.events_list", operations: ["gmail.users.messages.list"] },
    cost: { class: "free" },
  })
  const page = (over: Record<string, unknown> = {}): Record<string, unknown> => validPage({
    source: "gmail",
    plugin: "@joe-broadhead/opencode-gws",
    account: "sam.rivera@example.com",
    owner: { id: "mailto:sam.rivera@example.com", label: "Sam Rivera" },
    asOf: ISO,
    trust: "untrusted",
    events: [],
    cursor: "c1",
    more: false,
    refused: [],
    failed: [],
    ...over,
  })
  const run = (noExpiry?: { reason: string }) =>
    sourceConformance({
      plugin: "@joe-broadhead/opencode-gws",
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }],
      account: "sam.rivera@example.com",
      cases: [
        { name: "a page", input: {} },
        { name: "a page with a failed event", input: { cursor: "c2" } },
        { name: "a page with a refused event", input: { cursor: "c3" } },
      ],
      ...(noExpiry === undefined ? {} : { noExpiry }),
      calls: {
        list: async (input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.messages.list"] })
          if (input["cursor"] === "c2") return page({ failed: [{ external_id: "18f0000000000002", code: "RATE_LIMITED" }], cursor: "c2" })
          if (input["cursor"] === "c3") return page({ refused: [{ external_id: "18f0000000000003", reason: "secret" }], cursor: "c3" })
          return page()
        },
        probe: async (_input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          return { source: "gmail", account: "sam.rivera@example.com", owner: { id: "mailto:sam.rivera@example.com", label: "Sam Rivera" }, trust: "untrusted" }
        },
      },
    })

  test("without a reason, a source that cannot produce an expired cursor is incomplete", async () => {
    const report = await run()
    assert.equal(report.incomplete, true)
    assert.equal(report.checks.find((check) => check.name === "gap-and-cursor-expired")?.ran, false)
    assert.equal(report.checks.find((check) => check.name === "gap-and-cursor-expired")?.notApplicable, false)
  })

  test("with a reason, the check does not apply, the reason is shown, and the report is ok", async () => {
    const report = await run({ reason: "X's ids never expire, so it cannot produce an expired cursor" })
    const check = report.checks.find((entry) => entry.name === "gap-and-cursor-expired")
    assert.equal(check?.notApplicable, true)
    assert.equal(check?.reason, "X's ids never expire, so it cannot produce an expired cursor")
    assert.deepEqual(report.problems, [])
    assert.equal(report.ok, true)
    assert.equal(report.incomplete, false)
  })

  test("an empty reason is no reason: the check applies, and the report is incomplete", async () => {
    for (const reason of ["", "   "]) {
      const report = await run({ reason })
      const check = report.checks.find((entry) => entry.name === "gap-and-cursor-expired")
      assert.equal(check?.notApplicable, false, reason)
      assert.equal(report.incomplete, true, reason)
    }
  })
})

describe("the kit drives the secret screening from a fixture", () => {
  const item = (): Record<string, unknown> => validPage({
    id: "gws.gmail",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "gmail" },
    accounts: { named: true },
    permission: { events: "gws.events_list", operations: ["gmail.users.messages.list"] },
    cost: { class: "free" },
  })
  const page = (events: Record<string, unknown>[]): Record<string, unknown> => validPage({
    source: "gmail",
    plugin: "@joe-broadhead/opencode-gws",
    account: "sam.rivera@example.com",
    owner: { id: "mailto:sam.rivera@example.com", label: "Sam Rivera" },
    asOf: ISO,
    trust: "untrusted",
    events,
    cursor: "c1",
    more: false,
    refused: [],
    failed: [],
  })
  const run = (answer: Record<string, unknown>) =>
    sourceConformance({
      plugin: "@joe-broadhead/opencode-gws",
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }],
      cases: [{ name: "a page", input: {} }],
      calls: {
        list: async (_input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.messages.list"] })
          return answer
        },
        probe: async (input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          return { source: "gmail", account: (input as { account: string }).account, owner: { id: "mailto:sam.rivera@example.com", label: "Sam Rivera" }, trust: "untrusted" }
        },
      },
    })

  test("an event that holds a secret is refused, and a page whose secret is in refused[] passes", async () => {
    const secret = "the deploy key is api_key = sk_live_51H8xQ2eZvKYlo2C9mN"
    const leaked = await run(page([{ external_id: "m1", title: "key", text: secret }]))
    assert.ok(leaked.problems.some((problem) => /holds a secret \(api key\)/.test(problem)), leaked.problems.join("; "))
    const refused = await run({ ...page([]), refused: [{ external_id: "m1", reason: "secret", detail: "api key" }] })
    assert.deepEqual(refused.problems, [], refused.problems.join("; "))
  })

  test("the gws Gmail fixture records a secret-shaped refusal", () => {
    const fixture = JSON.parse(readFileSync(new URL("../examples/gws-gmail/fixtures/conformance.json", import.meta.url), "utf8")) as {
      sources: Record<string, { cases: { answer?: { refused?: { reason?: string }[] } }[] }>
    }
    const refused = (fixture.sources["gws.gmail"]?.cases ?? []).flatMap((entry) => entry.answer?.refused ?? [])
    assert.ok(refused.some((entry) => entry.reason === "secret"), "the fixture must show the screening being driven")
  })
})

describe("a gap is answered once per read (#28)", () => {
  const item = (): Record<string, unknown> => validPage({
    id: "gws.gmail",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "gmail" },
    accounts: { named: true },
    permission: { events: "gws.events_list", operations: ["gmail.users.messages.list"] },
    cost: { class: "free" },
  })
  const page = (over: Record<string, unknown> = {}): Record<string, unknown> => validPage({
    source: "gmail",
    plugin: "@joe-broadhead/opencode-gws",
    account: "sam.rivera@example.com",
    owner: { id: "mailto:sam.rivera@example.com", label: "Sam Rivera" },
    asOf: ISO,
    trust: "untrusted",
    events: [],
    cursor: "c1",
    more: false,
    refused: [],
    failed: [],
    ...over,
  })
  const GAP = { reason: "window-truncated", since: "2026-10-01T00:00:00.000Z" }
  /** A read from since whose first page answers a gap; `second` answers the page its cursor names. */
  const run = (first: Record<string, unknown>, second?: Record<string, unknown>) =>
    sourceConformance({
      plugin: "@joe-broadhead/opencode-gws",
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }],
      account: "sam.rivera@example.com",
      cases: [{ name: "a since before the window", input: { since: "2026-01-01T00:00:00.000Z" } }],
      noExpiry: { reason: "this fake has no expired cursor" },
      calls: {
        list: async (input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.messages.list"] })
          if (input["cursor"] === "c2") {
            if (second === undefined) throw new Error("FIXTURE_MISSING: no answer recorded for the second page")
            return second
          }
          return first
        },
        probe: async (_input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          return { source: "gmail", account: "sam.rivera@example.com", owner: { id: "mailto:sam.rivera@example.com", label: "Sam Rivera" }, trust: "untrusted" }
        },
      },
    })
  const check = async (first: Record<string, unknown>, second?: Record<string, unknown>) => (await run(first, second)).checks.find((entry) => entry.name === "gap-once-per-read")

  test("passes when the gap is on the first page only, and the page its cursor names carries none", async () => {
    const found = await check(page({ gap: GAP, more: true, cursor: "c2" }), page({ cursor: "c3" }))
    assert.deepEqual(found, { name: "gap-once-per-read", ran: true, notApplicable: false, problems: [] })
  })

  test("passes for a gap page with more: false: the read has no later page", async () => {
    const found = await check(page({ gap: GAP, more: false }))
    assert.equal(found?.ran, true)
    assert.deepEqual(found?.problems, [])
  })

  test("fails when the second page repeats the gap, at either reason", async () => {
    for (const repeat of [GAP, { reason: "expired", since: "2026-10-01T00:00:00.000Z" }]) {
      const found = await check(page({ gap: GAP, more: true, cursor: "c2" }), page({ cursor: "c3", gap: repeat }))
      assert.deepEqual(found?.problems, ["events_list(a since before the window): the read's second page repeats the gap, which a consumer counts as a second resync"])
    }
  })

  test("fails when a gap page says more: true and its next page is not recorded", async () => {
    const found = await check(page({ gap: GAP, more: true, cursor: "c2" }))
    assert.equal(found?.problems.length, 1)
    assert.match(found?.problems[0] ?? "", /must be recorded to show the gap is not repeated/)
  })

  test("does not apply when no answer carries a gap", async () => {
    const found = await check(page())
    assert.equal(found?.ran, false)
    assert.equal(found?.notApplicable, true)
  })
})

describe("removals are final (#27)", () => {
  const item = (): Record<string, unknown> => validPage({
    id: "gws.gmail",
    kind: "events",
    reads: "message",
    tool: "events_list",
    input: { source: "gmail" },
    accounts: { named: true },
    permission: { events: "gws.events_list", operations: ["gmail.users.messages.list"] },
    cost: { class: "free" },
  })
  const page = (over: Record<string, unknown> = {}): Record<string, unknown> => validPage({
    source: "gmail",
    plugin: "@joe-broadhead/opencode-gws",
    account: "sam.rivera@example.com",
    owner: { id: "mailto:sam.rivera@example.com", label: "Sam Rivera" },
    asOf: ISO,
    trust: "untrusted",
    events: [],
    cursor: "c1",
    more: false,
    refused: [],
    failed: [],
    ...over,
  })
  const run = (answer: Record<string, unknown>) =>
    sourceConformance({
      plugin: "@joe-broadhead/opencode-gws",
      source: sourceOf(item()),
      tools: [{ id: "events_list", readOnly: true }],
      account: "sam.rivera@example.com",
      cases: [{ name: "a page with removals", input: {} }],
      noExpiry: { reason: "this fake has no expired cursor" },
      calls: {
        list: async (_input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          await context.permission.assert({ action: "gws.read", resources: ["sam.rivera@example.com:gmail.users.messages.list"] })
          return answer
        },
        probe: async (_input, context) => {
          await context.permission.assert({ action: "gws.events_list" })
          return { source: "gmail", account: "sam.rivera@example.com", owner: { id: "mailto:sam.rivera@example.com", label: "Sam Rivera" }, trust: "untrusted" }
        },
      },
    })
  const check = async (answer: Record<string, unknown>) => (await run(answer)).checks.find((entry) => entry.name === "removals-are-final")
  const before = new Date(Date.parse(ISO) - 60_000).toISOString()

  test("runs and passes when a page carries well-formed removals", async () => {
    const found = await check(page({ removals: [{ external_id: "18f0000000000004", at: before, reason: "deleted" }, { external_id: "18f0000000000005", at: before, reason: "withheld" }] }))
    assert.deepEqual(found, { name: "removals-are-final", ran: true, notApplicable: false, problems: [] })
  })

  test("fails on a removal that is also failed, a repeat, or one later than asOf", async () => {
    const found = await check(page({
      removals: [{ external_id: "a", at: before, reason: "deleted" }, { external_id: "a", at: before, reason: "expired" }, { external_id: "b", at: "2099-01-01T00:00:00.000Z", reason: "withheld" }],
      failed: [{ external_id: "a", code: "RATE_LIMITED" }],
    }))
    assert.deepEqual(found?.problems, [
      "events_list(a page with removals): the result's removals lists one event twice",
      "events_list(a page with removals): removals[2].at is later than the page's asOf",
      "events_list(a page with removals): an event is both removed and failed: a removal is final, so nothing is retried",
    ])
  })

  test("does not apply to a source that never removes anything", async () => {
    const found = await check(page())
    assert.equal(found?.ran, false)
    assert.equal(found?.notApplicable, true)
  })
})

describe("a rules source (#30, items 10 and 11)", () => {
  const github = (permission: Record<string, unknown> = {}, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: "github.activity",
    kind: "events",
    reads: "issue",
    tool: "events_list",
    input: { source: "github" },
    permission: {
      events: "github.events_list",
      rules: [{ action: "github_api", resource: "GET /user" }, { action: "github_api", resource: "GET /search/issues" }],
      ...permission,
    },
    cost: { class: "free" },
    ...over,
  })

  test("item 10: a rules source declares its probe's grants as identityRules, among its rules", () => {
    assert.deepEqual(problemsOf(declarationOf(github({ identityRules: [{ action: "github_api", resource: "GET /user" }] }))), [])
    assert.deepEqual(problemsOf(declarationOf(github({ identityRules: [] }))), [])
    assert.deepEqual(declarationProblems(declarationOf(github({ identityRules: [{ action: "github_api", resource: "GET /user" }] }))), [])
    assert.deepEqual(declarationProblems(declarationOf(github({ identityRules: [{ action: "github_api", resource: "GET /emails" }] }))), [
      "items[0] (github.activity).permission.identityRules lists github_api on GET /emails, which permission.rules does not: a source's rules are everything its reads assert, identity included",
    ])
    assert.deepEqual(declarationProblems(declarationOf(github({ identityRules: [{ action: "github_api", resource: "GET /user" }, { action: "github_api", resource: "GET /user" }] }))), [
      "items[0] (github.activity).permission.identityRules lists github_api on GET /user twice",
    ])
  })

  test("item 10: identityRules is for rules sources, and identity for operations sources", () => {
    const withOperations = { ...github(), permission: { events: "github.events_list", operations: ["user.get"], identityRules: [{ action: "github_api", resource: "GET /user" }] } }
    assert.ok(problemsOf(declarationOf(withOperations)).some((problem) => problem.includes("identityRules is for a source that states its rules verbatim")))
    assert.ok(problemsOf(declarationOf(github({ identity: ["user.get"] }))).some((problem) => problem.includes("declares its probe's grants as identityRules, not identity")))
  })

  test("item 11: every per-item rule runs on a rules source: a reads outside its namespace is refused", () => {
    assert.deepEqual(declarationProblems(declarationOf(github({}, { reads: "issue" }))), [])
    const problems = declarationProblems(declarationOf(github({}, { reads: "x-other/thing" })))
    assert.equal(problems.length, 1)
    assert.match(problems[0] ?? "", /x-other\/thing/)
  })

  test("item 10: the kit fences a rules source's probe by its identityRules, exactly", async () => {
    const run = (probeAsserts: readonly { action: string; resource: string }[], permission: Record<string, unknown>) =>
      sourceConformance({
        plugin: "@joe-broadhead/opencode-github",
        source: sourceOf(github({ readsIdentity: true, ...permission })),
        sources: { probe: { action: "github.probe" } },
        tools: [{ id: "events_list", readOnly: true }],
        account: "octo@example.test",
        cases: [],
        noExpiry: { reason: "no cases in this test" },
        calls: {
          probe: async (_input, context) => {
            for (const assertion of probeAsserts) await context.permission.assert({ action: assertion.action, resources: [assertion.resource] })
            return { source: "github", account: "octo@example.test", owner: { id: "github:octocat", label: "Octocat" }, trust: "untrusted" }
          },
        },
      })
    const probeOf = async (asserts: readonly { action: string; resource: string }[], permission: Record<string, unknown>) =>
      (await run(asserts, permission)).checks.find((check) => check.name === "probe")?.problems
    const user = { action: "github_api", resource: "GET /user" }
    assert.deepEqual(await probeOf([{ action: "github.probe", resource: "*" }, user], { identityRules: [user] }), [])
    assert.deepEqual(await probeOf([{ action: "github.probe", resource: "*" }], { identityRules: [user] }), [
      "probe(github.activity) does not assert github_api on GET /user, which the declaration names",
    ])
    assert.deepEqual(await probeOf([{ action: "github.probe", resource: "*" }, user, { action: "github_api", resource: "GET /search/issues" }], { identityRules: [user] }), [
      "probe(github.activity) asserts github_api on GET /search/issues, which is not an identity operation: a probe reads the account, never content",
    ])
  })
})

describe("accounts.server (#30, item 9)", () => {
  const plaud = (server: unknown): Record<string, unknown> => ({
    id: "plaud.recordings",
    kind: "events",
    reads: "meeting",
    tool: "events_list",
    input: { source: "plaud" },
    accounts: { named: true, server },
    permission: { events: "plaud.events_list", operations: ["list_files"] },
    cost: { class: "free" },
  })

  test("a per-account server holds {account} once, in lowercase words", () => {
    for (const server of ["plaud-{account}", "{x}-{account}".replace("{x}-", "mcp-"), "plaud_{account}_v2"]) assert.deepEqual(problemsOf(declarationOf(plaud(server))), [], server)
    for (const server of ["plaud", "Plaud-{account}", "plaud-{account}-{account}", "plaud {account}", "{account}", `${"p".repeat(60)}-{account}`]) {
      assert.ok(problemsOf(declarationOf(plaud(server))).length > 0, server)
    }
  })

  test("a source without it is unchanged", () => {
    const { accounts: _accounts, ...rest } = plaud("plaud-{account}")
    assert.deepEqual(problemsOf(declarationOf({ ...rest, accounts: { named: true } })), [])
  })
})
