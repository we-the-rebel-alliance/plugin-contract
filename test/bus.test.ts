// The bus (contract §10, §13): a plugin registers `changed`, `status` and `account` once and emits nudges; an app reads
// one `/api/event` payload as a typed event or a reason. The tests hold the writer, the reader and the one derivation
// between them: `rpc.<name>.<event>`.
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { Plugin, Rpc } from "@opencode/plugin"
import {
  BUS_EVENTS,
  BUS_STATES,
  type Bus,
  type BusDefinition,
  type BusEventData,
  type BusHost,
  busDefinition,
  busEventType,
  capabilityPattern,
  createBus,
  isPluginName,
  readBusEvent,
  REASON_MAX,
  type ChangedData,
} from "../src/bus.ts"

interface Emitted {
  readonly type: string
  readonly data: unknown
}

/** A host that records the definition it was given and the events the writer emits, as the real host names them. */
function fakeHost(): {
  host: BusHost
  definitions: BusDefinition[]
  handlers: unknown[]
  emitted: Emitted[]
  fail: { value: boolean }
} {
  const definitions: BusDefinition[] = []
  const handlers: unknown[] = []
  const emitted: Emitted[] = []
  const fail = { value: false }
  const host: BusHost = {
    rpc: {
      async register(definition, received) {
        definitions.push(definition)
        handlers.push(received)
        return {
          events: {
            async emit(name, data) {
              if (fail.value) throw new Error("the host is gone")
              emitted.push({ type: `rpc.${definition.id}.${name}`, data })
            },
          },
        }
      },
    },
  }
  return { host, definitions, handlers, emitted, fail }
}

const changed = (overrides: Partial<ChangedData> = {}): ChangedData => ({
  capability: "slack.mentions",
  account: "work",
  reason: "write",
  ...overrides,
})

/** The JSON Schema of one event, as a record a test can read. */
function schema(definition: BusDefinition, event: string): Record<string, unknown> {
  return (definition.events as unknown as Record<string, { schema: Record<string, unknown> }>)[event]!.schema
}

/** A payload as `/api/event` carries it, with the envelope fields the reader ignores. */
const payload = (type: string, data: unknown): Record<string, unknown> => ({
  id: "evt_1",
  type,
  created: 1_763_942_400,
  data,
})

