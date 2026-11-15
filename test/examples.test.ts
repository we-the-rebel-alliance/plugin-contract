import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadExamples, runExamples } from "../scripts/examples.ts"
import * as conformance from "../src/conformance.ts"
import { readInstalledDescriptor } from "../src/descriptor.ts"
import type { SourceItem as SchemaSourceItem } from "../src/schema.ts"
import * as events from "../src/events.ts"
import { acceptAnswer } from "../src/read.ts"
import * as schema from "../src/schema.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

/** The parts of an example's `fixtures/conformance.json` that hold what the plugin answered. */
interface RecordedAnswer {
  readonly input?: { readonly account?: string; readonly limit?: number }
  readonly expect?: unknown
  readonly answer?: unknown
}
interface Recorded {
  readonly account: string
  readonly sources: Readonly<Record<string, { readonly cases?: readonly RecordedAnswer[]; readonly snapshot?: RecordedAnswer }>>
}

describe("the examples", () => {
  test("each one declares its sources and records its own answers", () => {
    const examples = loadExamples(root)
    assert.deepEqual(
      examples.map((example) => example.name),
      ["github", "gws-calendar", "gws-gmail", "slack"],
    )
    for (const example of examples) assert.ok(example.fixture !== undefined, `${example.name} records no fixture`)
  })

  test("the schema and the kit accept every example, and every declared source is exercised", async () => {
    const results = await runExamples({ root, schema, conformance, events })
    assert.equal(results.length, 4)
    for (const result of results) assert.deepEqual(result.problems, [], result.name)
    const sources = results.flatMap((result) => result.reports.map((report) => report.source))
    assert.deepEqual(sources.sort(), ["github.activity", "gws.calendar", "gws.calendar.today", "gws.gmail", "slack.workspace"])
  })

  test("read accepts every page and snapshot an example records, as a consumer would receive it", () => {
    // The kit records a snapshot's grants but not its shape, so this is where an example's answers meet `read`.
    let checked = 0
    for (const example of loadExamples(root)) {
      const installed = readInstalledDescriptor(join(root, "examples", example.name))
      assert.ok(installed.ok, example.name)
      const recorded = JSON.parse(readFileSync(join(root, "examples", example.name, "fixtures", "conformance.json"), "utf8")) as Recorded
      for (const [id, entry] of Object.entries(recorded.sources)) {
        const source = installed.value.sources.items.find((item) => item.id === id)
        assert.ok(source, `${example.name}: ${id}`)
        const answers = [...(entry.cases ?? []).filter((entry) => entry.expect === "page"), ...(entry.snapshot ? [entry.snapshot] : [])]
        for (const answer of answers) {
          const outcome = acceptAnswer(source, answer.input?.account ?? recorded.account, answer.answer, answer.input?.limit === undefined ? {} : { limit: answer.input.limit })
          assert.ok(outcome.ok, `${example.name}: ${id}: ${outcome.ok ? "" : outcome.failure.message}`)
          checked++
        }
      }
    }
    assert.ok(checked > 0)
  })

  test("every check Memory adds runs on at least one example", async () => {
    const results = await runExamples({ root, schema, conformance, events })
    const ran = new Set(results.flatMap((result) => result.reports.flatMap((report) => report.checks.filter((check) => check.ran).map((check) => check.name))))
    for (const name of ["declaration", "page-result", "failed-holds-cursor", "gap-and-cursor-expired", "refused-is-final", "probe", "details", "suggest", "unused-grants"]) {
      assert.ok(ran.has(name), `${name} did not run on any example`)
    }
  })
})

describe("one SourceItem (#30, item 8)", () => {
  test("an item read from disk goes to acceptAnswer and sourceConformance as it is, with no re-parse", async () => {
    const installed = readInstalledDescriptor(join(dirname(fileURLToPath(import.meta.url)), "..", "examples", "gws-gmail"))
    assert.ok(installed.ok)
    // The same value, the same type: descriptor's SourceItem is the schema's (no SOURCES_SCHEMA.check, no cast).
    const item: SchemaSourceItem = installed.value.sources.items[0]!
    const refused = acceptAnswer(item, "sam.rivera@example.com", { trust: "untrusted" })
    assert.equal(refused.ok, false)
    const report = await conformance.sourceConformance({ plugin: installed.value.package, source: item, tools: [{ id: item.tool, readOnly: true }], calls: { probe: async () => ({}) } })
    assert.equal(report.source, item.id)
  })
})
