# Trellis

A fictional chat service as a complete, minimal plugin on the contract: two accounts held by the **mcp** mechanism,
the vendor's MCP tools passed through as `mcp:*`, an events source with a cursor and a thread detail, a probe, and a fake
provider that answers deterministic requests. Every person, channel and message is invented.

This directory is an installed plugin as an app finds it on disk: `package.json` carries the `capabilities` manifest,
`index.js` is the server entry, `handlers.js` is the one handler table, `provider.js` is the fake Trellis API, and
`fixtures/conformance.json` records what the plugin answers. The fixture sets `accounts.real`, so the kit's
two-account cases run against the real host as well as the recording.

## Install

This is a conformance example, not a published release. From the `plugin-contract` repository, run:

```sh
node bin/plugin-kit.js check --dir examples/mcp
```

or point a local OpenCode install at this directory.

## Sign in

Add one vendor MCP server per alias. The alias `work` is the server `trellis-work`, and `personal` is
`trellis-personal`. Each has its own OAuth; one alias's token never reads the other's messages or reaches the other's
MCP tools.

## Access

`access` is `all`, `ask-changes` or `read-only`. A pass-through MCP method (`mcp:*`) is one rule per alias:
`trellis-work_*` for `work` and `trellis-personal_*` for `personal`. A rule or grant for `work` can never match a tool
registered for `personal`.

`status` reports the plugin and every alias. It takes no account.

## Capabilities

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
| `PLAN_USED` | the plan was already used by an earlier commit |
| `GRANT_INVALID` | the action grant did not verify, or was already spent |
| `HOST_UNTESTED` | OpenCode is outside the plugin's tested range |
| `OPTIONS_INVALID` | the plugin's options do not match their schema |
| `UNAVAILABLE` | the provider could not be reached |
<!-- /generated:errors -->

## Docs

- [Capabilities](docs/capabilities.md)
- [Configuration](docs/configuration.md)
- [Accounts](docs/accounts.md)
- [Automations](docs/automations.md)
