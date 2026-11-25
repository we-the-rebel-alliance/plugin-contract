import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { planStore } from "../src/register/plans.ts"

describe("the plan store", () => {
  test("a plan records its account, and an unknown or expired plan is refused", () => {
    let now = 1_000
    const plans = planStore({ now: () => now, ttlMs: 50 })
    plans.record("plan-personal", "personal")
    assert.deepEqual(plans.accountOf("plan-personal"), { ok: true, value: "personal" })
    assert.equal(plans.accountOf("plan-work").ok, false)
    now = 1_051
    const expired = plans.accountOf("plan-personal")
    assert.equal(expired.ok, false)
    if (!expired.ok) assert.match(expired.problems[0]!, /expired/)
  })
})