describe("the bus writer (contract §10)", () => {
  test("registers one definition: the plugin's id, no methods and exactly the three events", async () => {
    const { host, definitions, handlers } = fakeHost()
    const bus = await createBus(host, "slack")
    assert.equal(bus.name, "slack")
    assert.equal(definitions.length, 1)
    assert.deepEqual(handlers, [{}])
    const definition = definitions[0]!
    assert.equal(definition.id, "slack")
    assert.deepEqual(definition.methods, {})
    assert.deepEqual(Object.keys(definition.events), [...BUS_EVENTS])
  })

  test("declares each event as a closed object with its fields required", async () => {
    const definition = busDefinition("slack")
    assert.deepEqual(
      { changed: schema(definition, "changed")["required"], status: schema(definition, "status")["required"], account: schema(definition, "account")["required"] },
      { changed: ["capability", "account", "reason"], status: ["state"], account: ["account", "state"] },
    )
    for (const event of BUS_EVENTS) {
      assert.equal(schema(definition, event)["type"], "object", event)
      assert.equal(schema(definition, event)["additionalProperties"], false, event)
    }
    const states = (schema(definition, "status")["properties"] as Record<string, Record<string, unknown>>)["state"]!["enum"]
    assert.deepEqual(states, [...BUS_STATES])
  })

  test("emits each event, and the host names it rpc.<name>.<event>", async () => {
    const { host, emitted } = fakeHost()
    const bus = await createBus(host, "slack")
    assert.deepEqual(await bus.emit("changed", changed()), { ok: true })
    assert.deepEqual(await bus.emit("status", { state: "ready" }), { ok: true })
    assert.deepEqual(await bus.emit("account", { account: "work", state: "needs_sign_in" }), { ok: true })
    assert.deepEqual(emitted, [
      { type: "rpc.slack.changed", data: changed() },
      { type: "rpc.slack.status", data: { state: "ready" } },
      { type: "rpc.slack.account", data: { account: "work", state: "needs_sign_in" } },
    ])
  })

  test("derives the event type from the plugin name, and the definition id is the name", async () => {
    assert.equal(busEventType("slack", "changed"), "rpc.slack.changed")
    assert.equal(busEventType("gws", "account"), "rpc.gws.account")
    assert.equal(busDefinition("gws").id, "gws")
    assert.equal(capabilityPattern("gws"), "^gws\\.[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)*$")
  })

  test("a plugin name that breaks contract §3 is refused before anything is registered", async () => {
    const { host, definitions } = fakeHost()
    for (const name of ["slack-plugin", "Slack", "a", "1".repeat(32), "sla_ck", "", " slack", "slack!"]) {
      await assert.rejects(createBus(host, name), /is not a plugin name/, name)
    }
    await assert.rejects(createBus(host, 42 as unknown as string), /is not a plugin name/)
    assert.equal(definitions.length, 0)
    for (const name of ["slack", "gws", "x1", "a1", "1a", "a".repeat(31)]) assert.equal(isPluginName(name), true, name)
    for (const name of ["a", "a".repeat(32), "slack-plugin", "Slack", "sla_ck", "", 42]) assert.equal(isPluginName(name), false, String(name))
  })

  test("refuses malformed data with its field paths and emits nothing", async () => {
    const { host, emitted } = fakeHost()
    const bus = await createBus(host, "slack")
    const cases: [Parameters<Bus["emit"]>[0], unknown, string][] = [
      ["changed", undefined, "data: must be an object"],
      ["changed", null, "data: must be an object"],
      ["changed", [], "data: must be an object"],
      ["changed", "changed", "data: must be an object"],
      ["changed", { account: "work", reason: "write" }, "data.capability: is required"],
      ["changed", { capability: "slack.mentions", reason: "write" }, "data.account: is required"],
      ["changed", { capability: "slack.mentions", account: "work" }, "data.reason: is required"],
      ["changed", changed({ capability: 42 as unknown as string }), "data.capability: must be a string"],
      ["changed", changed({ capability: "" }), "data.capability: must not be empty"],
      ["changed", changed({ capability: "gws.gmail" }), "data.capability: must be this plugin's capability id, slack.<capability>"],
      ["changed", changed({ capability: "mentions" }), "data.capability: must be this plugin's capability id, slack.<capability>"],
      ["changed", changed({ capability: "slack.Mentions" }), "data.capability: must be this plugin's capability id, slack.<capability>"],
      ["changed", changed({ account: 42 as unknown as string }), "data.account: must be a string"],
      ["changed", changed({ account: "Work" }), "data.account: must be an account alias: lowercase letters, digits and underscores, starting with a letter (contract §5)"],
      ["changed", changed({ account: "work-2" }), "data.account: must be an account alias: lowercase letters, digits and underscores, starting with a letter (contract §5)"],
      ["changed", changed({ account: "a".repeat(33) }), "data.account: must be an account alias: lowercase letters, digits and underscores, starting with a letter (contract §5)"],
      ["changed", changed({ reason: 42 as unknown as string }), "data.reason: must be a string"],
      ["changed", changed({ reason: "" }), "data.reason: must not be empty"],
      ["changed", changed({ reason: "a".repeat(REASON_MAX + 1) }), `data.reason: must be at most ${REASON_MAX} characters`],
      ["changed", changed({ reason: "two\nlines" }), `data.reason: must be 1 to ${REASON_MAX} characters on one line`],
      ["changed", { ...changed(), extra: "content" }, "data.extra: is not a field of this event"],
      ["status", undefined, "data: must be an object"],
      ["status", {}, "data.state: is required"],
      ["status", { state: "signed_in" }, `data.state: must be one of ${BUS_STATES.join(", ")}`],
      ["status", { state: 1 }, `data.state: must be one of ${BUS_STATES.join(", ")}`],
      ["status", { state: "ready", detail: "content" }, "data.detail: is not a field of this event"],
      ["account", undefined, "data: must be an object"],
      ["account", { state: "ready" }, "data.account: is required"],
      ["account", { account: "work" }, "data.state: is required"],
      ["account", { account: "WORK", state: "ready" }, "data.account: must be an account alias: lowercase letters, digits and underscores, starting with a letter (contract §5)"],
      ["account", { account: "work", state: "signed_out" }, `data.state: must be one of ${BUS_STATES.join(", ")}`],
      ["account", { account: "work", state: "ready", extra: true }, "data.extra: is not a field of this event"],
    ]
    for (const [event, data, problem] of cases) {
      const result = await bus.emit(event, data as never)
      assert.equal(result.ok, false, `${event}: ${JSON.stringify(data)}`)
      if (result.ok) continue
      assert.equal(result.reason, "invalid")
      assert.ok(result.reason === "invalid" && result.problems.includes(problem), `${event}: expected "${problem}", got ${JSON.stringify(result)}`)
    }
    assert.deepEqual(emitted, [])
  })

  test("refuses an event the bus does not have, even from JavaScript", async () => {
    const { host, emitted } = fakeHost()
    const bus = await createBus(host, "slack")
    assert.deepEqual(await bus.emit("installed" as never, { account: "work", state: "ready" } as never), {
      ok: false,
      reason: "invalid",
      problems: ["event: must be one of changed, status, account"],
    })
    assert.deepEqual(emitted, [])
  })

  test("refuses a secret with reason secret, and echoes no part of it", async () => {
    const { host, emitted } = fakeHost()
    const bus = await createBus(host, "slack")
    const token = `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`
    const results = [
      await bus.emit("changed", changed({ reason: `after write ${token}` })),
      await bus.emit("changed", changed({ account: token })),
      await bus.emit("changed", changed({ capability: token })),
      await bus.emit("changed", { ...changed(), extra: token } as ChangedData),
    ]
    for (const result of results) assert.deepEqual(result, { ok: false, reason: "secret" })
    assert.deepEqual(emitted, [])
  })

  test("accepts prose that is not a secret", async () => {
    const { host, emitted } = fakeHost()
    const bus = await createBus(host, "slack")
    const reason = "the provider says a message arrived; re-read the source"
    assert.deepEqual(await bus.emit("changed", changed({ reason })), { ok: true })
    assert.deepEqual(emitted, [{ type: "rpc.slack.changed", data: changed({ reason }) }])
  })

  test("a value that is not JSON is refused rather than thrown", async () => {
    const { host } = fakeHost()
    const bus = await createBus(host, "slack")
    const cyclic: Record<string, unknown> = {}
    cyclic["self"] = cyclic
    const results = [await bus.emit("changed", cyclic as never), await bus.emit("changed", { capability: 1n } as never)]
    for (const result of results) {
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.reason, "invalid")
    }
  })

  test("a host that fails reports unavailable and never throws", async () => {
    const { host, fail } = fakeHost()
    const bus = await createBus(host, "slack")
    fail.value = true
    assert.deepEqual(await bus.emit("changed", changed()), { ok: false, reason: "unavailable" })
  })
})

