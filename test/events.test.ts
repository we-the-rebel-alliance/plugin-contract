// The events contract: kinds, scope, the page's optional parts, the error table, the secret-pattern refusal, and the
// conformance's opt-in checks.
import { createHash } from "node:crypto"
import { describe, test } from "node:test"
import { expect } from "./support/expect.ts"
import { failureFromError } from "../src/internal/failure.ts"
import { encodeBoundCursor, decodeBoundCursor, type CursorBinding } from "../src/cursor.ts"
import { validate } from "../src/register/validate.ts"
import {
  ACTOR_KINDS,
  ACTOR_ROLES,
  ATTENDANCE_RESPONSES,
  AUDIENCES,
  AUTHOR_ROLES,
  COMMITMENT_STATES,
  FACT_TYPES,
  factProblems,
  IDENTITY_STRENGTHS,
  errorCodeOf,
  EVENT_KINDS,
  eventHash,
  eventProblems,
  eventsListResult,
  fitPage,
  EXTENSION_KIND,
  EXTENSION_NAME,
  EXTENSION_SEGMENT_MAX,
  extensionNamespace,
  isExtensionName,
  isEventKind,
  isEventKindIn,
  sourceNamespace,
  LIST_OPTIONS_SCHEMA,
  makeEvent,
  MAX_BYTES,
  MAX_PAGE_BYTES,
  parseEventsListInput,
  parseProbeInput,
  PROBE,
  probeResult,
  probeResultProblems,
  parseSourceError,
  REMOVAL_REASONS,
  removalProblems,
  resultProblems,
  screenEvents,
  secretKinds,
  SourceError,
  startTime,
  type EventsListInput,
  type SourceEvent,
} from "../src/events.ts"

const T0 = Date.parse("2026-11-01T09:00:00Z")
const OWNER = { id: "mailto:sam@example.com", label: "sam@example.com" }
const WHOSE = { source: "demo", account: "work", owner: OWNER }
const event = (index: number, extra: Partial<Parameters<typeof makeEvent>[0]> = {}): SourceEvent =>
  makeEvent({ source: "demo", account: "work", external_id: `item-${index}`, kind: "message", occurred_at: T0 + index * 60_000, title: `Item ${index}`, text: `Text ${index}`, ...extra })

describe("kinds", () => {
  test("adds task and file to the nine, and takes x-<plugin>/<kind>", () => {
    expect(EVENT_KINDS.slice(9)).toEqual(["task", "file"])
    for (const kind of ["task", "file", "x-acme/reminder", "x-gws/label-change"]) {
      expect(isEventKind(kind), kind).toBe(true)
      expect(eventProblems(event(1, { kind: kind as never })), kind).toEqual([])
    }
    for (const kind of ["tweet", "x-/a", "x-acme", "x-Acme/run", "x-acme/Run", `x-acme/${"a".repeat(60)}`]) expect(isEventKind(kind), kind).toBe(false)
  })

  test("one length rule for kinds and outputs: each segment 1 to 32 characters (plugin-contract#21)", () => {
    const max = "a".repeat(EXTENSION_SEGMENT_MAX)
    expect(EXTENSION_SEGMENT_MAX).toBe(32)
    expect(isEventKind(`x-${max}/${max}`)).toBe(true)
    expect(isExtensionName(`x-${max}/${max}`)).toBe(true)
    expect(isEventKind(`x-${max}a/run`)).toBe(false)
    expect(isEventKind(`x-acme/${max}a`)).toBe(false)
    expect(isExtensionName("x-acme/receipt")).toBe(true)
    expect(isExtensionName("message")).toBe(false)
    expect(EXTENSION_KIND).toBe(EXTENSION_NAME)
  })
})

describe("extension kinds and their namespace (Q13, plugin-contract#15)", () => {
  test("x-acme/reminder is a kind, in acme's namespace and no other", () => {
    expect(isEventKind("x-acme/reminder")).toBe(true)
    expect(extensionNamespace("x-acme/reminder")).toBe("acme")
    expect(extensionNamespace("meeting")).toBeUndefined()
    expect(extensionNamespace("x-acme")).toBeUndefined()
    expect(sourceNamespace("acme.reminders")).toBe("acme")
    expect(sourceNamespace("gws.gmail")).toBe("gws")
    expect(isEventKindIn("x-acme/reminder", sourceNamespace("acme.reminders"))).toBe(true)
    expect(isEventKindIn("meeting", "acme")).toBe(true)
    expect(isEventKindIn("x-other/suggestion", "acme")).toBe(false)
    expect(isEventKindIn("x-acme/Run", "acme")).toBe(false)
  })

})

