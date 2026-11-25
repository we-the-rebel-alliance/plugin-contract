# Accounts

Every plugin that signs in supports several named accounts at once, such as `work` and `personal` (contract §5).
OpenCode owns sign-in and credentials; this module declares the accounts, names them, registers them, resolves the
account of a call and reports status per alias. Nothing here needs a real host: a context with two `transform`
functions is enough.

```ts
import {
  accountsOf,
  registerAccounts,
  resolveAccount,
  accountStatuses,
} from "@we-the-rebel-alliance/plugin-contract/accounts"
```

## Aliases

- Pattern: `^[a-z][a-z0-9]{0,31}$` — one lowercase letter, then up to 31 lowercase letters or digits. No underscore.
- The account with no alias is `default`.
- A hyphen separates the plugin's name from an alias, so an alias itself has none.
- An alias is the last segment of an integration or MCP server name and the first half of a permission resource
  (`work:conversations.history`).

`isAlias(value)`, `aliasProblem(value, where?)`, and the constants `ALIAS_PATTERN` and `DEFAULT_ALIAS` are exported.

## Profiles

`options.accounts` is a map of alias to profile. The profile's schema is the plugin's own: the JSON Schema under
`options.properties.accounts.additionalProperties`, named by `accounts.profile` in the manifest.

```json
{
  "accounts": {
    "via": "integration",
    "profile": { "$ref": "#/options/properties/accounts/additionalProperties" },
    "owner": "mailto"
  },
  "options": {
    "type": "object",
    "properties": {
      "access": { "type": "string", "enum": ["all", "ask-changes", "read-only"], "default": "all" },
      "accounts": {
        "type": "object",
        "additionalProperties": {
          "type": "object",
          "properties": { "region": { "type": "string" } },
          "additionalProperties": false
        }
      }
    }
  }
}
```

```json
{ "accounts": { "work": { "region": "eu" }, "personal": { "region": "us" } } }
```

`accountsOf(manifest, options)` returns:

```ts
{
  plugin: "example",
  mechanism: "integration",
  accounts: [
    { alias: "work", profile: { region: "eu" } },
    { alias: "personal", profile: { region: "us" } }
  ]
}
```

Rules:

- With no `accounts` option there is exactly one `default` account.
- An empty map is also one `default` account.
- A profile is checked against the plugin's schema; a bad profile names its path:
  `options.accounts.work.region: …`.
- An alias that breaks the rule is refused: `options.accounts.Work: …`.
- A plugin that declares no `accounts` in its manifest signs in to nothing: its account set is empty.

## Mechanisms

`accounts.via` chooses where the credentials live.

### `integration`

The plugin holds the credentials. Add **one OpenCode integration per alias**:

| Alias | Integration id |
|---|---|
| `default` | `<plugin>` |
| `work` | `<plugin>-work` |

Each is signed in with `/connect` or `opencode auth login <name>-<alias>`. The plugin registers its auth methods on
each integration; `registerAccounts` passes the alias and the integration id to the plugin's `auth` factory, which
returns the methods (`oauth`, `key`, `command`, `external` or `env`) it wants.

### `mcp`

The vendor's MCP server holds the credentials. Add **one vendor MCP server per alias**, with the same names,
`<plugin>` and `<plugin>-<alias>`. Each has its own OAuth; OpenCode keys MCP OAuth per server. The plugin's `server`
factory returns the server config for each alias.

### `local`

The identity of the machine or OS user: `os-user:<user>@<host>`. There is exactly one account, `default`. `localIdentity({
user?, host? })` builds it; without arguments it reads the OS user and host name. Registration does nothing.

## Names

One rule for every mechanism:

```ts
accountName("slack", "default")  // "slack"
accountName("slack", "work")     // "slack-work"
accountLabel("Slack", "work")    // "Slack (work)"
```

The same name is the integration id or MCP server name, so a person signs in and a tool is permitted under one name.

## Registration

