import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { runConformance, t0, t1 } from "../src/conformance.ts"
import { readInstalledManifest } from "../src/manifest.ts"
import { acceptAnswer } from "../src/read.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const nodeMajor = Number(process.versions.node.split(".")[0])
const skipHost = nodeMajor < 24 ? "the embedded host needs Node 24" : false
const examples = readdirSync(join(root, "examples"))
  .filter((name) => existsSync(join(root, "examples", name, "package.json")))
  .sort()

/** The pages a fixture records, for the events authority. */
function recordedPages(name: string): { what: string; answer: unknown }[] {
  const file = join(root, "examples", name, "fixtures", "conformance.json")
  if (!existsSync(file)) return []
  const fixture = JSON.parse(readFileSync(file, "utf8")) as { sources?: Record<string, { cases?: { name?: string; answer?: unknown }[]; details?: { id: string; answer?: unknown }[] }> }
  const pages: { what: string; answer: unknown }[] = []
  for (const [id, source] of Object.entries(fixture.sources ?? {})) {
    for (const entry of source.cases ?? []) if (entry.answer !== undefined) pages.push({ what: `${id} ${entry.name ?? "a case"}`, answer: entry.answer })
    for (const detail of source.details ?? []) if (detail.answer !== undefined) pages.push({ what: `${id} ${detail.id}`, answer: detail.answer })
  }
  return pages
}

describe("the examples", () => {
  test("each one is an installed package with a manifest, a server entry and a fixture", () => {
    assert.deepEqual(examples, ["github", "gws-calendar", "gws-gmail", "slack"])
    for (const name of examples) {
      const installed = readInstalledManifest(join(root, "examples", name))
      assert.ok(installed.ok, `${name}: ${installed.ok ? "" : installed.problems.join("; ")}`)
      assert.ok(existsSync(join(root, "examples", name, "index.js")), `${name} has no server entry`)
      assert.ok(existsSync(join(root, "examples", name, "fixtures", "conformance.json")), `${name} records no fixture`)
    }
  })

  test("the manifest and the kit accept every example", { timeout: 60_000 }, async () => {
    for (const name of examples) {
      const report = await runConformance(join(root, "examples", name))
      assert.deepEqual(report.findings, [], `${name}: ${report.findings.map((finding) => `${finding.id}: ${finding.message}`).join("\n")}`)
      assert.equal(report.ok, true, name)
    }
  })

  test("T0 is clean, and T1 loads each plugin on 2.4.1 and refuses 2.5.0 cleanly", { skip: skipHost, timeout: 60_000 }, async () => {
    for (const name of examples) {
      const directory = join(root, "examples", name)
      assert.deepEqual(await t0(directory), [], name)
      assert.deepEqual(await t1(directory, "2.4.1"), [], name)
      assert.deepEqual(await t1(directory, "2.5.0"), [], name)
    }
  })

  test("every recorded page is accepted by read's own answer check, as a consumer receives it", () => {
    let accepted = 0
    for (const name of examples) {
      const installed = readInstalledManifest(join(root, "examples", name))
      assert.ok(installed.ok, name)
      for (const page of recordedPages(name)) {
        const bySource = installed.value.manifest.sources.filter((source) => source.kind === "events")
        const events = bySource.find((source) => (source.input as { source?: string } | undefined)?.source === (page.answer as { source?: string })?.source) ?? bySource[0]
        assert.ok(events, `${name}: ${page.what} names no events source`)
        const account = (page.answer as { account?: string })?.account ?? "work"
        const outcome = acceptAnswer(events, account, page.answer)
        assert.ok(outcome.ok, `${name}: ${page.what}: ${outcome.ok ? "" : outcome.failure.message}`)
        accepted++
      }
    }
    assert.ok(accepted > 0)
  })
})