describe("probe (plugin-contract#8, #4)", () => {
  test("is one method, probe, taking only source and account", () => {
    expect(PROBE).toBe("probe")
    expect(parseProbeInput({})).toEqual({ ok: true, value: {} })
    expect(parseProbeInput(undefined)).toEqual({ ok: true, value: {} })
    expect(parseProbeInput({ source: "gmail", account: "work" })).toEqual({ ok: true, value: { source: "gmail", account: "work" } })
    expect(parseProbeInput({ source: "gmail", limit: 0 })).toEqual({ ok: false, problems: ['"limit" is not an input of probe'] })
    expect((parseProbeInput({ source: "Gmail", account: "" }) as { problems: string[] }).problems).toHaveLength(2)
  })

  test("answers source, account, owner { id, label }, the sign-in's scopes and X's probe cost, untrusted", () => {
    const answer = probeResult(WHOSE, { scopes: ["gmail.readonly", "gmail.readonly"], cost: { units: [{ per: "call", count: 1 }], usd: 0.01 } })
    expect(answer).toEqual({ source: "demo", account: "work", owner: OWNER, scopes: ["gmail.readonly"], cost: { units: [{ per: "call", count: 1 }], usd: 0.01 }, trust: "untrusted" })
    expect(probeResultProblems(answer, { source: "demo", account: "work" })).toEqual([])
    expect(probeResultProblems(probeResult(WHOSE))).toEqual([])
  })

  test("finds a probe that read content, has no owner label, or answers for another source or account", () => {
    const answer = probeResult(WHOSE)
    expect(probeResultProblems({ ...answer, events: [] })).toEqual([expect.stringContaining('the field "events": a probe reads no content')])
    expect(probeResultProblems({ ...answer, owner: { id: OWNER.id } })).toEqual(["the probe answer's owner.label must be one non-empty line of at most 200 characters"])
    expect(probeResultProblems({ ...answer, owner: null })).toHaveLength(1)
    // docs/contract.md: an owner's id is scheme-qualified. gws once answered the bare address (Wave 1 review).
    expect(probeResultProblems({ ...answer, owner: { id: "sam@example.com", label: "sam@example.com" } })).toEqual([
      "the probe answer's owner.id must be a scheme-qualified id such as mailto:someone@example.com or slack:U0123",
    ])
    for (const id of ["mailto:sam@example.com", "slack:U0123", "x:@fixture-samrivera", "os-user:sam@studio-mac", "linear:4f1c2e9a-0000-4000-8000-000000000001"]) {
      expect(probeResultProblems({ ...answer, owner: { id, label: "Sam" } }), id).toEqual([])
    }
    expect(probeResultProblems({ ...answer, owner: { id: "Mailto:sam@example.com", label: "Sam" } })).toHaveLength(1)
    expect(probeResultProblems({ ...answer, owner: { id: "mailto: sam", label: "Sam" } })).toHaveLength(1)
    expect(probeResultProblems(answer, { source: "gmail" })).toEqual(["the probe answer names the source demo, not gmail"])
    expect(probeResultProblems(answer, { account: "home" })).toEqual(["the probe answer names another account than the one asked for"])
    expect(probeResultProblems({ ...answer, trust: "trusted" })).toEqual([expect.stringContaining("trust")])
    expect(probeResultProblems({ ...answer, scopes: ["a", "a"] })).toEqual([expect.stringContaining("scopes")])
    expect(probeResultProblems({ ...answer, cost: { units: [{ per: "call", count: -1 }] } })).toEqual([expect.stringContaining("the probe answer's cost")])
  })
})

describe("a weak owner (#30, item 13)", () => {
  const WEAK = { id: "wisprflow:credential:abc123", label: "Wispr Flow sign-in", verified: false as const }

  test("a probe answer and a page may mark their owner unverified; probeResult carries it", () => {
    const answer = probeResult({ ...WHOSE, owner: WEAK })
    expect(answer.owner).toEqual(WEAK)
    expect(probeResultProblems(answer)).toEqual([])
    expect(probeResult(WHOSE).owner).toEqual(OWNER)
    expect(resultProblems(eventsListResult({ ...WHOSE, owner: WEAK }, [event(1)], "c", false))).toEqual([])
  })

  test("verified may only be false (absent is the vouched owner), and no other owner key is allowed", () => {
    expect(probeResultProblems({ ...probeResult(WHOSE), owner: { ...OWNER, verified: true } })).toEqual(["the probe answer's owner.verified must be false, or left out for an owner the provider named"])
    expect(probeResultProblems({ ...probeResult(WHOSE), owner: { ...OWNER, verified: "no" } })).toEqual(["the probe answer's owner.verified must be false, or left out for an owner the provider named"])
    expect(resultProblems({ ...eventsListResult(WHOSE, [], "c", false), owner: { ...OWNER, verified: 0 } })).toEqual(["the result's owner.verified must be false, or left out for an owner the provider named"])
    expect(probeResultProblems({ ...probeResult(WHOSE), owner: { ...OWNER, trust: "weak" } })).toEqual(['the probe answer\'s owner has the field "trust", which the contract does not define'])
  })
})

describe("scope input", () => {
  test("is refused unless the source declares scope keys", () => {
    expect(parseEventsListInput({ scope: { label: "INBOX" } })).toEqual({ ok: false, problems: ['"scope" is not an input of events_list'] })
  })

  test("with declared keys, is checked and made canonical, naming keys and never values", () => {
    const parse = (scope: unknown) => parseEventsListInput({ scope }, { scopeKeys: ["label", "channels"] })
    expect(parse({ label: ["b", "a", "a"] })).toEqual({ ok: true, value: { limit: 100, scope: { label: ["a", "b"] } } })
    expect(parse({ repo: "x" })).toEqual({ ok: false, problems: ['"scope.repo" is not a scope key of this source'] })
    expect((parse({ label: ["ok", ""] }) as { problems: string[] }).problems).toEqual([expect.stringContaining('"scope.label" must be')])
    expect((parse({ label: "x\ny" }) as { problems: string[] }).problems).toHaveLength(1)
    expect((parse("INBOX") as { problems: string[] }).problems).toEqual(['"scope" must be an object of the source\'s scope keys'])
    expect(JSON.stringify(parse({ label: "secret-label\u0000" }))).not.toContain("secret-label")
  })
})

describe("the default page cap (Q10)", () => {
  test("is the descriptor's default maxBytes, 64 KB", () => {
    expect(MAX_PAGE_BYTES).toBe(MAX_BYTES.default)
    expect(MAX_PAGE_BYTES).toBe(65_536)
  })
})

