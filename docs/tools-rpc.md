# `tools-rpc`

`tools-rpc` is the transport a plugin uses today to expose its tools as RPC methods. It is the shared part of the
family's `src/host/tools-rpc.ts` version 2, with an opt-in per-method resource resolver, packaged as a value rather than
a block edited between markers.

Contract §9's `register` module will wire doors 1–3 from one handler table. Until `register` ships, a plugin keeps this
module; `docs/contract.md` §15 lists both.

## The id

A plugin's tools RPC is `<plugin id>.tools` (`toolsRpcId`), where the plugin id is OpenCode's: lowercase dotted words,
such as `google-workspace.gws`. This is not the source-id prefix (`gws`). `registerToolsRpc` refuses any other shape.

```js
const close = await registerToolsRpc(ctx, { plugin, methods })
// POST /api/rpc/google-workspace.gws.tools/<method>
// { "input": { "sessionID": "<session>", "input": <the tool's input> } }
```

A manifest that names the id lets an app call the plugin without guessing. `toolsRpcIdProblems(declared, describe?)`
checks the declared id, and compares it with the plugin's `describe` answer when one is available. That comparison is
diagnostic only: an RPC id has no owner in OpenCode.

## The plugin's part

What the family's block held becomes the `plugin` option:

| Field | Meaning |
|---|---|
| `id` | the OpenCode plugin id; the RPC id is `<id>.tools` |
| `nextSteps` | one next step per code; read at each call |
| `shapeInput`, `shapeResult` | optional shapers; absent means the input and result pass through |
| `pluginError` | optional mapping from a provider error to `{ code, what, next }` |

`methods` is the plugin's table: every tool the plugin owns or exposes, by exact name, with a class (`read`, `write`,
`send`, `export`, `destructive`). A tool the server adds later is not a method until it is classified; `describe` lists it
as `unclassified`.

## Permission evaluation

A script runs as a session and the agent it names. The rules that decide are the agent's, then the session's, with the
host's order (the last matching rule wins), which is the order the model path uses:

1. The rule for the method's permission action is resolved before dispatch. Only `allow` runs; an `ask` is refused with
   no prompt and no tool call, and a `deny` is refused with no tool call.
2. A plugin method with a `resource(input)` resolver is resolved on that resource, `<account>:<operation>`, instead of
   `*`. A resolver that names no resource is refused as `RESOURCE_UNRESOLVED`. A read method's operation must start its
   last dotted segment with a read verb (`get`, `list`, `search`, …), unless the method sets `resourceKind: "any"`.
3. An MCP method then runs through OpenCode's own executor from `ctx.tool.list()`, which checks `<server>_<tool>` and
   sends OpenCode's own credential.
4. A plugin-owned method runs its own spec, with its own `ctx.permission.assert` calls.
5. An inner `ask` of the RPC's own calls in flight is refused, and the error names it. A saved "Always allow" approval
   does not authorize an ad-hoc script: a script's grant is a rule in config, or a session the host opened.

## Codes

The module answers with its own codes, each with a next step:

`SESSION_UNKNOWN`, `SESSION_AGENT_REQUIRED`, `PERMISSION_DENIED`, `SERVER_CONFLICT`, `AUTH_REQUIRED`, `CONNECTING`,
`CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED`, `TOOL_UNAVAILABLE`, `UPSTREAM_ERROR`, `CANCELLED`,
`ACCOUNT_UNKNOWN`, `RESOURCE_UNRESOLVED`.

These belong to the transport, not to contract §12's error table. A plugin's handlers map the contract's codes
themselves; the two meet at the caller.

## Other exports

- `defineRpc`: `Rpc.define`'s identity and its one check (an error name starting with `rpc.` is reserved), inlined so
  the package needs no runtime dependency.
- `evaluate`, `hidden`: the host's last-match-wins rule on an action and resource.
- `upstreamText`: a provider message's first line, cut and redacted for a refusal.
- `READ_VERBS`, `readOperation`, `RESOURCE_PATTERN`, `toolsRpcId`, `isToolsRpcId`, `pluginIdOf`.