```ts
import type { Plugin } from "@opencode/plugin"
import { accountsOf, registerAccounts } from "@we-the-rebel-alliance/plugin-contract/accounts"

export async function register(ctx: Plugin.Context, manifest: Manifest, options: unknown) {
  const result = await registerAccounts(ctx, {
    manifest,
    options: options as Record<string, unknown>,
    // Integration: the methods this plugin offers on each integration.
    auth: (account, integrationID) => [{ integrationID, method: { type: "key", label: `API key for ${account.alias}` } }],
    // MCP: the server config for each alias.
    server: (account, name) => ({ type: "remote", url: `https://api.example.com/mcp/${name}`, oauth: true }),
  })
  for (const problem of result.problems) ctx.storage /* or the plugin's own log */ // record it for status
}
```

- `registerAccounts(ctx, request)` takes any context with `integration.transform` and `mcp.transform` (the editors
  from `@opencode/plugin` 2.4.1 are wider; the module's structural types are assignable to them).
- It registers one integration or MCP server per alias, and the plugin's auth methods for integrations, with the
  integration id filled in.
- It returns `{ mechanism, accounts: [{ alias, name }], problems }`. A transform that throws is recorded in `problems`
  and never takes the plugin down; a plugin's status shows it.
- `accountsOf` decides the aliases first, so a bad `accounts` option is reported before anything is registered.

## Account resolution

Every method declared `accounts: "optional"` takes an `account`.

```ts
resolveAccount(accounts, { account })  // { ok: true, alias: "work" }
```

- With one account, omitting `account` is fine.
- With more than one and none named: `ACCOUNT_REQUIRED`, and the next step lists the aliases:
  `Pass account, one of: work, personal.`
- An alias the plugin does not have: `ACCOUNT_UNKNOWN`, with the same list.
- A plugin with no accounts resolves `default` when none is named, and refuses a named alias.

`aliasesSentence(accounts)` builds the next step. Both codes are part of the contract's error table; a plugin maps
them to the family's `CODE: What happened. Next step: What to do.` form.

## Status

`status` lists each alias, in the order the options name them:

```ts
accountStatuses(accounts, {
  work: { state: "ready", owner: { id: "mailto:ana@example.com", label: "Ana" } },
  personal: { state: "error", reason: "the provider refused the refresh token" },
})
// [
//   { alias: "work", state: "ready", owner: { … } },
//   { alias: "personal", state: "error", reason: "the provider refused the refresh token" }
// ]
```

- `state`: `ready`, `needs_sign_in` or `error`.
- `owner` is present once a probe has answered (`owner.orgs` included).
- A reason is one line of at most 160 characters and is **redacted** by `redactReason`: URL query values,
  `Bearer`/`Basic` credentials, JWTs and token-shaped words are replaced, and control characters become spaces.
- A signal for an alias the plugin does not have is ignored: status never invents an account.
- `NO_ACCOUNTS` is the empty list for a plugin that signs in to nothing.

## Two accounts, end to end

The two aliases keep independent names, profiles, statuses, resolutions and cursors.

```ts
const plan = accountsOf(manifest, { accounts: { work: { region: "eu" }, personal: { region: "us" } } })
// plan.value.accounts → work, personal

await registerAccounts(ctx, {
  manifest,
  options: { accounts: { work: { region: "eu" }, personal: { region: "us" } } },
  auth: (account, integrationID) => [{ integrationID, method: { type: "key", label: account.alias } }],
})
// integrations: "example-work", "example-personal"

resolveAccount(plan.value.accounts, {})                  // ACCOUNT_REQUIRED → "Pass account, one of: work, personal."
resolveAccount(plan.value.accounts, { account: "work" }) // { ok: true, alias: "work" }
resolveAccount(plan.value.accounts, { account: "team" }) // ACCOUNT_UNKNOWN

accountStatuses(plan.value.accounts, {
  work: { state: "ready" },
  personal: { state: "needs_sign_in" },
})
// [{ alias: "work", state: "ready" }, { alias: "personal", state: "needs_sign_in" }]
```

Cursors are bound to plugin, source, account and scope (contract §5). A cursor from `work` is refused as foreign by
`personal`:

```ts
import { encodeBoundCursor, decodeBoundCursor } from "@we-the-rebel-alliance/plugin-contract/cursor"

const work = encodeBoundCursor({ plugin: "example", source: "messages", account: "work" }, { since: 1 })
decodeBoundCursor({ plugin: "example", source: "messages", account: "personal" }, work)
// { ok: false, reason: "foreign" }
```

## Exports

`ALIAS_PATTERN`, `DEFAULT_ALIAS`, `isAlias`, `aliasProblem`, `accountName`,
`accountLabel`, `accountsOf`, `hasAccount`, `localIdentity`, `registerAccounts` (and its types), `resolveAccount`,
`aliasesSentence`, `ACCOUNT_STATES`, `accountStatus`, `accountStatuses`, `NO_ACCOUNTS`, `REASON_MAX`, `redactReason`.
