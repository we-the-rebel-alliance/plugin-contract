# `register`

`register` writes a plugin's doors once (contract §9). A plugin's `src/index.ts` is:

```ts
import { Plugin } from "@opencode/plugin"
import { createBus } from "@we-the-rebel-alliance/plugin-contract/bus"
import { register } from "@we-the-rebel-alliance/plugin-contract/register"
import { manifest } from "./manifest.ts"
import { handlers } from "./handlers/index.ts"

export default Plugin.define({
  id: manifest.plugin.name,
  async setup(ctx) {
    const registration = await register(ctx, manifest, handlers)
    return () => registration.dispose()
  },
})
```

The returned registration carries the bus events emitter, so a plugin wraps it with `createBus(name, registration)`
(§10). Only the events the manifest declares are registered; emitting an undeclared one answers `unavailable`. A plugin
never calls `ctx.rpc.register` itself, never adds a tool itself, and never evaluates a permission rule itself.

## The handler table

One handler per declared method, by the method's name:

```ts
const handlers = {
  events_list: {
    description: "List the messages in a channel.",
    input: { type: "object", properties: { channel: { type: "string" } }, required: ["channel"], additionalProperties: false },
    output: { type: "object", additionalProperties: true },
    async run(input, call) {
      return provider.list({ channel: input.channel, account: call.account, signal: call.signal })
    },
  },
}
```

| Field | Meaning |
|---|---|
| `description` | The agent tool's description. |
| `input` | The method's own JSON Schema object, without `account`. The register adds the account selector. |
| `output` | The answer's JSON Schema. A `plans` method is checked against `{ planId, method }` instead. |
| `run(input, call)` | The work. `call` carries the session, agent, message id, call id, signal, progress, resolved `account` and door. |

`register` refuses a declared method with no handler, a handler the manifest does not declare, and a handler for a
pass-through MCP method (`mcp:*`). A pass-through MCP method is declared in `methods` for its class and access rule; the
vendor's server owns its tool, so this module does not register or proxy it.

## Doors 1–3

| Door | Registration | Permission action |
|---|---|---|
| 1 Agent tool | `ctx.tool.transform`, namespace `<name>`, one tool `<method>` | `<name>.<method>` |
| 2 Code Mode and automations | the same tool, `tools.<name>.<method>` | `<name>.<method>` |
| 3 RPC | one `ctx.rpc.register`, id `<name>`, method `<method>` | `<name>.<method>`, capped by `access` |

The tool's effective name in OpenCode is `<name>_<method>` (dots in a namespace become underscores); the namespace line
is the manifest's `plugin.summary`, which T0 keeps within 400 characters. A `pinned: true` method sets Code Mode's
`pinned` flag; no method is pinned by default.

`pinned: true` is the only Code Mode flag a method may set (`Tool.Options.codemode`, `@opencode/schema/dist/tool.d.ts`).
No method is pinned by default.

## RPC

```http
POST /api/rpc/<name>/<method>
{ "sessionID": "<session>", "input": <the method's input> }
```

The call runs as the session and agent it names, under the agent's rules followed by the session's — the order OpenCode
uses. The envelope is strict: an unknown key is `rpc.invalid_input`, not silently dropped.

Every call passes one gate, `ctx.permission.assert`, once (OpenCode 2.4.1 `PermissionDomain.assert`,
`@opencode/plugin/dist/promise/permission.d.ts`). A tool's `permission` option only hides a fully denied tool and
`tool.add` adds no ask, so the register calls the gate itself for every door. A **read** runs when the rules allow it, or asks when they
say `ask`; a `deny` refuses it. The plugin's own `access` level is final: under `read-only` a non-read RPC call is
refused even with a grant; under `ask-changes` or `all` it needs an ask or a valid grant. An `allow` rule is not a
confirmation. RPC asks never save: an answer applies to that one call.

A **non-read** method over RPC needs one of contract §8's two confirmations (LD-5):

- a permission ask: a rule resolves to `ask`, the gate prompts; a client answers and the call proceeds or is refused;
  or
- a host-signed action grant in the envelope, with the consumer it was issued to:

  ```json
  { "sessionID": "<session>", "input": { "planId": "<id>" }, "grant": "<compact token>", "consumer": "<consumer>" }
  ```

  The register verifies it with `verifyGrant` (`./grant`): audience, consumer, capability `<name>.<method>`, the
  action the method commits (or the method itself when it commits no action), account, manifest hash, exact input
  digest, time window, `cfm`, and single use through the plugin's durable store.

