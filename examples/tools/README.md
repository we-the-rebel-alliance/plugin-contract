# Glyph

A tools-only plugin on the contract: no accounts, no sources, methods only. It counts words, keeps short notes, and
plans a write before committing it. It is the smallest complete shape: a manifest, one handler table, one `register`
call, a status and a bus event.

This directory is an installed plugin as an app finds it on disk: `package.json` carries the `capabilities` manifest,
`index.js` is the server entry, `handlers.js` is the one handler table, and `fixtures/conformance.json` records what
the plugin answers.

## Install

This is a conformance example, not a published release. From the `plugin-contract` repository, run:

```sh
node bin/plugin-kit.js check --dir examples/tools
```

or point a local OpenCode install at this directory.

## Sign in

Nothing to sign in to: Glyph has no accounts and no provider. Its notes live in the plugin instance and are gone when
the plugin unloads.

## Access

`access` is `all`, `ask-changes` or `read-only`. Reads always run. `write_note` is a write: it runs under `all`, asks
under `ask-changes`, and is off under `read-only`. A write is planned with `plan_write_note` first and committed with the
`planId` it answers; the commit emits `changed`.

## Capabilities

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
