import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { runConformance, t1 } from "../src/conformance.ts"
import { hostRuntimeProblem } from "../src/internal/conformance/host.ts"

const here = dirname(fileURLToPath(import.meta.url))
const fixtureDirectory = join(here, "fixtures", "fixture-plugin")

describe("the T1 runtime gate", () => {
  test("a Node 22 runtime is a failing T1.host-unavailable finding, not a warning", async () => {
    assert.equal(hostRuntimeProblem("24.0.0", null), undefined)
    assert.equal(hostRuntimeProblem("22.0.0", "1.4.5"), undefined)
    const finding = hostRuntimeProblem("22.0.0", null)
    assert.equal(finding?.id, "T1.host-unavailable")
    assert.equal(finding?.level, "error")
    assert.equal(finding?.message, "T1 needs Node 24 or Bun")

    const original = process.versions.node
    const originalBun = (process.versions as { readonly bun?: string | undefined }).bun
    Object.defineProperty(process.versions, "node", { value: "22.0.0", configurable: true })
    Object.defineProperty(process.versions, "bun", { value: undefined, configurable: true })
    try {
      const viaT1 = await t1(fixtureDirectory, "2.4.1")
      assert.equal(viaT1.some((entry) => entry.id === "T1.host-unavailable" && entry.level === "error" && entry.message === "T1 needs Node 24 or Bun"), true)
      const report = await runConformance(fixtureDirectory, { hosts: ["2.4.1"] })
      assert.equal(report.ok, false)
      assert.equal(report.findings.some((entry) => entry.id === "T1.host-unavailable" && entry.level === "error"), true)
    } finally {
      Object.defineProperty(process.versions, "node", { value: original, configurable: true })
      Object.defineProperty(process.versions, "bun", { value: originalBun, configurable: true })
    }
  })
})
