# `read`

The consumer side of a source read (contract §7 and §9). An app resolves the manifest of the installed package, checks
that the person's grant covers the read, and calls the plugin's method inside a session fenced by exactly the grant's
rules. The app keeps its own cursor; `read` returns the page and stores nothing. The host also reads the plugin's
`status` answer (contract §11), and its `status.accounts` supply the aliases a fence may name; a caller cannot invent
that list, and status that is unavailable is refused rather than defaulted.

## What a read does

1. The source is declared, the person has not turned it off, and the grant is this consumer's for the installed
   manifest hash and account.
2. The requested scope is within the grant. Params, `since`, `$me` and `pick` are resolved and checked before anything
   is called.
3. The call runs in a host session whose rules are the grant's (`sessionRules`), and the session is always closed.
4. The answer is checked: the account, `trust: "untrusted"`, the size against the source's `maxBytes`, and an events
   page's shape or a snapshot's output schema. `pick` keeps only the selected paths.

## Exports

| Export | Does |
|---|---|
| `read(host, request)` | reads a source under a grant; never throws for a refused or failed read |
| `readDetail(host, request)` | reads one declared detail of an event, pinned to the confirmed scope |
| `probe(host, request)` | reads the signed-in owner and scopes; it reads no content |
| `checkReadRequest(request)` | the checks before any call, and the source and scope to read |
| `acceptAnswer(source, account, answer, options?)` | checks an answer as a read does, then applies `pick` |
| `detailFields(source, detailId, event)` | the event fields a detail may take, and nothing else |
| `ReadHost`, `ReadRequest`, `ReadOutcome` | the host the app supplies, one read, and its result |
| `EventsPage`, `Snapshot`, `DetailRequest`, `ProbeAnswer` | the checked shapes |
| `FailureCode`, `ReadFailure` | the contract's error table, as a failure |

## Example

```js
import { read } from "@we-the-rebel-alliance/plugin-contract/read"

const outcome = await read(host, {
  installed,                       // readInstalledDescriptor(packageDir)
  source: "acme.feed",
  grant,                           // consumer, source, account, scope, manifest hash
  consumer: "notes",
  since: "-1d",
  limit: 100,
  context: { now: Date.now(), timeZone: "Europe/Amsterdam" },
})

if (!outcome.ok) console.log(outcome.failure.message) // CODE: what happened. Next step: …
else if (outcome.kind === "events") console.log(outcome.page.events.length)
```

`host` supplies two calls: `openSession({ rules, title })` and `call({ package, method, sessionID, input })`. Each app
implements them over its own OpenCode server.
