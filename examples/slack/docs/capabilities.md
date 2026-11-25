# Capabilities

Every method, source, action and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | `slack_read_user_profile` |
| `events_list` | read | optional | `slack_read_user_profile`, `slack_read_channel`, `slack_read_thread` |
| `read_thread` | read | optional | `slack_read_thread` |
| `list_user_channels` | read | optional | `slack_list_user_channels` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `slack.workspace` | events | `message` | `events_list` | free |

### Actions

None.

### Bus events

`rpc.slack.changed`
<!-- /generated:capabilities -->

## Notes

The example's provider calls are invented; the manifest is the part the contract checks.
