# Capabilities

Every method, source, action and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `word_count` | read | none | — |
| `read_note` | read | none | — |
| `plan_write_note` | read | none | `glyph.notes.write` |
| `write_note` | write | none | `glyph.notes.write` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|

### Actions

None.

### Bus events

`rpc.glyph.changed`
<!-- /generated:capabilities -->

## Notes

`word_count` and `read_note` are pure reads. `plan_write_note` dry-runs a write and answers `{ planId, method }`;
`write_note` takes only that `planId`, replaces the note and emits `changed`. A plugin with no sources declares an empty
`sources` list; an app has nothing to schedule, and the methods still work as tools, in Code Mode and over RPC.
