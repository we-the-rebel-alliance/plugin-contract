# Fixture

A conformance fixture, not a connector.

## Capabilities

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

## Errors

<!-- generated:errors -->
| Code | Meaning |
|---|---|
| `NEEDS_SIGN_IN` | the account is not signed in |
| `SCOPE_MISSING` | the call needs a scope the person has not confirmed |
| `ACCOUNT_REQUIRED` | the plugin serves several accounts and the call names none |
| `ACCOUNT_UNKNOWN` | the call names an alias the plugin does not serve |
| `ACCOUNT_MISMATCH` | the item belongs to another account |
| `CURSOR_INVALID` | the cursor is malformed, or belongs to another source, account or scope |
| `CURSOR_EXPIRED` | the provider no longer keeps the history the cursor names |
| `RATE_LIMITED` | the provider asked the plugin to slow down |
| `BUDGET_EXCEEDED` | the read would cost more than the person allows |
| `SOURCE_DISABLED` | the person turned this source or action off |
| `TOO_LARGE` | the answer is larger than the source's maxBytes |
| `INPUT_INVALID` | the input does not match the method's schema |
| `SOURCE_UNKNOWN` | the plugin declares no such source |
| `SCHEMA_VIOLATION` | an answer does not keep the contract's shape |
| `PERMISSION_DENIED` | the person's grant does not cover the call |
| `PLAN_INVALID` | the plan is missing, or belongs to another method |
| `GRANT_INVALID` | the action grant did not verify, or was already spent |
| `HOST_UNTESTED` | OpenCode is outside the plugin's tested range |
| `OPTIONS_INVALID` | the plugin's options do not match their schema |
| `UNAVAILABLE` | the provider could not be reached |
<!-- /generated:errors -->
