# Capabilities

Every method, source, action and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | `github.users.get` |
| `events_list` | read | optional | `github.users.get`, `github.notifications.list`, `github.search.issues`, `github.search.commits` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `github.activity` | events | `message` | `events_list` | metered |

### Actions

None.

### Bus events

`rpc.github.changed`
<!-- /generated:capabilities -->

## Notes

The example's provider calls are invented; the manifest is the part the contract checks.