describe("removals[] (#27)", () => {
  const AS_OF = "2026-11-01T10:00:00.000Z"
  const removal = (id: string, reason: "deleted" | "withheld" | "expired" = "deleted", at = "2026-11-01T09:30:00.000Z") => ({ external_id: id, at, reason })

  test("a page may name what the source no longer stands behind, and the builder leaves an empty list out", () => {
    expect(REMOVAL_REASONS).toEqual(["deleted", "withheld", "expired"])
    const page = eventsListResult(WHOSE, [event(1)], "c", false, { asOf: AS_OF, removals: [removal("item-7"), removal("item-8", "withheld")] })
    expect(page.removals).toEqual([removal("item-7"), removal("item-8", "withheld")])
    expect(resultProblems(page)).toEqual([])
    expect(Object.hasOwn(eventsListResult(WHOSE, [], "c", false, { removals: [] }), "removals")).toBe(false)
  })

  test("a removal may name an id that is also a tombstone event on the same page (rule 7)", () => {
    const tombstone = event(9, { title: "", text: "", labels: ["gone"] })
    const page = eventsListResult(WHOSE, [tombstone], "c", false, { asOf: AS_OF, removals: [removal("item-9")] })
    expect(resultProblems(page)).toEqual([])
  })

  test("finds each way removals[] breaks the contract", () => {
    const problems = (removals: unknown, extra: Record<string, unknown> = {}) => removalProblems({ ...eventsListResult(WHOSE, [], "c", false, { asOf: AS_OF }), removals, ...extra })
    expect(problems([{ ...removal("a"), hash: "sha256:x" }])).toEqual(['removals[0] has the field "hash", which the contract does not define'])
    expect(problems([{ at: "2026-11-01T09:00:00.000Z", reason: "deleted" }])).toEqual([expect.stringContaining("removals[0].external_id")])
    expect(problems([removal("a", "deleted", "2026-11-01")])).toEqual(["removals[0].at must be a UTC ISO date-time ending in Z"])
    expect(problems([removal("a", "gone" as never)])).toEqual(["removals[0].reason must be one of deleted, withheld, expired"])
    expect(problems([removal("a"), removal("a", "withheld")])).toEqual(["the result's removals lists one event twice"])
    expect(problems([removal("a", "deleted", "2026-11-01T11:00:00.000Z")])).toEqual(["removals[0].at is later than the page's asOf"])
    expect(problems([removal("a")], { failed: [{ external_id: "a", code: "UNAVAILABLE" }] })).toEqual(["an event is both removed and failed: a removal is final, so nothing is retried"])
    expect(problems("a")).toEqual(["the result's removals must be a list of at most 500"])
    expect(problems(Array.from({ length: 501 }, (_, i) => removal(`id-${i}`)))).toEqual(["the result's removals must be a list of at most 500"])
    // Without asOf, at is only checked for its form.
    expect(removalProblems({ ...eventsListResult(WHOSE, [], "c", false), removals: [removal("a", "deleted", "2099-01-01T00:00:00.000Z")] })).toEqual([])
    // resultProblems carries the same problems, so read refuses such a page.
    expect(resultProblems({ ...eventsListResult(WHOSE, [], "c", false, { asOf: AS_OF }), removals: [removal("a", "gone" as never)] })).toEqual(["removals[0].reason must be one of deleted, withheld, expired"])
  })
})

describe("the list-options answer (LIST_OPTIONS_SCHEMA)", () => {
  test("is { options: [{ id, label? }] }, closed at both levels", () => {
    expect(LIST_OPTIONS_SCHEMA).toMatchObject({ type: "object", required: ["options"], additionalProperties: false })
    const options = (LIST_OPTIONS_SCHEMA.properties as Record<string, Record<string, unknown>>)["options"]!
    expect(options["type"]).toBe("array")
    expect(options["items"]).toMatchObject({
      type: "object",
      properties: { id: { type: "string", minLength: 1 }, label: { type: "string", maxLength: 200 } },
      required: ["id"],
      additionalProperties: false,
    })
  })

  test("accepts an id with or without a label, and refuses an option without an id or with an unknown key", () => {
    expect(validate(LIST_OPTIONS_SCHEMA, { options: [{ id: "C1", label: "general" }, { id: "D2" }] }).ok).toBe(true)
    expect(validate(LIST_OPTIONS_SCHEMA, { options: [] }).ok).toBe(true)
    expect(validate(LIST_OPTIONS_SCHEMA, { options: [{ label: "general" }] }).ok).toBe(false)
    expect(validate(LIST_OPTIONS_SCHEMA, { options: [{ id: "" }] }).ok).toBe(false)
    expect(validate(LIST_OPTIONS_SCHEMA, { options: [{ id: "C1", label: "x".repeat(201) }] }).ok).toBe(false)
    expect(validate(LIST_OPTIONS_SCHEMA, { options: [{ id: "C1", extra: true }] }).ok).toBe(false)
    expect(validate(LIST_OPTIONS_SCHEMA, { options: [], extra: true }).ok).toBe(false)
    expect(validate(LIST_OPTIONS_SCHEMA, {}).ok).toBe(false)
  })
})

