# `bus`: nudges from a plugin to an app

The `bus` module is how a plugin tells every app that something changed, without sending the something itself. It
implements contract §10: three typed events, published by OpenCode as `rpc.<name>.<event>` on `/api/event`.

```ts
import { createBus } from "@we-the-rebel-alliance/plugin-contract/bus"
```

## A nudge, not the data

A bus event is a **nudge**. It says "look again"; it never carries the message, the file or the record. An app that
receives one re-reads the plugin through its RPC method (door 3, contract §9) and gets the content there, with a cursor
and a trust marking.

This is the contract's rule that pull is the truth and push is only a nudge (§1 principle 5). It has three
consequences:

- a missed event costs a re-read, never data;
- an app never trusts event text as content, so there is nothing in an event to trust;
- a plugin may emit more often than it needs to. An app may coalesce nudges.

## The three events

| Event | Data | When |
|---|---|---|
| `changed` | `{ capability, account, reason }` | the plugin knows a source changed: after its own write, or when a webhook arrives |
| `status` | `{ state }` | the plugin's own state changed |
| `account` | `{ account, state }` | an account signed in, out, or needs sign-in |

- `capability` is one of the plugin's own capability ids, `<name>.<capability>`, such as `slack.mentions`.
- `account` is an account alias under contract §5: lowercase letters, digits and underscores, starting with a letter
  (`default`, `work`, `work_2`).
- `state` is `ready`, `needs_sign_in` or `error` (contract §5).
- `reason` is a short one-line explanation, at most 160 characters: `write`, `webhook`, `token-refresh`. It is for a log
  or a diagnostic, not for the app to render as content.

Every event's data is one closed object: exactly those fields, all required, with no extras. The definition registers
these JSON Schemas with OpenCode, so the host and every reader can validate the same shape.

## How a plugin wires the writer

`createBus` validates the plugin name, registers one `Rpc.PortableDefinition` with id `<name>`, no methods and the three
events, and returns a typed writer. Call it once during the plugin's setup:

```ts
import type { Plugin } from "@opencode/plugin"
import { createBus } from "@we-the-rebel-alliance/plugin-contract/bus"

export const plugin: Plugin.Plugin = {
  id: "slack",
  async setup(ctx) {
    const bus = await createBus(ctx, "slack")

    // After the plugin has written through the provider.
    await bus.emit("changed", { capability: "slack.mentions", account: "work", reason: "write" })

    // When an account needs attention.
    await bus.emit("account", { account: "personal", state: "needs_sign_in" })
  },
}
```

The plugin's `<name>` follows contract §3: lowercase letters and digits, 2 to 31 characters, no hyphen. `createBus`
throws at setup for a name that breaks the rule, because by then the name is a bug in the plugin, not data from a
provider. Everything after setup is returned, never thrown.

`emit` answers with a result:

| Result | Meaning |
|---|---|
| `{ ok: true }` | the host accepted the event |
| `{ ok: false, reason: "invalid", problems }` | the data breaks the schema; `problems` names fields, never values |
| `{ ok: false, reason: "secret" }` | the data holds a credential; nothing was emitted |
| `{ ok: false, reason: "unavailable" }` | the host's registration failed or was disposed; the nudge is lost, the next pull still wins |

## How an app reads and re-reads

An app subscribes to `/api/event` and passes each payload to `readBusEvent`, naming the plugin it cares about:

```ts
import { readBusEvent } from "@we-the-rebel-alliance/plugin-contract/bus"

for await (const payload of events) {
  const read = readBusEvent(payload, { name: "slack" })
  if (!read.ok) continue

  if (read.event.event === "changed") {
    // Re-read the capability through door 3; the event holds no content.
    await reread(read.event.data.capability, read.event.data.account)
  }
}
```

A decoded event is `{ type, name, event, data }`, where `type` is exactly `rpc.<name>.<event>`, `name` is the plugin's
name, `event` is `changed`, `status` or `account`, and `data` is that event's data. The reader ignores the rest of the
`/api/event` envelope (`id`, `created`, `location` and so on), so it needs no OpenCode SDK.

`readBusEvent` never throws. When a payload is not this plugin's bus event, it answers one reason, checked in this
order:

| Reason | Meaning |
|---|---|
| `not-a-bus-event` | the payload is not an RPC event at all, or its type is not `rpc.<name>.<event>` |
| `unknown-plugin` | it is an RPC event of another plugin |
| `unknown-event` | it is this plugin's RPC event, but not one of the three bus events |
| `secret` | the event's data holds a credential; it is refused and no part of it is returned |
| `invalid` | the event's data breaks the schema; `problems` names fields, never values |

## Naming

The name is derived once, from the plugin's `<name>` (contract §3):

| Thing | Form | Example |
|---|---|---|
| RPC id | `<name>` | `slack` |
| Bus event on `/api/event` | `rpc.<name>.<event>` | `rpc.slack.changed` |

`busEventType(name, event)` builds the same string for an app that wants to filter before decoding.

## Secrets are refused

Contract §13 refuses an event that holds a secret. Both sides screen the JSON of the event's data with the package's
secret detector. The writer screens before it validates or emits; the reader screens before it validates the schema,
so a secret is reported as `secret`, never as `invalid`. A payload holding a private key, an API key, a token, a
password or a connection string is refused with reason `secret`, and the result carries no part of the payload.

The reader applies the same schema as the writer, so a field the contract does not name is `invalid`; if that field
holds a secret, the earlier screening reports `secret` instead.

## Example

A plugin writes one message, then nudges every app:

```ts
const sent = await slack.send({ account: "work", channel: "C0123", text: "Deploy finished" })
if (sent.ok) {
  const nudged = await bus.emit("changed", { capability: "slack.mentions", account: "work", reason: "write" })
  if (!nudged.ok && nudged.reason === "secret") {
    // The capability, account and reason held something token-shaped. Fix the reason; do not log the payload.
  }
}
```

An app that holds a `rpc.slack.changed` for `work` re-reads `slack.mentions` for `work` through RPC and renders what it
finds. The event itself said only that the source changed.
