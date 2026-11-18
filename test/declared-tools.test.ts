import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { assertDeclaredTools, declarationProblems, undeclaredToolProblems } from "../src/conformance.ts"

/** A declaration the coverage check can read. Not a product: tool ids are whatever the plugin passes. */
const declaration = {
  contractVersion: 1,
  items: [
    {
      id: "demo.notes",
      kind: "snapshot",
      tool: "list_notes",
      output: "list",
      permission: { tool: "demo.list_notes", operations: ["notes.list"] },
      cost: { class: "free" },
      scope: { keys: ["folders"], describe: "Which folders", suggest: { tool: "suggest_folders", operations: ["notes.folders"] } },
    },
  ],
  acts: [
    {
      id: "demo.save",
      input: { type: "object" },
      output: { type: "object" },
      effect: "local",
      preview: "preview_note",
      commit: "save_note",
      permission: { preview: "demo.preview_note", commit: "demo.save_note", operations: ["notes.create"] },
    },
  ],
}

describe("undeclared tools", () => {
  test("a declared source tool, a suggest tool and an act tool are covered", () => {
    assert.deepEqual(undeclaredToolProblems(declaration, [{ id: "list_notes" }, { name: "suggest_folders" }, { id: "save_note" }, { id: "preview_note" }]), [])
  })

  test("an undeclared tool fails", () => {
    const problems = undeclaredToolProblems(declaration, [{ id: "list_notes" }, { id: "send_note" }])
    assert.equal(problems.some((problem) => problem.includes("list_notes")), false)
    assert.ok(problems.some((problem) => /"send_note" is neither a source, an act, nor excluded/.test(problem)))
    assert.throws(() => assertDeclaredTools(declaration, [{ id: "send_note" }]), /SCHEMA_VIOLATION: a public tool is not declared/)
  })

  test("an exclusion needs a reason, and a reason covers the tool", () => {
    assert.deepEqual(undeclaredToolProblems(declaration, [{ id: "catalog", exclude: "lists tools; it reads no source and commits no act" }]), [])
    const empty = undeclaredToolProblems(declaration, [{ name: "catalog", exclude: "  " }])
    assert.ok(empty.some((problem) => /excluded with no reason/.test(problem)))
  })

  test("a preview named with a write verb fails, and a commit may be a write", () => {
    const preview = structuredClone(declaration)
    preview.acts[0]!.preview = "send_note"
    const problems = declarationProblems(preview, { tools: [{ id: "list_notes", readOnly: true }, { id: "suggest_folders", readOnly: true }, { id: "send_note", readOnly: false }, { id: "save_note", readOnly: false }] })
    assert.ok(problems.some((problem) => /acts\[0\].*preview.*write verb/.test(problem)), problems.join("\n"))
    const commit = declarationProblems(declaration, {
      tools: [
        { id: "list_notes", readOnly: true },
        { id: "suggest_folders", readOnly: true },
        { id: "preview_note", readOnly: true },
        { id: "save_note", readOnly: false },
      ],
    })
    assert.equal(commit.some((problem) => /save_note/.test(problem) && /write verb/.test(problem)), false, commit.join("\n"))
  })
})
