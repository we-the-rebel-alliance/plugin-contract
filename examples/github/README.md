# GitHub

GitHub notifications, issues and commits as contract events.

This example is an installed plugin as a consumer finds it on disk: `package.json` carries the
`capabilities` manifest, `index.js` is the server entry, and `fixtures/conformance.json` records
what the plugin answers.

## Install

This conformance example is not a published release: run `npm run conformance:self-test` from the contract
repository, or point a local OpenCode install at this directory.

## Sign in

Sign in once per account alias. The alias `default` is the integration `github`;
any other alias is `github-<alias>`.

## Access

`access` is `all`, `ask-changes` or `read-only`. A read always runs; a change asks under
`ask-changes` and is off under `read-only`.

## Capabilities

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

## Docs

- [Capabilities](docs/capabilities.md)
- [Configuration](docs/configuration.md)
- [Accounts](docs/accounts.md)
- [Automations](docs/automations.md)