describe("the page result", () => {
  const ok = (extras: Parameters<typeof eventsListResult>[4]) => resultProblems(eventsListResult(WHOSE, [event(1), event(2)], "c", false, extras))

  test("a page without optional parts is valid, and the builder writes nothing new without extras", () => {
    const page = eventsListResult(WHOSE, [event(1)], "c", false)
    expect(Object.keys(page)).toEqual(["source", "account", "owner", "events", "cursor", "more", "trust"])
    expect(resultProblems(page)).toEqual([])
  })

  test("takes refused, failed, gap, cost, scope, plugin and asOf, and leaves out empty lists", () => {
    const page = eventsListResult(WHOSE, [event(1)], "c", true, {
      scope: { label: ["b", "a"] },
      refused: [{ external_id: "item-9", reason: "secret", detail: "holds a secret (token)" }],
      failed: [{ external_id: "item-8", code: "RATE_LIMITED", retryAfterSec: 30 }],
      gap: { reason: "expired", since: "2026-10-01T00:00:00.000Z" },
      cost: { units: [{ per: "post", count: 1 }, { per: "author", count: 1 }], usd: 0.015 },
      plugin: "opencode-x",
      asOf: "2026-11-01T09:05:00.000Z",
    })
    expect(page.scope).toEqual({ label: ["a", "b"] })
    expect(resultProblems(page)).toEqual([])
    expect(Object.hasOwn(eventsListResult(WHOSE, [], "c", false, { refused: [], failed: [] }), "refused")).toBe(false)
  })

  test("finds each way an addition breaks the contract", () => {
    expect(ok({ refused: [{ external_id: "item-1", reason: "secret" }] })).toEqual(["refused[0] is also among the result's events"])
    expect(ok({ refused: [{ external_id: "x", reason: "spam" as never }] })).toEqual([expect.stringContaining("refused[0].reason must be one of instruction, secret, owner")])
    expect(ok({ refused: [{ external_id: "x", reason: "secret", detail: "a\nb" }] })).toEqual([expect.stringContaining("detail")])
    expect(ok({ refused: [{ external_id: "x", reason: "secret" }, { external_id: "x", reason: "owner" }] })).toEqual(["the result's refused lists one event twice"])
    expect(ok({ failed: [{ external_id: "x", code: "rate limited" }] })).toEqual([expect.stringContaining("failed[0].code")])
    expect(ok({ failed: [{ external_id: "x", code: "RATE_LIMITED", retryAfterSec: 1.5 }] })).toEqual([expect.stringContaining("retryAfterSec")])
    expect(ok({ refused: [{ external_id: "x", reason: "owner" }], failed: [{ external_id: "x", code: "UNAVAILABLE" }] })).toEqual(["an event is both refused and failed"])
    expect(ok({ gap: { reason: "sync-token-expired" as never, since: "2026-10-01T00:00:00Z" } })).toEqual([expect.stringContaining("gap")])
    expect(ok({ gap: { reason: "expired", since: "2026-10-01" } })).toEqual([expect.stringContaining("gap")])
    expect(ok({ gap: { reason: "expired", since: "2026-10-01T00:00:00Z", until: "2026-10-02T00:00:00Z" } as never })).toEqual([expect.stringContaining("gap")])
    expect(ok({ cost: { units: [{ per: "post", count: -1 }] } })).toEqual([expect.stringContaining("cost")])
    expect(ok({ cost: { units: [], usd: -0.01 } })).toEqual([expect.stringContaining("cost")])
    expect(ok({ asOf: "now" })).toEqual([expect.stringContaining("asOf")])
    expect(resultProblems({ ...eventsListResult(WHOSE, [], "c", false), scope: { b: "1", a: "2" } })).toEqual([expect.stringContaining("canonical")])
  })

  test("a page within the descriptor's maxBytes, which fitPage takes", () => {
    const big = Array.from({ length: 40 }, (_, index) => event(index, { text: "y".repeat(4_000) }))
    const fits = fitPage(big, 500, 65_536)
    expect(fits).toBeGreaterThan(5)
    expect(fits).toBeLessThan(40)
    expect(resultProblems(eventsListResult(WHOSE, big.slice(0, fits), "c", true), 500, 65_536)).toEqual([])
    expect(resultProblems(eventsListResult(WHOSE, big, "c", true), 500, 65_536)).toEqual([expect.stringContaining("over 65536")])
  })
})

describe("errors", () => {
  test("reads the contract's form, and carries retryAfterSec and gap", () => {
    const expired = new SourceError({ code: "CURSOR_EXPIRED", what: "Gmail no longer keeps history 1010.", next: "Call events_list with since.", gap: { reason: "expired", since: "2026-10-01T00:00:00.000Z" } })
    expect(expired.message).toBe("CURSOR_EXPIRED: Gmail no longer keeps history 1010. Next step: Call events_list with since.")
    expect(expired.gap).toEqual({ reason: "expired", since: "2026-10-01T00:00:00.000Z" })
    expect(parseSourceError(expired)).toEqual({ code: "CURSOR_EXPIRED", canonical: "CURSOR_EXPIRED", what: "Gmail no longer keeps history 1010.", next: "Call events_list with since." })
    // A code the table does not hold is read as itself, with no canonical code: AUTH_REQUIRED is not in the table.
    expect(parseSourceError(new Error("AUTH_REQUIRED: the sign-in expired. Next step: Run /connect."))).toEqual({ code: "AUTH_REQUIRED", what: "the sign-in expired", next: "Run /connect." })
    expect(parseSourceError(new Error("EVENTS_CURSOR_INVALID: no. Next step: x."))?.canonical).toBeUndefined()
    expect(parseSourceError(new Error("GWS_VALIDATION_ERROR: Limit: Too big. Next step: x."))).toEqual({ code: "GWS_VALIDATION_ERROR", what: "Limit: Too big", next: "x." })
    expect(parseSourceError(new Error("The cursor is invalid or has expired."))).toBeUndefined()
    for (const code of ["SCOPE_MISSING", "BUDGET_EXCEEDED", "SOURCE_DISABLED", "INPUT_INVALID", "SOURCE_UNKNOWN", "ACCOUNT_UNKNOWN", "ACCOUNT_REQUIRED", "PLAN_INVALID", "PLAN_USED", "GRANT_INVALID", "HOST_UNTESTED", "OPTIONS_INVALID"]) expect(errorCodeOf(code)).toBe(code)
    expect(errorCodeOf("AUTH_REQUIRED")).toBeUndefined()
    expect(parseSourceError(new Error("ACCOUNT_UNKNOWN: there is no account 'work'. Next step: Pass a known account."))?.canonical).toBe("ACCOUNT_UNKNOWN")
    expect(new SourceError({ code: "RATE_LIMITED", what: "x", next: "Wait.", retryAfterSec: 60 }).retryAfterSec).toBe(60)
  })
})

