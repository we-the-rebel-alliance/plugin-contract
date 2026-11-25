# How an app uses the contract

This page is the whole journey for an app: discover the installed plugins, read a source with a cursor, subscribe to
nudges, preview and commit a write, and confirm a write from an app UI with no agent. Every call is against this
package's modules; the host calls an app implements are marked as such.

An app owns placement, rendering, consent screens, cadence, budgets, caches and cursors (contract §2). It does not own
provider calls, credentials or permission enforcement. Pull is the truth: cursors and snapshots carry correctness, and a
bus event is only a nudge.

## 1. Discover the installed plugins

`listInstalledPlugins` is the catalog plugin's call. It asks the host which plugins are installed, reads each package's
`capabilities` from disk, validates it with the `manifest` module and hashes it.

```ts
import { listInstalledPlugins } from "@we-the-rebel-alliance/plugin-contract/catalog"

const listing = await listInstalledPlugins(ctx) // a catalog plugin's own context
for (const plugin of listing.plugins) {
  plugin.package       // "@we-the-rebel-alliance/acme-plugin", from its package.json
  plugin.version       // the installed version
  plugin.manifest      // the validated capabilities
  plugin.hash          // "sha256:…", the hash a grant stores
  plugin.manifest.sources   // the reads an app may bind to
  plugin.manifest.actions   // the writes an app may offer
}
listing.problems       // packages that could not be read, one entry each
```

The catalog plugin is its own repository; it serves this listing (`catalog.list`) and its broker (`broker.read`,
`broker.act`) over RPC. An app that runs beside OpenCode can call `listInstalledPlugins` itself with its own context. An
app that cannot read the disk receives the same `CatalogListing` from its catalog plugin and trusts one pinned RPC id,
never a manifest that arrived over RPC.

`plugin.hash` is the manifest's hash. Store it with the person's consent; a changed manifest changes the hash, and
`read` and `act` refuse a grant for another hash until the person consents again.

## 2. Read a source

A read runs under a grant: one consumer, one source, one account, one scope and one manifest hash. The app supplies a
`ReadHost`: two calls over its own OpenCode server. The first opens a session whose rules are exactly the grant's; the
second calls the plugin's RPC method in that session.

```ts
import type { ReadHost } from "@we-the-rebel-alliance/plugin-contract/read"

const host: ReadHost = {
  async openSession({ rules, title }) {
    // This app's own OpenCode call: a session with exactly these permission rules.
    const session = await app.openFencedSession({ rules, title })
    return { sessionID: session.id, close: () => app.closeSession(session.id) }
  },
  async call({ package: packageName, method, sessionID, input, signal }) {
    // The host maps the package to its plugin id. The wire call is POST /api/rpc/<name>/<method>
    // with { sessionID, input }; this app's client owns the URL and the auth.
    return app.rpc(packageName, method, { sessionID, input }, signal)
  },
}
```

Then one read:

```ts
import { read } from "@we-the-rebel-alliance/plugin-contract/read"

const outcome = await read(host, {
  installed,                              // the CatalogPlugin from step 1
  source: "acme.messages",
  grant,                                  // { consumer, source, account, scope?, manifestHash }
  consumer: "notes",                      // the grant key: this app, or this app and its viewer
  since: "-1d",                           // an events read; resolved in the person's time zone
  limit: 100,
  context: { now: Date.now(), timeZone: "Europe/Amsterdam" },
  aliases: ["work", "personal"],          // the plugin's configured account aliases
})

if (!outcome.ok) {
  show(outcome.failure)                   // { code, message, next, retryAfterSec? }
} else if (outcome.kind === "events") {
  await applyEvents(outcome.page.events)
  if (!outcome.page.failed?.length) await saveCursor(outcome.page.cursor) // see Cursors
} else {
  render(outcome.snapshot)                // { data, asOf, cost?, trust: "untrusted" }
}
```

What `read` checks before it calls anything: the source is declared, the grant is this consumer's for the installed
manifest hash, the person has not turned the source off, the requested scope is inside the grant, and the inputs suit
the source — an events read may carry `cursor`, `since`, `limit` and `thumbnails`; a snapshot read may carry `pick`,
whose paths must be in its output schema. The answer is checked for its account, `trust: "untrusted"`, its size against
the source's `maxBytes`, and its page or output shape. A refused or failed read is a value, never a throw.

The aliases are the account names the person configured for the plugin; the plugin's `status` answer lists them, and a
host that keeps the plugin's options has them too. A source with provider operations needs the grant's account in that
list, or the fence refuses the read with `PERMISSION_DENIED` rather than inventing a server name.