A non-read over RPC with only an allow rule is `PERMISSION_DENIED`; the next step names both ways to confirm it.

The plugin passes the verifier's wiring to `register` as its fourth argument:

```ts
register(ctx, manifest, handlers, {
  grant: {
    keys: { keys: { host_2026_11: publicKeyPem } },
    audience: "@we-the-rebel-alliance/slack-plugin",
    store: { consume: (claims) => storage.claim(claims.jti) },
  },
})
```

## Input, account and output

The register resolves the account through the `accounts` module before the handler runs:

- `accounts: "optional"` methods take `account` in their input. With one account it may be left out; with more than one,
  leaving it out is `ACCOUNT_REQUIRED`, whose next step lists the aliases. An unknown alias is `ACCOUNT_UNKNOWN`.
- `accounts: "none"` methods refuse an `account` field with `INPUT_INVALID`.
- The handler receives the resolved alias as `call.account`, and the input without the selector.

The input is checked against the handler's schema (`INPUT_INVALID`), the answer against its output schema
(`SCHEMA_VIOLATION`). A schema with `additionalProperties: false` also refuses an unknown key.

A `plans: true` method answers `{ planId, method }` and may carry §8's preview fields (`output`, `reaches`, `changes`,
`cost`, `trust`); `method` must be the one declared method whose `commits` names the plan (`PLAN_INVALID` otherwise).
A `commits: "<plan>"` method accepts exactly `{ planId }` from that plan, with no `account`: the grant names the
account. Its handler's own input schema is not used, and anything else is `PLAN_INVALID`. The register does not store
plans: the handler does, and resolves the `planId` when it commits.

## Permissions on operations

For a method that declares `operations`, the register asserts permissions on each one before the handler runs:

- a dotted operation, such as `gmail.users.messages.get`, is the method's action on `<alias>:<operation>`;
- a bare operation, an MCP tool, is `<server>_<operation>` on `*`, with the server derived per alias.

A rule for `work` therefore reaches only `<name>-work_<tool>`, never another alias's tools. A denied or rejected
assertion is `PERMISSION_DENIED`.

## Errors

Every failure reads `CODE: What happened. Next step: What to do.` (contract §12):

| Code | When |
|---|---|
| `INPUT_INVALID` | The input is not an object, breaks the handler's schema, or names an account a `none` method cannot take. |
| `SCHEMA_VIOLATION` | The answer breaks the handler's output schema. |
| `PLAN_INVALID` | A plan or commit does not carry the contract's shape, or names the wrong committing method. |
| `ACCOUNT_REQUIRED`, `ACCOUNT_UNKNOWN` | The account cannot be resolved through `accounts`. |
| `PERMISSION_DENIED` | A rule denies the call, an ask is rejected, or a non-read RPC call has no ask or grant. |
| `GRANT_INVALID` | A grant did not verify, for any reason the verifier publishes. |
| `NEEDS_SIGN_IN` | A handler reports a sign-in failure with the contract's own code. |
| `UNAVAILABLE` | Any other handler failure, cut to one line and redacted. |

`register` maps a handler's own refusal (an error with `code`, `next` and `what`, or a `RegisterError`) to itself. A
code the table does not hold is `UNAVAILABLE`. A sign-in failure must use `NEEDS_SIGN_IN`; an older transport's
`AUTH_REQUIRED` is not a contract code and is reported as `UNAVAILABLE`.

## OpenCode 2.4.1 types

The register uses only the public plugin context (`@opencode/plugin` 2.4.1): `Plugin.Context.agent`, `.tool`, `.rpc`,
`.session`, `.permission` and `.options` (`dist/promise/plugin.d.ts`); `setup` returns a cleanup function or nothing. The structural declarations in
`src/register/*.ts` keep those types out of the published `.d.ts`; the compile-time checks name the host types. The tool
registration follows `ToolEditor.add` and `Tool.Options.codemode` (`dist/promise/tool.d.ts`,
`@opencode/schema/dist/tool.d.ts`); the RPC registration follows `RpcDomain.register` and `RpcRegistration`
(`dist/promise/rpc.d.ts`, `dist/promise/registration.d.ts`); the permission ask follows `PermissionDomain.assert`
(`dist/promise/permission.d.ts`).
