// The bus (contract §10, §13): `register` merges `busEvents(name)` into its one RPC registration and wraps that
// registration with the typed writer, which every handler call reads as `call.bus`; an app reads one `/api/event`
// payload as a typed event or a reason. The tests hold the writer (imported from its internal module, as `register`
// does), the reader, the one derivation between them (`rpc.<name>.<event>`) and the host's registration rule: the last
// registration per id wins, so a second one would hide the plugin's methods.
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { Plugin, Rpc } from "@opencode/plugin"
import type { RpcRegistration } from "@opencode/plugin/promise/rpc"
import {
  BUS_EVENTS,
  BUS_STATES,
  type Bus,
  type BusEventName,
  type BusEvents,
  busEvents,
  busEventType,
  capabilityPattern,
  isPluginName,
  readBusEvent,
  REASON_MAX,
  type ChangedData,
} from "../src/bus.ts"
import { createBus, type BusRegistration } from "../src/bus/writer.ts"
import { makeRpcHost, RpcFailure } from "./support/rpc-host.ts"

interface Emitted {
  readonly type: string
  readonly data: unknown
}

/** A writer over a stub registration: enough for payload tests, while the RPC tests below use the faithful host. */
function stub(name = "slack"): { bus: Bus; emitted: Emitted[] } {
  const emitted: Emitted[] = []
  const bus = createBus(name, {
    events: {
      async emit(event, data) {
        emitted.push({ type: busEventType(name, event), data })
      },
    },
  })
  return { bus, emitted }
}

const changed = (overrides: Partial<ChangedData> = {}): ChangedData => ({
  capability: "slack.mentions",
  account: "work",
  reason: "write",
  ...overrides,
})

/** The JSON Schema of one event, as a record a test can read. */
function schema(events: BusEvents, event: keyof BusEvents): Record<string, unknown> {
  return events[event].schema as Record<string, unknown>
}

/** A payload as `/api/event` carries it, with the envelope fields the reader ignores. */
const payload = (type: string, data: unknown): Record<string, unknown> => ({
  id: "evt_1",
  type,
  created: 1_763_942_400,
  data,
})

/** Emit an invalid payload and return its problems, with the reason checked on the way. */
async function invalid(bus: Bus, event: BusEventName, data: unknown): Promise<readonly string[]> {
  const result = await bus.emit(event, data as never)
  if (result.ok) assert.fail(`expected ${event} to be refused`)
  assert.equal(result.reason, "invalid")
  return result.reason === "invalid" ? result.problems : []
}

describe("the bus events (contract §10)", () => {
  test("busEvents declares exactly the three events, each a closed object with its fields required", () => {
    const events = busEvents("slack")
    assert.deepEqual(Object.keys(events), [...BUS_EVENTS])
    assert.deepEqual(
      { changed: schema(events, "changed")["required"], status: schema(events, "status")["required"], account: schema(events, "account")["required"] },
      { changed: ["capability", "account", "reason"], status: ["state"], account: ["account", "state"] },
    )
    for (const event of BUS_EVENTS) {
      assert.equal(schema(events, event)["type"], "object", event)
      assert.equal(schema(events, event)["additionalProperties"], false, event)
    }
    const states = (schema(events, "status")["properties"] as Record<string, Record<string, unknown>>)["state"]!["enum"]
    assert.deepEqual(states, [...BUS_STATES])
  })

  test("busEvents builds the capability rule from the plugin name", () => {
    assert.equal(busEvents("gws").changed.schema["type"], "object")
    assert.equal(capabilityPattern("gws"), "^gws\\.[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)*$")
    assert.throws(() => busEvents("gws-plugin"), /is not a plugin name/)
  })
})