### Cursors

An events page carries `cursor` and `more`. The app keeps the cursor; `read` stores nothing. Save it in the same
transaction as the events it accepts:

```ts
const page = outcome.page
await applyEvents(page.events)          // then the removals
await applyRemovals(page.removals ?? [])
if (!page.failed?.length) await saveCursor(page.cursor)
```

- `refused[]` events are never delivered (a secret, instruction-shaped text from someone else, another owner); the app
  may advance past them. They do not hold the cursor back.
- `failed[]` events could not be read this time. Any entry there holds the cursor back: do not save past it.
- `more: false` is not "done". A later call may list new events; the next scheduled read uses the saved cursor.
- A cursor the source did not issue is `CURSOR_INVALID`, never a silent restart. A lost window is `CURSOR_EXPIRED` or a
  `gap` on the page; render the gap, do not invent the missing events.

The cursor is opaque. An app stores the string; it never decodes or edits it. The `cursor` module is the plugin's codec.

### Detail reads and probe

An event may name a detail read in its source (`details`). `readDetail` takes only the fields the detail's `from` names,
from the event as the source listed it, and runs in a session fenced by the source's rules plus the detail's method:

```ts
import { readDetail } from "@we-the-rebel-alliance/plugin-contract/read"

const thread = await readDetail(host, {
  installed,
  source: "acme.messages",
  detail: "acme.messages.thread",
  grant,
  consumer: "notes",
  event,                                  // the event as the page listed it
  aliases: ["work", "personal"],
})
if (thread.ok) renderDetail(thread.answer) // the plugin's declared detail output
```

`probe` reads the signed-in account and the scopes the provider sign-in holds; it reads no content. Use it before a
`$me` param or to show which account an alias is:

```ts
import { probe } from "@we-the-rebel-alliance/plugin-contract/read"

const answer = await probe(host, { installed, source: "acme.messages", account: "work", aliases: ["work", "personal"] })
if (answer.ok) showOwner(answer.answer.owner) // { id, label, verified?, orgs? }, and scopes
```

### Reads through a broker

An app with a host broker passes a transport to `sourceReader`. It builds the one `BrokerRequest` for you and checks a
brokered answer exactly as an embedded read does:

```ts
import { sourceReader } from "@we-the-rebel-alliance/plugin-contract/catalog"

const reader = sourceReader({ host, broker: (request, signal) => app.callBroker(request, signal) })
const outcome = await reader.read(request)
outcome.via // "broker" or "embedded"; outcome.cached is true when the broker served its cache

if (!outcome.ok) show(outcome.failure) // a broker refusal is final: no embedded read behind it
```

`brokerRequest(read)` is the wire shape, if the app sends it itself. It carries `consumer`, the source's `package`,
`version` and `manifestHash`, the `source`, `account`, `scope`, and the events fields or `pick`. It never carries the
manifest or the grant. The consumer is the grant key and the broker's audit line. A broker that says
`{ offered: false }`, throws or answers something that is not a broker answer makes the client read embedded; a refusal
from a broker is passed through the error table and is not retried elsewhere.

## 3. Subscribe to nudges

A plugin emits `changed`, `status` and `account` as `rpc.<name>.<event>` on `/api/event`. A nudge says "look again"; it
never carries the content. Pass each payload to the reader, naming the plugin:

```ts
import { busEventType, readBusEvent } from "@we-the-rebel-alliance/plugin-contract/bus"

const filter = busEventType("acme", "changed") // "rpc.acme.changed"

for await (const payload of app.events()) {
  if (payload.type !== filter) continue
  const decoded = readBusEvent(payload, { name: "acme" })
  if (!decoded.ok) continue                     // not-a-bus-event, unknown-plugin, unknown-event, secret, invalid
  if (decoded.event.event === "changed") {
    await requestRead(decoded.event.data.capability, decoded.event.data.account)
  }
}
```

A decoded event is `{ type, name, event, data }`. `changed` carries `{ capability, account, reason }`, `status` carries
`{ state }`, and `account` carries `{ account, state }`. The reader screens the data for secrets before it validates it,
so a credential is `secret`, never `invalid`; the result then carries no part of the payload. `readBusEvent` throws only
for a bad `options.name`; a payload never throws.

The plugin side is `busEvents(name)`: `register` places it on its one RPC registration, and
`createBus(name, registration)` emits. An app never calls `busEvents`; it filters with `busEventType` and decodes with
`readBusEvent`.

## 4. Act: preview, then commit

