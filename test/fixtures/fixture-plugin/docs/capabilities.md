# Capabilities

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | `fixture.users.get` |
| `events_list` | read | optional | `fixture.messages.list`, `fixture.users.get` |
| `read_message` | read | optional | `fixture.messages.get` |
| `list_channels` | read | optional | `fixture.channels.list` |
| `plan_send` | read | optional | `fixture.messages.create` |
| `send_message` | send | optional | `fixture.messages.create` |
| `write_note` | write | optional | `fixture.notes.create` |
| `delete_note` | delete | optional | `fixture.notes.delete` |
| `share_note` | share | optional | `fixture.notes.share` |
| `pinned_status` | read | none | — |
| `mcp:list_files` | read | none | — |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `fixture.messages` | events | `message` | `events_list` | free |

### Actions

| Action | Effect | Preview | Commit |
|---|---|---|---|
| `fixture.messages.send` | notify | `plan_send` | `send_message` |

### Bus events

`rpc.fixture.changed`, `rpc.fixture.status`, `rpc.fixture.account`
<!-- /generated:capabilities -->