describe("read's failures take the table", () => {
  test("a plugin's ACCOUNT_UNKNOWN reaches read as itself, not UNAVAILABLE", () => {
    const failed = failureFromError(new Error("ACCOUNT_UNKNOWN: there is no account 'work'. Next step: Pass a known account."))
    expect(failed.code).toBe("ACCOUNT_UNKNOWN")
    expect(failed.next).toBe("Pass a known account.")
    expect(failureFromError(Object.assign(new Error("no such account"), { data: { code: "ACCOUNT_UNKNOWN", next: "Pass a known account." } })).code).toBe("ACCOUNT_UNKNOWN")
  })

  test("NEEDS_SIGN_IN passes through the table, so read never reports a sign-in as UNAVAILABLE", () => {
    expect(failureFromError(new Error("NEEDS_SIGN_IN: the sign-in expired. Next step: Sign in again.")).code).toBe("NEEDS_SIGN_IN")
    expect(failureFromError(new Error("AUTH_REQUIRED: the sign-in expired. Next step: Sign in again.")).code).toBe("UNAVAILABLE")
  })
})

describe("the secret-pattern refusal", () => {
  test("is the ported detector: tokens, keys, private keys and credential assignments, not prose or placeholders", () => {
    expect(secretKinds("ghp_abcdefghijklmnop1234")).toEqual(["token"])
    expect(secretKinds("AKIAABCDEFGHIJKLMNOP")).toEqual(["api key"])
    expect(secretKinds("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")).toEqual(["private key"])
    expect(secretKinds("password = hunter2!x")).toEqual(["password"])
    expect(secretKinds("postgres://app:s3cr3t@db.internal/app")).toEqual(["connection string"])
    for (const clean of ["password: rotated quarterly", "token: 4096", "api_key=<your-key-here>", "Let's review the plan on Monday", "sk-example"]) expect(secretKinds(clean), clean).toEqual([])
  })

  test("screenEvents refuses an event that is not the owner's, holds a secret, or is instruction-shaped, never echoing it", () => {
    const events = [event(1), event(2, { text: "the key is ghp_abcdefghijklmnop1234" }), event(3), event(4)]
    const screened = screenEvents(events, { ownedBy: (e) => e.external_id !== "item-3", instruction: (e) => e.external_id === "item-4" })
    expect(screened.events.map((e) => e.external_id)).toEqual(["item-1"])
    expect(screened.refused).toEqual([
      { external_id: "item-2", reason: "secret", detail: "holds a secret (token)" },
      { external_id: "item-3", reason: "owner" },
      { external_id: "item-4", reason: "instruction" },
    ])
    expect(JSON.stringify(screened.refused)).not.toContain("ghp_")
  })
})

// ── Actors, metadata and facts ────────────────────────────────────────────

/** The hash of the base fields only: the fields in their fixed order, and nothing else. */
const baseHash = (e: SourceEvent): string => {
  const fields = [e.source, e.account, e.external_id, e.kind, e.occurred_at, e.thread, e.actors.map((actor) => [actor.role, actor.id, actor.name ?? null]), e.title, e.text, e.url, e.labels]
  return `sha256:${createHash("sha256").update(JSON.stringify(fields)).digest("hex")}`
}

/** An event with one actor, so an actor's metadata can be read in place. */
const withActor = (actor: Record<string, unknown>): SourceEvent => makeEvent({ source: "demo", account: "work", external_id: "item-1", kind: "message", occurred_at: T0, actors: [actor as never] })