describe("the bus reader (contract §10)", () => {
  test("reads each event of the named plugin into a typed event", () => {
    assert.deepEqual(readBusEvent(payload("rpc.slack.changed", changed()), { name: "slack" }), {
      ok: true,
      event: { type: "rpc.slack.changed", name: "slack", event: "changed", data: changed() },
    })
    assert.deepEqual(readBusEvent(payload("rpc.slack.status", { state: "ready" }), { name: "slack" }), {
      ok: true,
      event: { type: "rpc.slack.status", name: "slack", event: "status", data: { state: "ready" } },
    })
    assert.deepEqual(readBusEvent(payload("rpc.slack.account", { account: "work", state: "error" }), { name: "slack" }), {
      ok: true,
      event: { type: "rpc.slack.account", name: "slack", event: "account", data: { account: "work", state: "error" } },
    })
  })

  test("ignores the rest of the /api/event envelope", () => {
    const read = readBusEvent({ ...payload("rpc.slack.changed", changed()), location: { directory: "/work" }, metadata: { anything: true } }, { name: "slack" })
    assert.equal(read.ok, true)
  })

  test("refuses a foreign plugin, an unknown event and a non-bus event, in that order", () => {
    assert.deepEqual(readBusEvent(payload("rpc.gws.changed", changed()), { name: "slack" }), { ok: false, reason: "unknown-plugin", problems: [] })
    assert.deepEqual(readBusEvent(payload("rpc.slack.installed", changed()), { name: "slack" }), { ok: false, reason: "unknown-event", problems: [] })
    assert.deepEqual(readBusEvent(payload("rpc.slack.changed.more", changed()), { name: "slack" }), { ok: false, reason: "not-a-bus-event", problems: [] })
    for (const foreign of ["session.created", "rpc.slack", "rpc.slack.", "rpc.", "message", ""]) {
      assert.deepEqual(readBusEvent(payload(foreign, changed()), { name: "slack" }), { ok: false, reason: "not-a-bus-event", problems: [] }, foreign)
    }
    for (const notAPayload of [null, undefined, "rpc.slack.changed", 42, [], {}, { type: 42 }]) {
      assert.deepEqual(readBusEvent(notAPayload, { name: "slack" }), { ok: false, reason: "not-a-bus-event", problems: [] })
    }
  })

  test("refuses malformed data for each event, naming the field and not the value", () => {
    const cases: [string, unknown, string][] = [
      ["rpc.slack.changed", undefined, "data: must be an object"],
      ["rpc.slack.changed", { account: "work", reason: "write" }, "data.capability: is required"],
      ["rpc.slack.changed", { ...changed(), extra: "content" }, "data.extra: is not a field of this event"],
      ["rpc.slack.changed", changed({ capability: "gws.gmail" }), "data.capability: must be this plugin's capability id, slack.<capability>"],
      ["rpc.slack.changed", changed({ account: "Work" }), "data.account: must be an account alias: lowercase letters, digits and underscores, starting with a letter (contract §5)"],
      ["rpc.slack.changed", changed({ reason: "two\nlines" }), `data.reason: must be 1 to ${REASON_MAX} characters on one line`],
      ["rpc.slack.status", {}, "data.state: is required"],
      ["rpc.slack.status", { state: "signed_in" }, `data.state: must be one of ${BUS_STATES.join(", ")}`],
      ["rpc.slack.account", { state: "ready" }, "data.account: is required"],
      ["rpc.slack.account", { account: "work", state: "signed_out" }, `data.state: must be one of ${BUS_STATES.join(", ")}`],
    ]
    for (const [type, data, problem] of cases) {
      const read = readBusEvent(payload(type, data), { name: "slack" })
      assert.equal(read.ok, false, type)
      if (read.ok) continue
      assert.equal(read.reason, "invalid")
      assert.ok(read.reason === "invalid" && read.problems.includes(problem), `${type}: expected "${problem}", got ${JSON.stringify(read)}`)
    }
  })

  test("refuses a secret with reason secret, before the schema, and echoes no part of it", () => {
    const token = `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`
    const cases = [
      payload("rpc.slack.changed", changed({ reason: `after write ${token}` })),
      // Also a payload the schema would refuse: a secret is reported as a secret, never as invalid.
      payload("rpc.slack.changed", { ...changed(), extra: token }),
    ]
    for (const incoming of cases) assert.deepEqual(readBusEvent(incoming, { name: "slack" }), { ok: false, reason: "secret", problems: [] })
  })

  test("accepts prose in a reason", () => {
    const reason = "the provider says a message arrived; re-read the source"
    assert.deepEqual(readBusEvent(payload("rpc.slack.changed", changed({ reason })), { name: "slack" }), {
      ok: true,
      event: { type: "rpc.slack.changed", name: "slack", event: "changed", data: changed({ reason }) },
    })
  })

  test("a writer's accepted event reads back as the same event", async () => {
    const { host, emitted } = fakeHost()
    const bus = await createBus(host, "gws")
    const data: BusEventData["changed"] = { capability: "gws.gmail", account: "default", reason: "webhook" }
    assert.deepEqual(await bus.emit("changed", data), { ok: true })
    assert.deepEqual(readBusEvent(payload(emitted[0]!.type, emitted[0]!.data), { name: "gws" }), {
      ok: true,
      event: { type: "rpc.gws.changed", name: "gws", event: "changed", data },
    })
  })
})

describe("the bus types (contract §3, §10)", () => {
  test("the definition's event payload type is rpc.<name>.<event>", () => {
    const definition = busDefinition("slack")
    type Changed = Rpc.EventPayload<typeof definition, "changed">
    const type: Changed["type"] = "rpc.slack.changed"
    assert.equal(type, "rpc.slack.changed")
  })

  test("an OpenCode plugin context is a bus host", () => {
    const accepts = (ctx: Plugin.Context): Promise<Bus> => createBus(ctx, "slack")
    assert.equal(typeof accepts, "function")
  })

  test("the writer's emit is typed per event", () => {
    const typeChecks = async (bus: Bus): Promise<void> => {
      await bus.emit("changed", changed())
      await bus.emit("status", { state: "ready" })
      await bus.emit("account", { account: "work", state: "error" })
      // @ts-expect-error changed needs a capability, an account and a reason
      await bus.emit("changed", { state: "ready" })
      // @ts-expect-error status has no account field
      await bus.emit("status", { account: "work", state: "ready" })
      // @ts-expect-error only the three contract events exist
      await bus.emit("installed", {})
    }
    assert.equal(typeof typeChecks, "function")
  })
})
