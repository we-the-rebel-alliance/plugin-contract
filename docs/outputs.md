# Outputs

`outputs` is the snapshot shape registry (contract §7). A snapshot source names one shape in its manifest, and its read
answers `data` valid against it:

```json
{ "kind": "snapshot", "output": "agenda", "tool": "calendar_today" }
```

An app that can render a shape can render every source that outputs it: an `agenda` is an agenda, whichever plugin read
it. Apps render shapes; plugins never render.

## The shapes

`agenda`, `inbox`, `metric`, `list`, `progress`, `note`, `links`, `countdown`, `image`, `thread`, `table`, `record`.

Each is a closed schema: a producer must send a known value, and an unknown key is refused. `image` takes an https
`url` or a `dataUri`, and its `dataUri` is capped so the whole answer fits in the 1 MB a source's `maxBytes` allows.
`IMAGE_DATA_URI_MAX` is that cap.

## The API

| Export | Does |
|---|---|
| `OUTPUTS` | every shape, by name, as a `Validator` |
| `OUTPUT_NAMES` | the names, in registry order |
| `OutputName`, `Output<N>` | the name type, and the `data` type of one shape |
| `isOutputName(name)` | true for a registered name |
| `outputValidator(name)` | the validator, or undefined |
| `checkOutput(name, data, schema?)` | `data` checked against the shape; a name the registry does not hold is a problem, not a throw |
| `isExtensionOutput(name)` | true for `x-<name>/<name>` |
| `EXTENSION_OUTPUT` | that rule |

An `x-` shape has no registry schema: its source carries the JSON Schema inline as `outputSchema`, and `checkOutput`
uses it. The registry only grows within wire version 1: a name is never removed or narrowed, so a source that validates
today still validates under a later minor version.

`npm run build` writes each shape to `dist/schemas/output.<name>.json`.
