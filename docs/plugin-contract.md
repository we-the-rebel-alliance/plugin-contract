# `plugin-contract` (the root entry)

The `"."` export holds the manifest's wire version and the plain types every validator shares. It re-exports nothing
heavy: each module stays its own entry point, so a plugin bundles only what it imports (contract §15).

```js
import { CONTRACT_VERSION, SUPPORTED_CONTRACT_VERSIONS } from "@we-the-rebel-alliance/plugin-contract"

if (!SUPPORTED_CONTRACT_VERSIONS.includes(manifest.version)) {
  // Read no further: a manifest for another wire version is not one this package reads.
}
```

`CONTRACT_VERSION` is the version this package writes, and `SUPPORTED_CONTRACT_VERSIONS` the versions it reads. A
manifest's `capabilities.version` names the wire version its author targeted (contract §4).

## Checked and `Validator`

A module writes its schema in zod and exports a `Validator<T>`: a named schema that never throws on a bad value and
generates the JSON Schema the package publishes.

```ts
interface Validator<T> {
  readonly name: string                       // the name dist/schemas/<name>.json carries
  check(value: unknown): Checked<T>            // the value, or every problem
  parse(value: unknown): T                    // the value, or one error listing every problem
  jsonSchema(): Record<string, unknown>       // JSON Schema 2020-12, from the zod source
}
```

`Checked<T>` is `{ ok: true, value }` or `{ ok: false, problems }`, with one sentence per problem that names paths and
never values. It is the same answer `check` and the fence helpers return, so a caller checks one shape everywhere.

## Exports

| Export | Does |
|---|---|
| `CONTRACT_VERSION` | the manifest wire version this package writes, `1` |
| `SUPPORTED_CONTRACT_VERSIONS` | the manifest wire versions this package reads, `[1]` |
| `Checked`, `Validator` | a value checked or every problem, and a named schema that checks and parses |
