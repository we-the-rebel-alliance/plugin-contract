# `access`

`access` turns a plugin's `access` option and its `methods` table into OpenCode permission rules, and installs them in
every agent (contract §6). It also exports the fenced session rules a grant compiles to (§13), because both use the same
rule language.

```js
import { applyAccess, unguardedAgents } from "@we-the-rebel-alliance/plugin-contract/access"

const access = await applyAccess(ctx, { manifest, options: ctx.options })
status.unguardedAgents = unguardedAgents((await ctx.agent.list()).data, access.rules)
```

`register` calls `applyAccess` itself, so a plugin that only calls `register` gets its access rules too. Import
`access` directly when a plugin builds status or wants the rules for a test.

## The three levels

`options.access` is `all` (the default), `ask-changes` or `read-only`:

| Level | `read` | any other class |
|---|---|---|
| `all` | runs | runs |
| `ask-changes` | runs | asks first |
| `read-only` | runs | off |

A method's `effect` only narrows the table: `ask` asks where the level would allow, `deny` turns it off. There is no
`allow`, so a method can never widen the person's level. An invalid `access` value is `OPTIONS_INVALID`; the module does
not fall back to a wider level.

The rule for a plugin's own method is its permission action, `<name>.<method>`, on `*`. A pass-through MCP method
(`mcp:<tool>` or `mcp:*`) is the MCP tool's action, `<server>_<tool>`, on `*`, one rule per alias: `<name>_<tool>` for
`default` and `<name>-<alias>_<tool>` for any other. A rule for `work` can never reach another alias's tools. Wildcard
rules (`mcp:*`) are emitted before specific ones, because OpenCode's last matching rule wins.

## Into the agents

`applyAccess` calls `ctx.agent.transform` and inserts the generated rules into each agent after its base allow — the
first `*` on `*` with effect `allow`. The base allow therefore cannot override a generated `ask` or `deny`, and a rule
the person or an app adds later still wins for one method.

The transform runs when the plugin loads. An agent registered later does not receive the rules: OpenCode gives a
transform no event for it. `unguardedAgents(agents, rules)` evaluates each generated rule with the same last-match-wins order, so it names every
agent that lacks a rule or whose later rule widens a generated `ask` or `deny` (for example a config `"*": "allow"`
appended after them). Status reports the ids as `unguardedAgents` (contract §11). Nothing patches a later agent behind
the person's back.

## Per-alias names

`serverOf(name, alias, aliases)` is the one derivation of an account's integration or MCP server name: `<name>` for
`default`, `<name>-<alias>` otherwise. It returns `Checked<string>` and refuses an alias the plugin does not declare.
The conformance kit imports it rather than keeping its own copy. The grant fences use the same naming rule for an alias
the app already resolved from the manifest.

## Grant fences

The module also exports the rules a grant compiles to. A fenced session denies everything, then allows exactly one
grant:

```js
const rules = sessionRules(source, grant) // [{ action: "*", resource: "*", effect: "deny" }, …]
const outcome = await read(host, { installed, source: source.id, grant, consumer, context })
```

- `sessionRules(source, grant)` — the source's method on `*`, and each dotted operation as `<namespace>.read` on
  `<account>:<operation>`; a bare operation, an MCP tool, as `<server>_<operation>` on `*`.
- `detailRules(source, detailId, grant)` — the source's rules plus the detail's declared method.
- `probeRules(source, account, identityOperations, probeAction?)` — the probe action and its identity operations.
- `actSessionRules(manifest, act, grant, phase)` — a preview session cannot run the commit action.
- `grantCovers(grant, request)` — the grant's source, account and scope cover a read.

`operationRule`, `namespaceOf`, `accountProblem`, `DENY_ALL` and `evaluate` are exported for the app side and for tests.
`evaluate` is OpenCode's last-match-wins evaluation, with no match asking.

## Errors

| Code | When |
|---|---|
| `OPTIONS_INVALID` | `options.access` or `options.accounts` cannot be read. |
| `UNAVAILABLE` | The agent transform failed; status names the reason. |

A refused read or act keeps its own codes (`PERMISSION_DENIED`, `SOURCE_DISABLED`, `ACCOUNT_MISMATCH`) from `read` and
`act`.
