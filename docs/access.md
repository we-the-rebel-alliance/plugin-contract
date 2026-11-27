# `access`

`access` turns a plugin's `access` option and its `methods` table into OpenCode permission rules, and installs them in
every agent (contract §6). It also exports the fenced session rules a grant compiles to (§13), because both use the same
rule language.

```js
import { applyAccess, unguardedAgents } from "@we-the-rebel-alliance/plugin-contract/access"

const access = await applyAccess(ctx, { manifest, options: ctx.options })
const agents = unguardedAgents((await ctx.agent.list()).data, access.rules)
```

`register` calls `applyAccess` itself, so a plugin that only calls `register` gets its access rules too. A status
handler reads the agents from its call, with no setup state: `await call.unguardedAgents()` answers `{ ok: true, agents }`
or `{ ok: false, error }` and never throws. A handler gets no access registration, so nothing on a call can change the
rules or dispose them. Import `access` directly when a test wants the rules.

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
`default` and `<name>-<alias>_<tool>` for any other. A rule for `work` can never reach another alias's tools. The tool
name is rewritten exactly as OpenCode 2.4.1 rewrites it (`core/src/tool/runtime.ts:300`): `mcp:files.delete` on server
`demo-work` is `demo-work_files_delete`, and `mcp:*` keeps its wildcard. Wildcard rules are emitted before specific
ones, because OpenCode's last matching rule wins.

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
the host read from the plugin's `status.accounts`.

## Grant fences

The module also exports the rules a grant compiles to. A fenced session denies everything, then allows exactly one
grant:

```js
const rules = sessionRules(source, grant) // [{ action: "*", resource: "*", effect: "deny" }, …]
const outcome = await read(host, { installed, source: source.id, grant, consumer, context })
```

Each takes the plugin's declared aliases as its last argument: the host reads them from the plugin's own
`status.accounts` (contract §11), and a fence whose account is not in that list refuses instead of guessing.

- `sessionRules(source, grant, aliases)` — the source's method on `*`, and each dotted operation as `<namespace>.read` on
  `<account>:<operation>`; a bare operation, an MCP tool, as `<server>_<operation>` on `*`.
- `detailRules(source, detailId, grant, aliases)` — the source's rules plus the detail's declared method.
- `probeRules(source, account, identityOperations, probeAction?, aliases)` — the probe action and its identity
  operations. `read.probe` passes the `methods.probe` action and the operations that method declares; a caller supplies
  neither.
- `actSessionRules(manifest, act, grant, phase, aliases)` — deny everything, then allow that phase's method and its
  operations; a preview session cannot run the commit, and a commit runs in its own grant fence.
- `grantCovers(grant, request)` — the grant's source, account and scope cover a read.

`operationRule` returns `Checked<PermissionRule>` and refuses an undeclared alias instead of throwing; its last
argument is `"tool"` for an MCP tool name that contains a dot, and `toolAction(server, tool)` is the one rewrite.
`namespaceOf`, `accountProblem`, `DENY_ALL` and `evaluate` are exported for the app side and tests.
`evaluate` is OpenCode's last-match-wins evaluation, with no match asking.

## Errors

| Code | When |
|---|---|
| `OPTIONS_INVALID` | `options.access` or `options.accounts` cannot be read. |
| `UNAVAILABLE` | The agent transform failed; status names the reason. |

A refused read or act keeps its own codes (`PERMISSION_DENIED`, `SOURCE_DISABLED`, `ACCOUNT_MISMATCH`) from `read` and
`act`.

## Exports

| Export | Does |
|---|---|
| `ACCESS_LEVELS`, `DEFAULT_ACCESS`, `AccessLevel` | the three levels, the default, and the level type |
| `accessLevel`, `rulesFor`, `effectFor`, `methodAction`, `isMcpMethod`, `serverOf`, `toolAction`, `normalizeToolName`, `aliasesFrom` | derive the rules from `options.access` and `methods` |
| `applyAccess`, `unguardedAgents`, `withRules`, `AccessContext`, `AccessRegistration`, `AccessRequest`, `AgentEditor`, `AgentLike`, `UnguardedAgentsResult` | install the rules into every agent, name the agents that lack them, and answer a handler's `unguardedAgents()` |
| `sessionRules`, `detailRules`, `probeRules`, `actSessionRules`, `grantCovers`, `operationRule`, `evaluate`, `namespaceOf`, `accountProblem`, `ACCOUNT_PATTERN`, `DENY_ALL`, `Grant`, `ActGrant`, `ActPhase`, `PermissionRule` | the fenced session a grant compiles to, and its checks |

`register` calls `applyAccess`; the fence helpers are the same rule language on the app side.