describe("actor metadata (#45 §1)", () => {
  test("an actor may say what kind it is: a person, an agent, a bot or a service", () => {
    expect(ACTOR_KINDS).toEqual(["person", "agent", "bot", "service"])
    for (const kind of ACTOR_KINDS) expect(eventProblems(withActor({ role: "from", id: "slack:U01", kind })), kind).toEqual([])
    expect(eventProblems(withActor({ role: "from", id: "slack:U01", kind: "robot" }))).toEqual(["event.actors[0].kind must be person, agent, bot or service"])
    expect(eventProblems(withActor({ role: "from", id: "slack:U01", kind: "Agent" }))).toHaveLength(1)
  })

  test("the roles are a vocabulary, and an unknown role is read as involved", () => {
    expect(ACTOR_ROLES).toEqual(["from", "author", "to", "cc", "bcc", "mentioned", "assignee", "creator", "reviewer", "organizer", "attendee", "owner", "speaker", "agent"])
    expect(AUTHOR_ROLES).toEqual(["from", "author"])
    for (const role of ACTOR_ROLES) expect(eventProblems(withActor({ role, id: "slack:U01" })), role).toEqual([])
    expect(eventProblems(withActor({ role: "stakeholder", id: "slack:U01" }))).toEqual([])
  })

  test("several `from` actors stay valid: a consumer reads the first, or else the first `author`", () => {
    // A `From` header may carry several addresses, and gws lists one `from` actor for each. That page is valid under
    // v0.2 and stays valid, so neither `read` nor the page checks refuse it; the kit's `one-author` is a plugin's
    // authoring-time check instead.
    const two = makeEvent({ source: "demo", account: "work", external_id: "item-1", kind: "message", occurred_at: T0, actors: [{ role: "from", id: "mailto:a@example.com" }, { role: "from", id: "mailto:b@example.com" }] })
    expect(eventProblems(two)).toEqual([])
    expect(two.actors.map((actor) => actor.id)).toEqual(["mailto:a@example.com", "mailto:b@example.com"])
    const alias = makeEvent({ source: "demo", account: "work", external_id: "item-1", kind: "message", occurred_at: T0, actors: [{ role: "author", id: "mailto:a@example.com" }, { role: "to", id: "mailto:b@example.com" }] })
    expect(eventProblems(alias)).toEqual([])
    const mixed = makeEvent({ source: "demo", account: "work", external_id: "item-1", kind: "message", occurred_at: T0, actors: [{ role: "author", id: "mailto:a@example.com" }, { role: "from", id: "mailto:b@example.com" }] })
    expect(eventProblems(mixed)).toEqual([])
    // The order the page lists them in is the order a consumer reads: from first, and author as its alias.
    expect(AUTHOR_ROLES).toEqual(["from", "author"])
  })

  test("identities say where each id comes from: a strength, and the provider field that is its basis", () => {
    expect(IDENTITY_STRENGTHS).toEqual(["strong", "weak"])
    expect(eventProblems(withActor({ role: "from", id: "mailto:sam@example.com", identities: [
      { id: "slack:U01", strength: "strong", basis: "slack.profile.email" },
      { id: "gmail:reply-to", strength: "weak", basis: "gmail.header.reply-to" },
    ] }))).toEqual([])
    expect(eventProblems(withActor({ role: "from", id: "slack:U01", self: true }))).toEqual([])
    expect(eventProblems(withActor({ role: "from", id: "slack:U01", self: false }))).toEqual([])
  })

  test("finds each way an actor's identities break the contract", () => {
    const actor = (identities: unknown, extra: Record<string, unknown> = {}) => eventProblems(withActor({ role: "from", id: "slack:U01", identities, ...extra }))
    expect(actor([{ id: "U02", strength: "weak", basis: "slack.profile.name" }])).toEqual(["event.actors[0].identities[0].id must be a scheme-qualified id such as mailto:someone@example.com"])
    expect(actor([{ id: "slack:U01", strength: "weak", basis: "slack.profile.name" }])).toEqual(["event.actors[0].identities[0].id is the actor's own id: an identity is another id for the same actor"])
    expect(actor([{ id: "slack:U02", strength: "weak", basis: "slack.profile.name" }, { id: "slack:U02", strength: "strong", basis: "slack.profile.email" }])).toEqual(["event.actors[0].identities[1] repeats an identity"])
    expect(actor([{ id: "slack:U02", strength: "certain", basis: "slack.profile.name" }])).toEqual(["event.actors[0].identities[0].strength must be strong or weak"])
    expect(actor([{ id: "slack:U02", strength: "weak" }])).toEqual([expect.stringContaining("event.actors[0].identities[0].basis")])
    expect(actor([{ id: "slack:U02", strength: "weak", basis: "" }])).toHaveLength(1)
    expect(actor([{ id: "slack:U02", strength: "weak", basis: "a".repeat(65) }])).toEqual(["event.actors[0].identities[0].basis must be one line of at most 64 characters naming the provider field it came from"])
    expect(actor([{ id: "slack:U02", strength: "weak", basis: "slack.profile.name", claim: "person" }])).toEqual(['event.actors[0].identities[0] has the field "claim", which the contract does not define'])
    expect(actor(Array.from({ length: 11 }, (_, index) => ({ id: `slack:U${index}`, strength: "weak", basis: "slack.profile.name" })))).toEqual(["event.actors[0].identities must be a list of at most 10"])
    expect(actor(undefined, { self: "yes" })).toEqual(["event.actors[0].self must be true or false"])
  })
})

