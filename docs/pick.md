# `pick`

Field selection for a read (contract §7). A read may carry `pick`, and only those paths are returned. A key the
answer does not have is left out, not an error, because providers leave optional keys out.

A path is dotted segments. A segment ending in `[]` maps over an array: `items[].title`,
`items[].attendees[].email`. A path is at most 200 characters, and one pick names at most 50 paths.

## Exports

| Export | Does |
|---|---|
| `pick` | `pick(data, paths)`: only the picked paths of `data`, in its own nesting |
| `pickProblems` | `pickProblems(paths, schema?)`: every problem with a pick: grammar, limits, repeats, and paths the schema cannot have |
| `pickProblemsForOutput` | the same against a registered output, or an `x-` output's inline schema |
| `missingPaths` | the paths that reach nothing, for a diagnostic; never a failure |
| `MAX_PICK_PATHS`, `MAX_PICK_PATH_LENGTH`, `PICK_PATH` | the limits and the grammar |
| `JsonSchema` | a JSON Schema object or boolean, as the checks take it |

`pickProblems` runs when the binding is made, so a typo fails at consent rather than reading nothing.

## Example

```js
import { pick, pickProblemsForOutput, missingPaths } from "@we-the-rebel-alliance/plugin-contract/pick"

const paths = ["items[].title", "items[].start", "rangeEnd"]
pickProblemsForOutput("agenda", paths) // []

const data = { items: [{ id: "1", title: "Stand-up", start: "2026-11-24T09:00:00Z" }], rangeEnd: "2026-11-24T10:00:00Z" }
pick(data, paths)
// { ok: true, data: { items: [{ title: "Stand-up", start: "2026-11-24T09:00:00Z" }], rangeEnd: "2026-11-24T10:00:00Z" } }

missingPaths(data, ["items[].location"]) // ["items[].location"]
```

Over an array, an item the path cannot enter keeps its place as `{}`, so the paths over one array still line up.