describe("the bus writer (contract §10)", () => {
  test("emits each event, and the host names it rpc.<name>.<event>", async () => {
    const { bus, emitted } = stub()
    assert.deepEqual(await bus.emit("changed", changed()), { ok: true })
    assert.deepEqual(await bus.emit("status", { state: "ready" }), { ok: true })
    assert.deepEqual(await bus.emit("account", { account: "work", state: "needs_sign_in" }), { ok: true })
    assert.deepEqual(emitted, [
      { type: "rpc.slack.changed", data: changed() },
      { type: "rpc.slack.status", data: { state: "ready" } },
      { type: "rpc.slack.account", data: { account: "work", state: "needs_sign_in" } },
    ])
  })

  test("derives the event type from the plugin name, including a one-letter name", () => {
    assert.equal(busEventType("slack", "changed"), "rpc.slack.changed")
    assert.equal(busEventType("gws", "account"), "rpc.gws.account")
    assert.equal(busEventType("x", "changed"), "rpc.x.changed")
    assert.equal(capabilityPattern("x"), "^x\\.[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)*$")
  })

  test("a plugin name that breaks contract §3 is refused", () => {
    const registration: BusRegistration = { events: { async emit() {} } }
    for (const name of ["slack-plugin", "Slack", "1".repeat(32), "sla_ck", "", " slack", "slack!"]) {
      assert.throws(() => createBus(name, registration), /is not a plugin name/, name)
    }
    assert.throws(() => createBus(42 as unknown as string, registration), /is not a plugin name/)
    assert.doesNotThrow(() => createBus("x", registration))
    for (const name of ["x", "slack", "gws", "x1", "a1", "1a", "a".repeat(31)]) assert.equal(isPluginName(name), true, name)
    for (const name of ["a".repeat(32), "slack-plugin", "Slack", "sla_ck", "", 42]) assert.equal(isPluginName(name), false, String(name))
  })

  test("refuses malformed data with its field paths and emits nothing", async () => {
    const { bus, emitted } = stub()
    const cases: [BusEventName, unknown, string][] = [
      ["changed", undefined, "expected object"],
      ["changed", null, "expected object"],
      ["changed", [], "expected object"],
      ["changed", "changed", "expected object"],
      ["changed", { account: "work", reason: "write" }, "capability"],
      ["changed", { capability: "slack.mentions", reason: "write" }, "account"],
      ["changed", { capability: "slack.mentions", account: "work" }, "reason"],
      ["changed", changed({ capability: 42 as unknown as string }), "capability"],
      ["changed", changed({ capability: "" }), "capability"],
      ["changed", changed({ capability: "gws.gmail" }), "capability"],
      ["changed", changed({ capability: "mentions" }), "capability"],
      ["changed", changed({ capability: "slack.Mentions" }), "capability"],
      ["changed", changed({ account: 42 as unknown as string }), "account"],
      ["changed", changed({ account: "Work" }), "account"],
      ["changed", changed({ account: "work-2" }), "account"],
      ["changed", changed({ account: "a".repeat(33) }), "account"],
      ["changed", changed({ reason: 42 as unknown as string }), "reason"],
      ["changed", changed({ reason: "" }), "reason"],
      ["changed", changed({ reason: "a".repeat(REASON_MAX + 1) }), "reason"],
      ["changed", changed({ reason: "two\nlines" }), "reason"],
      ["changed", { ...changed(), extra: "content" }, "extra"],
      ["status", undefined, "expected object"],
      ["status", {}, "state"],
      ["status", { state: "signed_in" }, "state"],
      ["status", { state: 1 }, "state"],
      ["status", { state: "ready", detail: "content" }, "detail"],
      ["account", undefined, "expected object"],
      ["account", { state: "ready" }, "account"],
      ["account", { account: "work" }, "state"],
      ["account", { account: "WORK", state: "ready" }, "account"],
      ["account", { account: "work", state: "signed_out" }, "state"],
      ["account", { account: "work", state: "ready", extra: true }, "extra"],
    ]
    for (const [event, data, field] of cases) {
      const problems = await invalid(bus, event, data)
      assert.ok(
        problems.some((problem) => problem.includes(field)),
        `${event}: expected a problem naming "${field}", got ${JSON.stringify(problems)}`,
      )
    }
    assert.deepEqual(emitted, [])
  })

  test("refuses an event the bus does not have, even from JavaScript", async () => {
    const { bus, emitted } = stub()
    assert.deepEqual(await bus.emit("installed" as never, { account: "work", state: "ready" } as never), {
      ok: false,
      reason: "invalid",
      problems: ["event: must be one of changed, status, account"],
    })
    assert.deepEqual(emitted, [])
  })

  test("refuses a secret with reason secret, and echoes no part of it", async () => {
    const { bus, emitted } = stub()
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

  test("a one-letter plugin reads its own rpc.x.changed event", () => {
    const data = changed({ capability: "x.mentions" })
    assert.deepEqual(readBusEvent(payload("rpc.x.changed", data), { name: "x" }), {
      ok: true,
      event: { type: "rpc.x.changed", name: "x", event: "changed", data },
    })
  })

  test("accepts prose that is not a secret", async () => {
    const { bus, emitted } = stub()
    const reason = "the provider says a message arrived; re-read the source"
    assert.deepEqual(await bus.emit("changed", changed({ reason })), { ok: true })
    assert.deepEqual(emitted, [{ type: "rpc.slack.changed", data: changed({ reason }) }])
  })

  test("a value that is not JSON is refused rather than thrown", async () => {
    const { bus } = stub()
    const cyclic: Record<string, unknown> = {}
    cyclic["self"] = cyclic
    const results = [await bus.emit("changed", cyclic as never), await bus.emit("changed", { capability: 1n } as never)]
    for (const result of results) {
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.reason, "invalid")
    }
  })

  test("a host that fails reports unavailable and never throws", async () => {
    const bus = createBus("slack", {
      events: {
        async emit() {
          throw new Error("the host is gone")
        },
      },
    })
    assert.deepEqual(await bus.emit("changed", changed()), { ok: false, reason: "unavailable" })
  })
})

describe("one registration per plugin (OpenCode 2.4.1 RPC)", () => {
  const text = {
    input: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string", minLength: 1 } } },
    output: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } },
  }

  test("the plugin's method still resolves after busEvents is merged and the writer wraps the registration", async () => {
    const host = makeRpcHost()
    const definition = { id: "slack", methods: { echo: text, broken: text }, events: busEvents("slack") }
    const registration = await host.register(definition, {
      echo: (input) => ({ text: (input as { text: string }).text }),
      broken: () => ({}),
    })
    const bus = createBus("slack", registration)
    assert.equal(host.count("slack"), 1)
    assert.deepEqual(await host.call("slack", "echo", { text: "hello" }), { text: "hello" })
    await assert.rejects(host.call("slack", "echo", {}), (error: unknown) => error instanceof RpcFailure && error.type === "rpc.invalid_input")
    await assert.rejects(host.call("slack", "broken", { text: "hello" }), (error: unknown) => error instanceof RpcFailure && error.type === "rpc.invalid_output")

    assert.deepEqual(await bus.emit("changed", changed()), { ok: true })
    assert.deepEqual(await bus.emit("status", { state: "ready" }), { ok: true })
    assert.deepEqual(await bus.emit("account", { account: "work", state: "needs_sign_in" }), { ok: true })
    assert.deepEqual(host.published.map((event) => event.type), ["rpc.slack.changed", "rpc.slack.status", "rpc.slack.account"])
    assert.equal(host.count("slack"), 1)
  })

  test("the last registration wins: a method only the first one has is rpc.method_not_found", async () => {
    const host = makeRpcHost()
    const first = await host.register({ id: "slack", methods: { one: text }, events: busEvents("slack") }, { one: () => ({ text: "one" }) })
    const second = await host.register({ id: "slack", methods: { two: text }, events: busEvents("slack") }, { two: () => ({ text: "two" }) })
    assert.equal(host.count("slack"), 2)
    await assert.rejects(host.call("slack", "one", { text: "x" }), (error: unknown) => error instanceof RpcFailure && error.type === "rpc.method_not_found")
    assert.deepEqual(await host.call("slack", "two", { text: "x" }), { text: "two" })

    await second.dispose()
    assert.deepEqual(await host.call("slack", "one", { text: "x" }), { text: "one" })
    await first.dispose()
    assert.equal(host.count("slack"), 0)
    await assert.rejects(host.call("slack", "one", { text: "x" }), (error: unknown) => error instanceof RpcFailure && error.type === "rpc.unavailable")
  })

  test("event data is validated through the converted JSON Schema", async () => {
    const host = makeRpcHost()
    const registration = await host.register({ id: "slack", methods: {}, events: busEvents("slack") }, {})
    await assert.rejects(registration.events.emit("changed", { capability: "slack.mentions", account: "work" }), /expected|missing|required/i)
    await assert.rejects(registration.events.emit("status", { state: "signed_in" }), /expected|invalid|literal|enum/i)
    await registration.events.emit("status", { state: "ready" })
    assert.deepEqual(host.published.at(-1), { type: "rpc.slack.status", data: { state: "ready" } })
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

  test("refuses a bad plugin name instead of silently matching nothing", () => {
    for (const name of ["Slack", "slack-plugin", "", "a".repeat(32)]) {
      assert.throws(() => readBusEvent(payload("rpc.slack.changed", changed()), { name }), /is not a plugin name/, name)
    }
  })

  test("refuses malformed data for each event, naming the field and not the value", () => {
    const cases: [string, unknown, string][] = [
      ["rpc.slack.changed", undefined, "expected object"],
      ["rpc.slack.changed", { account: "work", reason: "write" }, "capability"],
      ["rpc.slack.changed", { ...changed(), extra: "content" }, "extra"],
      ["rpc.slack.changed", changed({ capability: "gws.gmail" }), "capability"],
      ["rpc.slack.changed", changed({ account: "Work" }), "account"],
      ["rpc.slack.changed", changed({ reason: "two\nlines" }), "reason"],
      ["rpc.slack.status", {}, "state"],
      ["rpc.slack.status", { state: "signed_in" }, "state"],
      ["rpc.slack.account", { state: "ready" }, "account"],
      ["rpc.slack.account", { account: "work", state: "signed_out" }, "state"],
    ]
    for (const [type, data, field] of cases) {
      const read = readBusEvent(payload(type, data), { name: "slack" })
      assert.equal(read.ok, false, type)
      if (read.ok) continue
      assert.equal(read.reason, "invalid")
      assert.ok(read.reason === "invalid" && read.problems.some((problem) => problem.includes(field)), `${type}: expected a problem naming "${field}", got ${JSON.stringify(read)}`)
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
    const { bus, emitted } = stub("gws")
    const data = { capability: "gws.gmail", account: "default", reason: "webhook" }
    assert.deepEqual(await bus.emit("changed", data), { ok: true })
    assert.deepEqual(readBusEvent(payload(emitted[0]!.type, emitted[0]!.data), { name: "gws" }), {
      ok: true,
      event: { type: "rpc.gws.changed", name: "gws", event: "changed", data },
    })
  })
})

describe("the bus types (contract §3, §10)", () => {
  test("the public entry exports the reader and the block, and never the writer's factory", async () => {
    const entry = (await import("../src/bus.ts")) as Record<string, unknown>
    assert.equal(Object.hasOwn(entry, "createBus"), false, "the writer is internal to register")
    assert.equal(typeof entry["busEvents"], "function")
    assert.equal(typeof entry["readBusEvent"], "function")
  })

  test("the definition's event payload type is rpc.<name>.<event>", () => {
    const definition = {
      id: "slack",
      methods: {},
      events: busEvents("slack"),
    } as const satisfies Rpc.PortableDefinition
    type Changed = Rpc.EventPayload<typeof definition, "changed">
    const type: Changed["type"] = "rpc.slack.changed"
    assert.equal(type, "rpc.slack.changed")
  })

  test("an OpenCode 2.4.1 RpcRegistration is a bus registration", () => {
    const definition = {
      id: "slack",
      methods: { status: { input: { type: "object" }, output: { type: "object" } } },
      events: busEvents("slack"),
    } as const satisfies Rpc.PortableDefinition
    const accepts = (registration: RpcRegistration<typeof definition>): Bus => createBus("slack", registration)
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
