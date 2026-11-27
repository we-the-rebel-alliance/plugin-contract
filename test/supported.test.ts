/**
 * `SUPPORTED.md` is the programme's claim at this contract version, and each row is the `plugin-kit supported` row for a
 * plugin's manifest at its listed tag. The table's shape and the one row that claims `supported` are pinned here, so a
 * stale cell or a wrong status fails the suite instead of going out as a claim.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const matrix = readFileSync(join(root, "SUPPORTED.md"), "utf8")

/** The plugin rows, as cells, from the three tables above `## Not on the contract`. */
function pluginRows(text: string): string[][] {
  const found: string[][] = []
  for (const line of text.split("## Not on the contract")[0]!.split("\n")) {
    if (!line.startsWith("| ")) continue
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim())
    if (cells[0] === "Plugin") continue
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue
    found.push(cells)
  }
  return found
}

const STATUSES = ["planned", "in progress", "supported", "failing"]

describe("the SUPPORTED.md matrix", () => {
  test("every plugin row has the nine columns and a status the legend defines", () => {
    const rows = pluginRows(matrix)
    assert.ok(rows.length > 0, "the matrix has plugin rows")
    for (const cells of rows) {
      assert.equal(cells.length, 9, `the ${cells[0]} row has ${cells.length} cells`)
      assert.ok(STATUSES.includes(cells[8] ?? ""), `the ${cells[0]} row has an unknown status: ${cells[8]}`)
    }
  })

  test("lists each plugin once, in order", () => {
    const names = pluginRows(matrix).map((cells) => cells[0] ?? "")
    assert.deepEqual([...new Set(names)], names)
  })

  test("inference is supported, with the row plugin-kit supported prints at v0.0.0", () => {
    const rows = pluginRows(matrix).filter((cells) => cells[0] === "inference")
    assert.equal(rows.length, 1, "inference is listed once")
    assert.deepEqual(rows[0], ["inference", "`inference-plugin`", "integration (profile per alias)", "—", "send", "—", "—", "C", "supported"])
  })
})