A write is an action with a `preview` and a `commit`. The preview writes nothing. The commit is the write. The app asks
for the preview, shows the person `output`, `reaches`, `changes` and `cost`, then commits with the confirmation the host
issued.

```ts
import { act } from "@we-the-rebel-alliance/plugin-contract/act"

const preview = await act(host, {
  installed,
  action: "acme.messages.send",
  grant: actGrant,                        // { consumer, action, account, manifestHash }
  consumer: "notes",
  phase: "preview",
  input: { text: "Deploy finished" },
  aliases: ["work", "personal"],
})
if (!preview.ok) throw new Error(preview.failure.message)

showConfirm(preview.preview)              // output, reaches?, changes?, cost?

const confirmation = await app.askPerson(preview.preview) // the host records the answer
const commit = await act(host, {
  installed,
  action: "acme.messages.send",
  grant: actGrant,
  consumer: "notes",
  phase: "commit",
  input: { text: "Deploy finished" },     // the exact input the person confirmed
  confirmation,                           // the token the host issued
  aliases: ["work", "personal"],
})
if (commit.ok) showResult(commit.result.output)
```

`ActHost.issuedConfirmation(check)` is the host's own check that `token` was issued for this act, effect, account and
consumer. A host with no issuer can preview but cannot commit an act whose `effect` is not `local`. A caller-supplied
token is not a confirmation: the contract verifies one, it never creates one. A preview session allows the preview
method and not the commit; a commit session allows the commit.

`act` checks the action and grant, the manifest hash, the account, the input against the act's input schema, and the
answer for `trust`, size, `output` against the act's output schema, and the one-confirm fields. Pass the exact input the
preview showed the person; the host's confirmation is for the act, account and consumer, so the app must not change the
input between preview and commit.

## 5. A write from an app UI with no agent

Some apps have no session to ask in. The person confirms in the app's own UI, the app's host signs an action grant, and
the plugin verifies it. The grant is one action and its exact canonical input, for one consumer, capability, account,
scope and manifest, until a moment, once.

**The host signs.** It records the person's confirmation as `cfm: true`:

```ts
import { signGrant } from "@we-the-rebel-alliance/plugin-contract/grant"

const now = Math.floor(Date.now() / 1000)
const token = signGrant({
  key: hostPrivateKey,                    // an Ed25519 private key the host holds
  kid: "host_2026_11",
  audience: installed.package,            // "@we-the-rebel-alliance/acme-plugin"
  consumer: "notes",                      // the grant key: this app
  capability: "acme.send_message",        // the commit method's id
  account: "work",
  scope: {},                              // the action grant's scope; {} is the whole action
  act: "acme.messages.send",              // the action id
  input: { text: "Deploy finished" },     // the exact input the plugin will run
  manifest: installed.hash,               // the hash the person consented to
  iat: now,
  exp: now + 60,                          // short: 60 seconds is the default and the recommendation
  jti: crypto.randomUUID(),               // one use; the plugin's store records it
  cfm: true,
})
```

The app sends `{ sessionID, input, grant: token, consumer }` to the plugin's RPC method. The `consumer` is the key the
grant was issued to; the plugin passes it to `verifyGrant` with the exact input.

**The plugin verifies.** The plugin holds public keys and a durable store; it never holds the private key, and it runs
the action only after the verifier answers:

```ts
import { verifyGrant, type GrantStore } from "@we-the-rebel-alliance/plugin-contract/grant"

const outcome = await verifyGrant({
  grant: envelope.grant,                  // the compact token
  input: envelope.input,                  // the exact input, before validation changes it
  act: "acme.messages.send",
  actions: { "acme.messages.send": "required" }, // non-local: required; local: optional
  keys: { keys: { host_2026_11: hostPublicKeyPem }, revoked: [] },
  audience: installed.package,
  consumer: envelope.consumer,
  capability: "acme.send_message",
  account: "work",
  scope: {},
  manifest: installed.hash,
  now: Math.floor(Date.now() / 1000),     // the plugin reads the clock, not the module
  store,                                  // { consume(claims) }: atomic insert-if-absent by claims.jti
})

if (!outcome.ok) {
  // outcome.code is precise, for logs; outcome.contractCode is GRANT_INVALID, the code the app shows.
  return { code: "GRANT_INVALID", message: `GRANT_INVALID: ${outcome.reason.replace(/\.$/, "")}. Next step: confirm the action again.` }
}
await runAction(envelope.input)           // the exact input the grant covers
```

