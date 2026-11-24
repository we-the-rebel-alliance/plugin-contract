# Capabilities

Every method, source, action and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | `gmail.users.getProfile` |
| `events_list` | read | optional | `gmail.users.getProfile`, `gmail.users.history.list`, `gmail.users.messages.list`, `gmail.users.messages.get` |
| `read_message` | read | optional | `gmail.users.messages.get` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `gws.gmail` | events | `message` | `events_list` | free |

### Actions

None.

### Bus events

`rpc.gws.changed`
<!-- /generated:capabilities -->

## Notes

The example's provider calls are invented; the manifest is the part the contract checks.
