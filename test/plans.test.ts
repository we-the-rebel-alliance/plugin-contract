import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { planStore } from "../src/register/plans.ts"

describe("the plan store", () => {
  test("a plan records its account and method, commits once, and an unknown or expired plan is refused", () => {
    let now = 1_000
    const plans = planStore({ now: () => now, ttlMs: 50 })
    plans.record("plan-personal", "personal", "send_message")
    assert.equal(plans.size, 1)
    assert.deepEqual(plans.take("plan-personal", "send_message"), { ok: true, value: "personal" })
    assert.deepEqual(plans.take("plan-personal", "send_message"), { ok: false, code: "PLAN_USED", problems: ["the plan 'plan-personal' was already used; plan again to make a new one"] })
    assert.equal(plans.size, 1)
    assert.equal(plans.take("plan-work", "send_message").ok, false)
    plans.record("plan-other", "work", "send_message")
    assert.equal(plans.take("plan-other", "archive_message").ok, false, "another commit method cannot use it")
    now = 1_051
    const expired = plans.take("plan-other", "send_message")
    assert.equal(expired.ok, false)
    if (!expired.ok) assert.equal(expired.code, "PLAN_INVALID")
    assert.equal(plans.size, 0, "expired plans are pruned")
  })
})
