import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { planStore } from "../src/register/plans.ts"

describe("the plan store", () => {
  test("reserve, release and consume: a refusal leaves the plan committable, a handler start spends it", () => {
    let now = 1_000
    const plans = planStore({ now: () => now, ttlMs: 50 })
    plans.record("plan-personal", "personal", "send_message")
    assert.equal(plans.size, 1)
    const first = plans.reserve("plan-personal", "send_message")
    assert.ok(first.ok)
    const concurrent = plans.reserve("plan-personal", "send_message")
    assert.equal(concurrent.ok, false)
    if (!concurrent.ok) assert.equal(concurrent.code, "PLAN_USED")
    // A different call's handle cannot release the reservation.
    plans.release({ ...first.reservation, token: "another-call" })
    assert.equal(plans.reserve("plan-personal", "send_message").ok, false)
    plans.release(first.reservation)
    const retry = plans.reserve("plan-personal", "send_message")
    assert.ok(retry.ok)
    plans.consume(retry.reservation)
    const replay = plans.reserve("plan-personal", "send_message")
    assert.equal(replay.ok, false)
    if (!replay.ok) assert.equal(replay.code, "PLAN_USED")
    assert.equal(plans.reserve("plan-work", "send_message").ok, false)
    plans.record("plan-other", "work", "send_message")
    assert.equal(plans.reserve("plan-other", "archive_message").ok, false, "another commit method cannot reserve it")
    now = 1_051
    const expired = plans.reserve("plan-other", "send_message")
    assert.equal(expired.ok, false)
    if (!expired.ok) assert.equal(expired.code, "PLAN_INVALID")
    assert.equal(plans.size, 0, "expired plans are pruned")
  })
})
