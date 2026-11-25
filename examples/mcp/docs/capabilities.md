# Capabilities

Every method, source, action and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | `trellis.users.get` |
| `events_list` | read | optional | `trellis.users.get`, `messages_search`, `messages_read` |
| `read_thread` | read | optional | `trellis.users.get`, `messages_read` |
| `list_channels` | read | optional | `trellis.channels.list` |
| `mcp:*` | read | none | `messages_search`, `messages_read` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `trellis.messages` | events | `message` | `events_list` | free |

### Actions

None.

### Bus events

None.
<!-- /generated:capabilities -->

## Notes

`events_list` answers one page for the account and channel scope it is given. Its cursor is bound to the plugin,
source, account and scope through the contract's cursor module, so another account's cursor is `CURSOR_INVALID`.
`read_thread` takes only the `thread` an event listed. `probe` reads the signed-in owner and no message.

`mcp:*` is the vendor's tools, classified as a read for the contract but never registered by this plugin: the vendor's
MCP server owns them, and OpenCode names them `trellis_<tool>` for the `default` account and `trellis-<alias>_<tool>`
for any other.

`events_list` and `read_thread` declare the vendor's `messages_search` and `messages_read` as bare operations. The
grant compiler derives them per alias, as `trellis-work_…` or `trellis-personal_…`, so one alias's grant never names
the other's tool.
