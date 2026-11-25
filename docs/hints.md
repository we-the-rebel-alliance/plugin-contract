# `hints`

A hint is one file a source plugin may ship beside its sources (contract §7, `hints`). It says how to read one kind of
item, and a model-based consumer may quote it. It is data: the consumer decides how its text is used.

A hint is at most 1,500 characters. Its frontmatter is a small, strict subset of YAML — one `key: value` a line, a
flow list `[a, b]`, and a flow mapping `{ k: v }` — and names:

| Key | Meaning |
|---|---|
| `source` | one of the plugin's own source ids |
| `kinds` | at least one event kind it says how to read, such as `meeting` or `x-<name>/<kind>` |
| `produces` | optional: at least one knowledge type a model may extract (`commitment`, `decision`, `fact`, `preference`, `constraint`, `person`, `project`) |

A hint may not set a decision of the consumer: `apply`, `stated_by`, `space`, `budget` and `priority` are refused. A
hint is checked against the files the plugin declares; a declared file the kit cannot read is a problem.

There are no routines (decision D10). A routine was one consumer's extraction engine, so it left the contract; a plugin
that needs one ships it with that consumer instead. The reader for a hint file is `parseFrontmatter`; there is no `readHint`.

## Exports

| Export | Does |
|---|---|
| `parseFrontmatter` | `parseFrontmatter(text, what?)`: a hint's frontmatter and body, or every problem with them |
| `hintProblems` | `hintProblems(text, { sources })`: every problem with a hint file; none when it keeps the contract |
| `HINT_SCHEMA` | the frontmatter schema, published as `dist/schemas/hint.json` |
| `HINT_MAX`, `HINT_KEYS`, `FORBIDDEN_HINT_KEYS`, `PRODUCES_TYPES` | the limits, keys and knowledge types |
| `HintFrontmatter`, `ProducesType`, `Frontmatter`, `FileOptions` | the types |

## Example

```js
import { hintProblems, parseFrontmatter } from "@we-the-rebel-alliance/plugin-contract/hints"

const hint = `---
source: acme.meetings
kinds: [meeting]
produces: [commitment, decision]
---
Owners are listed under "Action items" as "<name>: <task> (<date>)".`

parseFrontmatter(hint, "hint") // { ok: true, value: { frontmatter: { source: "acme.meetings", kinds: ["meeting"], produces: ["commitment", "decision"] }, body: "Owners are listed …" } }
hintProblems(hint, { sources: ["acme.meetings"] }) // []
```

A hint that names another plugin's source, sets a forbidden key, or is over 1,500 characters fails with one sentence per
problem. The kit runs the same check in `hints`.
