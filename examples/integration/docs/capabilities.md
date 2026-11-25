# Capabilities

Every method, source, action and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | `harbour.users.get` |
| `events_list` | read | optional | `harbour.users.get`, `harbour.notes.list`, `harbour.notes.get` |
| `read_note` | read | optional | `harbour.notes.get` |
| `list_spaces` | read | optional | `harbour.spaces.list` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `harbour.notes` | events | `doc` | `events_list` | free |

### Actions

None.

### Bus events

None.
<!-- /generated:capabilities -->

## Notes

`events_list` answers one page of notes for the account and scope it is given. Its cursor is bound to the plugin,
source, account and scope through the contract's cursor module, so another account's cursor is `CURSOR_INVALID`.
`read_note` takes only the `external_id` an event listed. `probe` reads the signed-in owner and no note.
