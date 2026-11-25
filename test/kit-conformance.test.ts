import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { loadConformance } from "../src/kit.ts"
import { KitError } from "../src/kit/types.ts"

describe("the conformance loader", () => {
  test("accepts a module with runConformance, t0 and t1, and returns it unchanged", async () => {
    const runner = {
      runConformance: async () => ({ ok: true, findings: [] }),
      t0: async () => [],
      t1: async () => [],
    }
    assert.equal(await loadConformance(async () => runner), runner)
  })

  test("names every missing function, with the version that publishes them", async () => {
    await assert.rejects(
      loadConformance(async () => ({ runConformance: () => Promise.resolve({ ok: true, findings: [] }) })),
      (error: unknown) =>
        error instanceof KitError &&
        error.code === "KIT_CONFORMANCE" &&
        /publishes no t0, t1 in its conformance module/.test(error.message) &&
        /install the plugin-contract version this plugin declares/.test(error.message),
    )
  })

  test("a module that is not an object is reported, not a crash", async () => {
    await assert.rejects(loadConformance(async () => undefined), (error: unknown) => error instanceof KitError && error.code === "KIT_CONFORMANCE")
  })
})
