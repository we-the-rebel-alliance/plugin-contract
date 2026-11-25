import assert from "node:assert/strict"
import { describe, test } from "node:test"
import * as kit from "../src/kit.ts"
import * as host from "../src/internal/host/index.ts"

describe("the kit's host harness export", () => {
  test("is the internal harness, function for function, with no second implementation", () => {
    for (const name of ["createHost", "waitForActivation", "createAutomation", "automationApi", "connectMcpServer", "createCodeMode", "TurnLog"] as const) {
      assert.equal(kit[name], host[name], `${name} is the internal harness function`)
    }
    assert.equal("legacySchedule" in kit, false)
  })
})
