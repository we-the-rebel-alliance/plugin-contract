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

const MCP_HEADING = "## Built on the company's MCP server"
const NOT_ON_CONTRACT = "## Not on the contract"

/** The rows of the table under `heading`, as cells, up to the next `stop` heading. */
function tableRows(text: string, heading: string, stop: string): string[][] {
  const section = text.split(heading)[1]
  assert.ok(section !== undefined, `the ${heading} section exists`)
  const found: string[][] = []
  for (const line of section.split(stop)[0]!.split("\n")) {
    if (!line.startsWith("| ")) continue
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim())
    if (cells[0] === "Plugin") continue
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue
    found.push(cells)
  }
  return found
}

/** The plugin rows, as cells, from the three tables above the MCP section. */
function pluginRows(text: string): string[][] {
  return tableRows(text.split(MCP_HEADING)[0]!, "## Data sources", NOT_ON_CONTRACT)
}

const MCP_PLUGINS = [
  "affinity", "ashby", "bigquery", "boxd", "browse", "charts", "colab", "databricks", "docusign",
  "elevenlabs", "github", "granola", "gws", "inference", "jira", "linear", "metaview", "notion",
  "openrouter", "plaud", "slack", "specter", "tavily", "utilities", "voice", "wisprflow", "x",
]
const BUILT_ON = [
  "affinity", "ashby", "docusign", "elevenlabs", "github", "granola", "jira", "linear", "metaview",
  "notion", "openrouter", "plaud", "slack", "specter", "tavily", "wisprflow", "x",
]
const NO_SERVER = ["boxd", "browse", "charts", "inference", "utilities", "voice"]
const NOT_YET = ["bigquery", "colab", "databricks", "gws"]

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

  test("lists all 27 plugins, including docusign", () => {
    const names = pluginRows(matrix).map((cells) => cells[0] ?? "")
    assert.equal(names.length, 27)
    assert.deepEqual([...names].sort(), MCP_PLUGINS)
    assert.equal(names.filter((name) => name === "docusign").length, 1)
  })

  test("inference is supported, with the row plugin-kit supported prints at v0.0.0", () => {
    const rows = pluginRows(matrix).filter((cells) => cells[0] === "inference")
    assert.equal(rows.length, 1, "inference is listed once")
    assert.deepEqual(rows[0], ["inference", "`inference-plugin`", "integration (profile per alias)", "—", "send", "—", "—", "C", "supported"])
  })
})

describe("the MCP server marks", () => {
  const rows = tableRows(matrix, MCP_HEADING, NOT_ON_CONTRACT)
  const byPlugin = new Map(rows.map((cells) => [cells[0] ?? "", cells]))

  test("one row per plugin, with four cells", () => {
    assert.deepEqual(rows.map((cells) => cells[0]).sort(), MCP_PLUGINS)
    for (const cells of rows) assert.equal(cells.length, 4, `the ${cells[0]} mark has ${cells.length} cells`)
  })

  test("every built-on-it plugin has the mcp account mechanism and a server", () => {
    const accounts = new Map(pluginRows(matrix).map((cells) => [cells[0] ?? "", cells[2] ?? ""]))
    for (const name of BUILT_ON) {
      const cells = byPlugin.get(name)
      assert.ok(cells, `${name} has a mark`)
      assert.ok((cells[1] ?? "").length > 0 && cells[1] !== "—", `${name} names its company`)
      assert.ok((cells[2] ?? "").startsWith("https://"), `${name} names its server URL`)
      assert.match(cells[3] ?? "", /^\*\*built on it\*\*/)
      assert.match(accounts.get(name) ?? "", /^mcp\b/, `${name}'s matrix row says mcp`)
    }
  })

  test("every no-server plugin names its evidence", () => {
    for (const name of NO_SERVER) {
      const cells = byPlugin.get(name)
      assert.ok(cells, `${name} has a mark`)
      assert.match(cells[2] ?? "", /^none\b/, `${name} has no company server`)
      const mark = cells[3] ?? ""
      assert.match(mark, /^\*\*no server to build on\*\*: /)
      assert.match(mark, /our own code|\]\(https:\/\//, `${name} has evidence`)
    }
  })

  test("every not-yet plugin links the task that will settle it", () => {
    for (const name of NOT_YET) {
      const cells = byPlugin.get(name)
      assert.ok(cells, `${name} has a mark`)
      assert.match(cells[3] ?? "", /^\*\*not yet\*\*: .*\/issues\/103\)/)
    }
  })

  test("the three marks are exactly the three sets, with no plugin left out", () => {
    const marked = ["built on it", "no server to build on", "not yet"]
    const counts = marked.map((mark) => rows.filter((cells) => (cells[3] ?? "").startsWith(`**${mark}**`)).length)
    assert.deepEqual(counts, [BUILT_ON.length, NO_SERVER.length, NOT_YET.length])
  })
})