`verifyGrant` checks the token's shape, the trusted key (never "try every key"), the signature, every binding, the
lifetime, the input digest, the confirmation and finally the store. A failure before the store writes nothing. The store
must be durable and atomic: an in-memory map would resurrect a spent grant after a restart. `grant` does no I/O and
reads no clock.

`consumer` is the grant key everywhere: the app's identity in a grant, a broker request and an audit line. Do not reuse
another app's consumer string, and do not issue a grant for one consumer to another.

## 6. The access levels

`options.access` is the person's ceiling; the plugin's `methods` only narrow it. `read` means class `read`; every other
class is a change.

| Level | `read` | any other class |
|---|---|---|
| `all` (default) | runs | runs |
| `ask-changes` | runs | asks first |
| `read-only` | runs | off |

A method's `effect` may ask or deny where the level would allow; there is no `allow`, so a method can never widen the
level. A person's choice for one tool wins. The plugin installs the rules into every agent; an agent that appears later
is reported as unguarded and is never patched behind the person's back.

A read or act also needs the grant's fence to allow it: `read` compiles the grant to a session that denies everything,
then allows that source's method and its operations for the granted account. `act` does the same for one phase. A
`read-only` plugin refuses a non-read RPC call even with a grant; `ask-changes` and `all` need the ask or the grant.
Write and export methods are therefore available over RPC, under a confirmation (LD-5).

## 7. Errors

Every failure reads `CODE: What happened. Next step: What to do.` The one table is `ERROR_CODES` in `events`:

`NEEDS_SIGN_IN`, `SCOPE_MISSING`, `ACCOUNT_REQUIRED`, `ACCOUNT_UNKNOWN`, `ACCOUNT_MISMATCH`, `CURSOR_INVALID`,
`CURSOR_EXPIRED`, `RATE_LIMITED`, `BUDGET_EXCEEDED`, `SOURCE_DISABLED`, `TOO_LARGE`, `INPUT_INVALID`, `SOURCE_UNKNOWN`,
`SCHEMA_VIOLATION`, `PERMISSION_DENIED`, `PLAN_INVALID`, `GRANT_INVALID`, `HOST_UNTESTED`, `OPTIONS_INVALID`,
`UNAVAILABLE`.

| Code | What the app does |
|---|---|
| `NEEDS_SIGN_IN` | show the account to sign in; do not retry until it is signed in |
| `ACCOUNT_REQUIRED` | ask which alias, from the next step's list |
| `ACCOUNT_UNKNOWN` | ask again; the alias is not one the plugin has |
| `ACCOUNT_MISMATCH` | the answer or event is another account's; show the granted account |
| `CURSOR_INVALID`, `CURSOR_EXPIRED` | restart that source from a fresh window; render a `gap` when one is reported |
| `RATE_LIMITED` | wait `retryAfterSec` when present; do not spin |
| `BUDGET_EXCEEDED` | show the budget; a person must widen it |
| `SOURCE_DISABLED` | the person turned this source off; show the toggle, not an error state |
| `TOO_LARGE` | read a smaller window or fewer items |
| `INPUT_INVALID`, `SCHEMA_VIOLATION` | a caller bug or a plugin bug; check the manifest and report the latter |
| `SOURCE_UNKNOWN` | the installed manifest does not declare the source; refresh the listing |
| `PERMISSION_DENIED` | the grant, consumer, scope, manifest hash or access level does not cover it; ask the person, do not widen it yourself |
| `PLAN_INVALID` | the plan expired or does not belong to the commit; preview again |
| `GRANT_INVALID` | the action grant did not verify; confirm again. The precise `GRANT_CODES` value is for logs |
| `HOST_UNTESTED` | the plugin refused an OpenCode release outside its range; update or pin |
| `OPTIONS_INVALID` | the plugin's options cannot be read; fix the configuration |
| `UNAVAILABLE` | the table does not hold the plugin's own code; read its message and next step |

A `ReadFailure` carries `{ code, message, next, retryAfterSec? }`. A plugin's own refusal, as a `SourceError` or an error
in the table's form, is read with `parseSourceError`; a code the table does not hold is `UNAVAILABLE`. Treat an unknown
code as `UNAVAILABLE`, never as success.

## What the app owns

| The app keeps | Why |
|---|---|
| the consent screen and the grant | consent is the unit of trust; a changed manifest hash asks again |
| its cursors | `read` is stateless; `failed[]` says when to hold the cursor back |
| its cache and budgets | the plugin reports cost; the app enforces its own budget |
| placement and rendering | plugins never render; shapes and events are data |
| its consumer key | it is the grant key, the broker's audit line and the scope of everything the app may read |
