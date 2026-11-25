import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { mintPlanId, PLAN_ID_BYTES, planStore } from "../src/register/plans.ts"

/** A plan handler's answer: the committing method and any private data the commit reads from `call.plan`. */
const answer = { method: "send_message", note: "one" }

describe("the plan store", () => {
  test("mints an unguessable id from 16 random bytes and keeps the handler's full answer", () => {
    const id = mintPlanId()
    assert.match(id, /^[A-Za-z0-9_-]+$/, "a minted id is base64url")
    assert.ok(Buffer.from(id, "base64url").length >= PLAN_ID_BYTES, "a minted id carries at least 128 random bits")
    assert.equal(Buffer.from(id, "base64url").toString("base64url"), id, "the id is canonical base64url")

    const plans = planStore()
    const first = plans.record(answer, "personal", "send_message")
    const second = plans.record({ method: "send_message", note: "two" }, "work", "send_message")
    assert.notEqual(first, second, "every plan gets its own id")
    assert.equal(plans.size, 2)
    const reserved = plans.reserve(first, "send_message")
    assert.ok(reserved.ok)
    assert.deepEqual(reserved.reservation.answer, answer, "the reservation carries the handler's answer")
    assert.deepEqual(plans.consume(reserved.reservation), { ok: true, account: "personal", answer })
    const replay = plans.reserve(first, "send_message")
    assert.equal(replay.ok, false)
    if (!replay.ok) assert.equal(replay.code, "PLAN_USED")
  })

  test("reserve, release and consume: a refusal leaves the plan committable, a handler start spends it", () => {
    let now = 1_000
    const plans = planStore({ now: () => now, ttlMs: 50 })
    const id = plans.record(answer, "personal", "send_message")
    const first = plans.reserve(id, "send_message")
    assert.ok(first.ok)
    const concurrent = plans.reserve(id, "send_message")
    assert.equal(concurrent.ok, false)
    if (!concurrent.ok) assert.equal(concurrent.code, "PLAN_USED")
    // A different call's handle cannot release the reservation.
    plans.release({ ...first.reservation, token: "another-call" })
    assert.equal(plans.reserve(id, "send_message").ok, false)
    plans.release(first.reservation)
    const retry = plans.reserve(id, "send_message")
    assert.ok(retry.ok)
    assert.deepEqual(plans.consume(retry.reservation), { ok: true, account: "personal", answer })
    const replay = plans.reserve(id, "send_message")
    assert.equal(replay.ok, false)
    if (!replay.ok) assert.equal(replay.code, "PLAN_USED")
    assert.equal(plans.reserve("no-such-plan", "send_message").ok, false)
    const other = plans.record(answer, "work", "send_message")
    assert.equal(plans.reserve(other, "archive_message").ok, false, "another commit method cannot reserve it")
    now = 1_051
    const expired = plans.reserve(other, "send_message")
    assert.equal(expired.ok, false)
    if (!expired.ok) assert.equal(expired.code, "PLAN_INVALID")
    assert.equal(plans.size, 0, "expired plans are pruned")
  })

  test("consume refuses an expired plan, and a plan id from before a reload is unknown", () => {
    let now = 1_000
    const plans = planStore({ now: () => now, ttlMs: 50 })
    const id = plans.record(answer, "personal", "send_message")
    const expiring = plans.reserve(id, "send_message")
    assert.ok(expiring.ok)
    now = 1_051
    const expired = plans.consume(expiring.reservation)
    assert.equal(expired.ok, false)
    if (!expired.ok) {
      assert.equal(expired.code, "PLAN_INVALID")
      assert.match(expired.problems[0]!, /expired/)
    }

    const before = planStore()
    const old = before.record(answer, "work", "send_message")
    // A new plugin instance has a new store: the old id names nothing there.
    const after = planStore()
    const reloaded = after.reserve(old, "send_message")
    assert.equal(reloaded.ok, false)
    if (!reloaded.ok) assert.equal(reloaded.code, "PLAN_INVALID")
  })

  test("a record collision mints again and never replaces a live plan", () => {
    const ids = ["same", "same", "other"]
    let at = 0
    const plans = planStore({ mint: () => ids[at++]! })
    const first = plans.record({ method: "send_message", note: "first" }, "work", "send_message")
    const second = plans.record({ method: "send_message", note: "second" }, "personal", "send_message")
    assert.equal(first, "same")
    assert.equal(second, "other", "a minted id that is already live is never reused")
    const live = plans.reserve(first, "send_message")
    assert.ok(live.ok)
    assert.deepEqual(live.reservation.answer, { method: "send_message", note: "first" }, "the live plan still holds its own answer")
    assert.deepEqual(plans.consume(live.reservation), { ok: true, account: "work", answer: { method: "send_message", note: "first" } })
  })
})
