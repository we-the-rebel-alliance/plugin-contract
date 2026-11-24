# Conformance

A plugin proves it keeps the contract by running the conformance kit in its CI and attaching the report to each
release. An app lists a source plugin only with a passing report for the pinned version.

The kit is the `conformance` module. It ships with every release as one file,
`plugin-contract-conformance-<version>.mjs`, which needs nothing installed.

## Running it

```js
import { assertDeclaration, assertConformance, sourceConformance } from "@we-the-rebel-alliance/plugin-contract/conformance"

assertDeclaration(pkg.sources, { tools })
const report = await sourceConformance({ plugin: pkg.name, source, tools, calls, cases })
assertConformance(report)
```

`assertDeclaration` checks the `sources` block: the schema first, then the rules a JSON Schema cannot express — names,
verbs, `urlHosts`, the namespace of an action, and uniqueness. `sourceConformance` runs one source through the checks
below against the plugin's own recorded answers. `assertConformance` throws one error naming every problem.

Every check that applies must run. A source that never exercises `failed[]`, `gap`, `refused[]` or a detail read has an
*incomplete* report, which is not ok. A check that does not apply, such as `actor-kind` without a `machineActors`
fixture, is reported as not applicable.

## What it checks

| Check | Proves |
|---|---|
| `declaration` | the source validates; every tool it names is a read; names, operations and hosts follow the contract |
| `hints` | every declared hint file is present, within 1,500 characters, well formed, and names one of the plugin's own sources |
| `page-result` | every recorded page is `resultProblems`-valid: fields, kinds, actors, facts, hash, order, size and scope |
| `event-within-max-bytes` | no single event is larger than the source's `maxBytes`, since a page always carries one |
| `failed-holds-cursor` | `failed[]` is exercised, and a failed entry holds the cursor back |
| `gap-and-cursor-expired` | `gap` or `CURSOR_EXPIRED` round-trips to a fresh cursor, and the page after it reads on |
| `gap-once-per-read` | a read answers its gap once; the page its cursor names carries none |
| `refused-is-final` | a refused event is not delivered, and no secret pattern survives in a title or text |
| `removals-are-final` | `removals[]` entries are closed, unique, not also `failed[]`, and not later than `asOf` |
| `actor-kind` | every actor the fixture names as a machine carries `kind` on every page that lists it |
| `one-author` | an event lists at most one `from` (or `author`) actor |
| `facts` | every fact type on a page is declared by the source |
| `commitment-key` | a commitment key names one title and owner, and one item keeps one key |
| `parts-stable` | a part listed again keeps its text and actor |
| `billed-cost` | a billed source reports its cost in the units it declares |
| `probe` | the probe reads no content, asserts only its own grant, and answers `{ source, account, owner: { id, label }, trust }` |
| `details` | a detail read takes only the event fields it declares, and an out-of-scope call is refused with `PERMISSION_DENIED` |
| `suggest` | the bind-time read asserts exactly its own operations |
| `identity-grants` | a content read never asserts an identity operation, unless the source declares `readsIdentity` |
| `output-schema` | an `x-` snapshot's `data` satisfies its inline `outputSchema` |
| `rpc-id` | a declared tools-RPC id has the contract's shape, and agrees with `describe` when one is available |
| `unused-grants` | every grant the declaration names is asserted by a read, and nothing outside it is |

An assertion the declaration does not hold is refused where a host would refuse it, and a declared grant no call
asserts fails as over-granting: declared equals asserted. The kit reports `undeclared-grants` when a read asserts an
action the declaration does not derive.

## A recorded fixture

`examples/*/fixtures/conformance.json` shows the fixture format, and `scripts/examples.ts` replays one. A fixture holds,
per source, the `events_list` cases and their answers (or their refusals), the `probe` answer, and optionally the detail,
suggest and snapshot answers, each with the assertions the call made.

```json
{
  "plugin": "@we-the-rebel-alliance/acme-plugin",
  "account": "default",
  "tools": [{ "id": "events_list", "readOnly": true }],
  "sources": {
    "acme.feed": {
      "cases": [{ "input": { "since": "2026-11-01T00:00:00Z" }, "asserts": [{ "action": "acme.events_list", "resource": "default:feed.list" }], "answer": { } }],
      "probe": { "asserts": [{ "action": "acme.probe", "resource": "default:users.me" }], "answer": { } }
    }
  }
}
```

## Options that say a check does not apply

Some sources cannot produce one kind of failure. Each says so, with a non-empty reason that appears in the report:

```js
await sourceConformance({ ...options, atomicPages: { reason: "events.list answers the page in one call" } })
await sourceConformance({ ...options, noExpiry: { reason: "the provider's ids never expire" } })
await sourceConformance({ ...options, machineActors: ["acme:B0PILOT01"] })
await sourceConformance({ ...options, files: (path) => readFileSync(join(here, path), "utf8"), ownSources: ["acme.feed"] })
```

`atomicPages` turns off `failed-holds-cursor`, `noExpiry` turns off `gap-and-cursor-expired`, and `machineActors` turns
on `actor-kind`. `files` gives the kit the plugin's own package, so a declared hint is read rather than trusted; a file
it cannot read fails the check.

## Every public tool is declared

A plugin's CI fails when a public tool is neither a source, an act, nor explicitly excluded with a reason. The plugin
passes the table: the tools an agent can call, not the provider operations those tools call.

```js
assertDeclaration(pkg.sources, { tools })
assertDeclaredTools(pkg.sources, tools)
```

Each entry is `{ id, readOnly?, exclude? }`. A tool is covered when its id equals a source's `tool`, a detail's `tool`, a
suggest `tool`, or an act's `preview` or `commit`. `exclude` is the reason the tool is outside the contract, such as a
status tool that reads no source and commits no act; the reason must be non-empty. A tool left out of the table is not an
exclusion.

## In this repository

`npm run conformance:self-test` runs on every pull request. It reads each plugin under `examples/` twice: once as an app
finds it on disk (`readInstalledDescriptor`, which hashes it) and once through the kit. Every recorded page is checked by
the `events` module first, so the examples keep the page shape the contract defines.