describe("event metadata (#45 §2)", () => {
  /** An event with a field replaced, hashed as it is: the checks see what a plugin sent, not what `makeEvent` tidies. */
  const withEvent = (extra: Record<string, unknown>): Record<string, unknown> => {
    const { hash: _hash, ...built } = { ...event(1), ...extra } as Record<string, unknown>
    return { ...built, hash: eventHash(built as never) }
  }

  test("a reply names its parent, and an audience says who the item was for", () => {
    expect(AUDIENCES).toEqual(["dm", "group", "channel", "email", "public"])
    expect(eventProblems(event(1, { reply_to: "gmail-message:<CAF=abc@mail.example.com>", audience: "email" }))).toEqual([])
    for (const audience of AUDIENCES) expect(eventProblems(event(1, { audience })), audience).toEqual([])
    expect(eventProblems(withEvent({ audience: "team" }))).toEqual(["event.audience must be dm, group, channel, email or public"])
    expect(eventProblems(withEvent({ reply_to: "" }))).toEqual(["event.reply_to must be a non-empty id of at most 512 characters"])
    expect(eventProblems(withEvent({ reply_to: "a".repeat(513) }))).toEqual(["event.reply_to must be a non-empty id of at most 512 characters"])
    // `makeEvent` keeps a reply on one line and cuts it to the limit, as it does a title.
    expect(event(1, { reply_to: "  gmail-message:1  " }).reply_to).toBe("gmail-message:1")
  })

  test("domains are the recipients' lowercase domains, at most 20", () => {
    expect(eventProblems(event(1, { domains: ["example.com", "mail.example.org"] }))).toEqual([])
    expect(eventProblems(withEvent({ domains: ["Example.com"] }))).toEqual(["event.domains[0] must be a lowercase domain such as example.com"])
    expect(eventProblems(withEvent({ domains: ["example"] }))).toHaveLength(1)
    expect(eventProblems(withEvent({ domains: ["example.com", "example.com"] }))).toEqual(["event.domains repeats a domain"])
    expect(eventProblems(withEvent({ domains: Array.from({ length: 21 }, (_, index) => `example${index}.com`) }))).toEqual(["event.domains must be at most 20 lowercase domains"])
    expect(eventProblems(withEvent({ domains: "example.com" }))).toHaveLength(1)
    // `makeEvent` lowercases and de-duplicates what a plugin gives it.
    expect(event(1, { domains: ["Example.com", "example.com"] }).domains).toEqual(["example.com"])
  })

  test("sections hold meeting notes by heading, each text past the event's own 4,096", () => {
    expect(eventProblems(event(1, { sections: [{ heading: "Summary", text: "We agreed the date." }, { heading: "Action items", text: "a".repeat(4096) }] }))).toEqual([])
    expect(eventProblems(withEvent({ sections: [{ heading: "Summary", text: "", extra: true }] }))).toEqual(['event.sections[0] has the field "extra", which the contract does not define'])
    expect(eventProblems(withEvent({ sections: [{ heading: "", text: "We agreed." }] }))).toEqual(["event.sections[0].heading must be one line of at most 300 characters"])
    expect(eventProblems(withEvent({ sections: [{ heading: "a".repeat(301), text: "" }] }))).toHaveLength(1)
    expect(eventProblems(withEvent({ sections: [{ heading: "Summary", text: "a".repeat(4097) }] }))).toEqual(["event.sections[0].text must be at most 4096 characters"])
    expect(eventProblems(withEvent({ sections: Array.from({ length: 21 }, () => ({ heading: "Summary", text: "x" })) }))).toEqual(["event.sections must be a list of at most 20"])
    expect(eventProblems(withEvent({ sections: [{ heading: "Summary" }] }))).toHaveLength(1)
    // An event's own text is cut at 4,096, so long notes go in sections, and a section keeps its own 4,096.
    expect(event(1, { sections: [{ heading: "Minutes", text: "a".repeat(5000) }] }).sections?.[0]?.text).toHaveLength(4096)
  })

  test("parts list a growing item, and a part's actor names an actor on the same event", () => {
    const parts = [{ id: "turn-1", text: "Hello", actor: "mailto:sam@example.com" }, { id: "turn-2", text: "Hi" }]
    const actors = [{ role: "from", id: "mailto:sam@example.com" }]
    const withParts = (value: unknown) => eventProblems({ ...withEvent({ kind: "session", actors, parts: value }), actors })
    expect(eventProblems(makeEvent({ source: "demo", account: "work", external_id: "item-1", kind: "session", occurred_at: T0, actors: actors as never, parts }))).toEqual([])
    expect(withParts([{ id: "turn-1", text: "Hello", actor: "mailto:nobody@example.com" }])).toEqual(["event.parts[0].actor is not an actor of the same event"])
    expect(withParts([{ id: "turn-1", text: "Hello", extra: true }])).toEqual(['event.parts[0] has the field "extra", which the contract does not define'])
    expect(withParts([{ id: "", text: "Hello" }])).toEqual(["event.parts[0].id must be a non-empty id of at most 512 characters"])
    expect(withParts([{ id: "turn-1", text: "a".repeat(4097) }])).toEqual(["event.parts[0].text must be at most 4096 characters"])
    expect(withParts([{ id: "turn-1", text: "Hello" }, { id: "turn-1", text: "Hello again" }])).toEqual(["event.parts[1].id repeats a part"])
    expect(withParts(Array.from({ length: 51 }, (_, index) => ({ id: `turn-${index}`, text: "x" })))).toEqual(["event.parts must be a list of at most 50"])
  })
})

describe("facts[] (#45 §3)", () => {
  const ACTORS = [{ role: "assignee", id: "linear:4f1c2e9a-0000-4000-8000-000000000001" }, { role: "creator", id: "linear:4f1c2e9a-0000-4000-8000-000000000002" }]
  const COMMITMENT = { type: "commitment", key: "issue-42", title: "Send the report", owner: "linear:4f1c2e9a-0000-4000-8000-000000000001", due: "2026-11-30", state: "open", url: "https://linear.app/example/issue/EX-1" }
  const withFacts = (facts: unknown) => eventProblems(makeEvent({ source: "demo", account: "work", external_id: "item-1", kind: "issue", occurred_at: T0, actors: ACTORS as never, facts: facts as never }))

  test("the three core fact types, with no plugin-defined type", () => {
    expect(FACT_TYPES).toEqual(["commitment", "person.attribute", "meeting.attended"])
    expect(COMMITMENT_STATES).toEqual(["open", "done", "cancelled"])
    expect(ATTENDANCE_RESPONSES).toEqual(["accepted", "declined", "tentative", "needs_action"])
    expect(withFacts([
      COMMITMENT,
      { type: "person.attribute", actor: "linear:4f1c2e9a-0000-4000-8000-000000000001", org: "Example", role: "Engineer" },
      { type: "meeting.attended", actor: "linear:4f1c2e9a-0000-4000-8000-000000000002", response: "accepted", organizer: true },
    ])).toEqual([])
  })

  test("every actor reference names an actor on the same event", () => {
    expect(withFacts([{ ...COMMITMENT, owner: "linear:nobody" }])).toEqual(["event.facts[0].owner is not an actor of the same event"])
    expect(withFacts([{ ...COMMITMENT, counterparty: "linear:nobody" }])).toEqual(["event.facts[0].counterparty is not an actor of the same event"])
    expect(withFacts([{ ...COMMITMENT, counterparty: "linear:4f1c2e9a-0000-4000-8000-000000000002" }])).toEqual([])
    expect(withFacts([{ type: "meeting.attended", actor: "linear:nobody", response: "declined", organizer: false }])).toEqual(["event.facts[0].actor is not an actor of the same event"])
  })

  test("each fact's shape is closed, and no fact has a field for a version or a sensitive trait", () => {
    expect(withFacts([{ ...COMMITMENT, version: "0.3.0" }])).toEqual(['event.facts[0] has the field "version", which the contract does not define'])
    expect(withFacts([{ ...COMMITMENT, health: "fine" }])).toHaveLength(1)
    expect(withFacts([{ type: "commitment", key: "issue-42", title: "Send", owner: "linear:4f1c2e9a-0000-4000-8000-000000000001" }])).toEqual([expect.stringContaining("state")])
    expect(withFacts([{ ...COMMITMENT, state: "paused" }])).toEqual(["event.facts[0].state must be open, done or cancelled"])
    expect(withFacts([{ ...COMMITMENT, due: "30 November" }])).toEqual(["event.facts[0].due must be a date such as 2026-11-30"])
    expect(withFacts([{ ...COMMITMENT, url: "http://linear.app/x" }])).toEqual(["event.facts[0].url must be an https URL"])
    expect(withFacts([{ type: "person.attribute", actor: ACTORS[0]!.id }])).toEqual(["event.facts[0] must name org, team or role: a person's attribute comes from structured profile or directory data"])
    expect(withFacts([{ type: "meeting.attended", actor: ACTORS[0]!.id, response: "maybe", organizer: false }])).toEqual(["event.facts[0].response must be accepted, declined, tentative or needs_action"])
    expect(withFacts([{ type: "meeting.attended", actor: ACTORS[0]!.id, response: "accepted" }])).toEqual([expect.stringContaining("organizer")])
    expect(withFacts([{ type: "x-demo/guess", actor: ACTORS[0]!.id }])).toEqual(["event.facts[0].type must be commitment, person.attribute or meeting.attended"])
    expect(withFacts(Array.from({ length: 21 }, () => COMMITMENT))).toEqual(["event.facts must be a list of at most 20"])
    expect(withFacts(["a fact"])).toEqual(["event.facts[0] is not an object"])
  })

  test("factProblems reads one fact against the event's actors", () => {
    const ids = new Set(ACTORS.map((actor) => actor.id))
    expect(factProblems(COMMITMENT, ids)).toEqual([])
    expect(factProblems({ ...COMMITMENT, owner: "linear:nobody" }, ids)).toEqual(["fact.owner is not an actor of the same event"])
    expect(factProblems(COMMITMENT, ids, "events[0].facts[1]")).toEqual([])
  })
})

describe("the event hash covers a new field only when it is present (#45 §6)", () => {
  test("an event without optional fields hashes only the base fields", () => {
    for (const index of [0, 1]) {
      const built = event(index)
      expect(built.hash).toBe(baseHash(built))
      expect(Object.hasOwn(built, "audience")).toBe(false)
      expect(eventProblems(built)).toEqual([])
    }
  })

  test("a present field changes the hash, and an absent one leaves it as it was", () => {
    const plain = event(1)
    const withAudience = event(1, { audience: "dm" })
    expect(withAudience.hash).not.toBe(plain.hash)
    expect(eventProblems(withAudience)).toEqual([])
    const fields = [plain.source, plain.account, plain.external_id, plain.kind, plain.occurred_at, plain.thread, plain.actors.map((actor) => [actor.role, actor.id, actor.name ?? null]), plain.title, plain.text, plain.url, plain.labels]
    expect(withAudience.hash).toBe(`sha256:${createHash("sha256").update(JSON.stringify([...fields, ["audience", "dm"]])).digest("hex")}`)
  })

  test("an empty identities list is left out, so the actor hashes as if it had none", () => {
    const plain = withActor({ role: "from", id: "slack:U01" })
    const empty = withActor({ role: "from", id: "slack:U01", identities: [] })
    expect(Object.hasOwn(empty.actors[0]!, "identities")).toBe(false)
    expect(empty).toEqual(plain)
    expect(empty.hash).toBe(plain.hash)
  })

  test("the order a plugin builds a new field in does not change its hash", () => {
    const facts = (ordered: boolean): Record<string, unknown> => ordered
      ? { type: "commitment", key: "issue-42", title: "Send the report", owner: "slack:U01", state: "open" }
      : { state: "open", owner: "slack:U01", title: "Send the report", key: "issue-42", type: "commitment" }
    const actors = [{ role: "assignee", id: "slack:U01" }]
    const one = makeEvent({ source: "demo", account: "work", external_id: "item-1", kind: "issue", occurred_at: T0, actors, facts: [facts(true) as never] })
    const other = makeEvent({ source: "demo", account: "work", external_id: "item-1", kind: "issue", occurred_at: T0, actors, facts: [facts(false) as never] })
    expect(other.hash).toBe(one.hash)
    expect(eventProblems(one)).toEqual([])
    expect(eventProblems(other)).toEqual([])
  })

  test("an actor's kind and identities are covered too", () => {
    const plain = withActor({ role: "from", id: "slack:U01" })
    const known = withActor({ role: "from", id: "slack:U01", kind: "bot" })
    const identity = withActor({ role: "from", id: "slack:U01", identities: [{ id: "mailto:sam@example.com", strength: "strong", basis: "slack.profile.email" }] })
    expect(known.hash).not.toBe(plain.hash)
    expect(identity.hash).not.toBe(plain.hash)
    expect(known.hash).toBe(withActor({ kind: "bot", id: "slack:U01", role: "from" }).hash)
    expect(eventProblems(known)).toEqual([])
    expect(eventProblems(identity)).toEqual([])
  })
})
