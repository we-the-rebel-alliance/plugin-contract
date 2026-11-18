# The contract, version 1 (L0 to L2)

The source contract has three layers: the data model (L0), the descriptor a plugin declares (L1) and the protocol it implements (L2). Each project builds its own features on top; nothing here needs a host. The design and its decisions: [app#2346](https://github.com/we-the-rebel-alliance/app/issues/2346#issuecomment-6853030617).

**Three roles.** A **plugin** owns its sources: the declaration, the reads, the provider sign-in, truthful cost and conformance in its own CI. The **contract** (this package) owns the language. A **project** (Memory, Artifacts, jelly and any after them) owns its features, consent, cache, budgets and cursors, built from the library. No project restates a plugin's sources, calls a provider directly or depends on another project.

**Reads only.** Writes stay where they are: plan, then commit in the plugin, with the project's own confirmation.

## L0: the data model

Every result is marked `trust: "untrusted"`: its text is data, never instructions. An owner is `{ id, label }` (both required, D8), where `id` is scheme-qualified (`mailto:`, `slack:`). It may carry `verified: false` when the provider does not confirm who it is, so the id is the plugin's best knowledge (Wispr Flow names OpenCode's credential, `wisprflow:credential:<id>`); a consumer shows such an owner as unverified, and absent means the plugin vouches that the provider named it. Only `false` is accepted, so an owner has one encoding ([#30](https://github.com/we-the-rebel-alliance/source-contract/issues/30) item 13). A consumer on an older package refuses an owner with `verified`, so it ships in a minor release and a plugin sends it after consumers re-vendor.

### Events

An **event** is one thing a source recorded: `source`, `account`, `external_id` (at most 512 characters, stable within the source and account), `kind`, `occurred_at` (UTC ISO 8601), `thread` (a stable key or null; first-class), `actors` (at most 20, each `{ role, id, name? }` and, since v0.3, `kind?`, `identities?`, `self?`), `title` (at most 300), `text` (at most 4096), `url` (https or null), `labels` (at most 20), `hash` (`sha256:` of every other field) and, since v0.3, the optional `reply_to`, `audience`, `domains`, `sections`, `parts` and `facts` described below.

**Kinds:** `message`, `meeting`, `session`, `bookmark`, `issue`, `pr`, `commit`, `doc`, `event`, `task`, `file`, and `x-<plugin>/<kind>` for a plugin's own.

**A page** of `events_list`:

| Field | Means |
|---|---|
| `source`, `account`, `owner` | whose page it is, on an empty page too |
| `events` | oldest first |
| `cursor`, `more` | where the next call starts; `more: false` is not "done", since a later call may list new events |
| `refused[]` | final drops with a reason: instruction-shaped text from someone else, a secret, the wrong owner. The consumer may advance past them. |
| `failed[]` | retryable drops. Any entry holds the cursor back. |
| `gap` | `{ reason: "expired" \| "window-truncated", since }` when history is lost |
| `cost` | what the provider reported, for a billed source |
| `removals[]` | things the source no longer stands behind: `{ external_id, at, reason }`, with `reason` `deleted`, `withheld` or `expired`. An answer, not a drop: the consumer may advance past it ([#27](https://github.com/we-the-rebel-alliance/source-contract/issues/27)). |

**A removal** ([#27](https://github.com/we-the-rebel-alliance/source-contract/issues/27)) names the `external_id` the source listed before, never a hash (D2). Its `at` is when the source learned of it, UTC, never later than the page's `asOf`. It is optional on any page, and an empty list is left out. A removal is an answer, not a drop: the page's cursor covers it and it never holds the cursor back, so no id is in both `removals[]` and `failed[]`, and no id appears twice. It may name an id that is also among the page's events (a tombstone, such as jelly's `file` event with its words cleared): a consumer applies the page's `events` first, then its `removals[]`, and may apply both in the one transaction in which it saves the page and its cursor. A source lists a removal on the first page whose cursor reaches it and need not repeat it on later pages; a consumer treats a repeat as harmless. The cap of 500 entries limits one page; it does not promise that a consumer applies every entry before it answers (Memory, for one, applies a few per ingest and defers the rest). A thing is back when a later event names the same id with an `occurred_at` later than the removal's `at`. What a consumer retracts is its own business.

**A `gap` is answered once** ([#28](https://github.com/we-the-rebel-alliance/source-contract/issues/28)). It appears on the page where the source restarts its window: the page that answers the consumer's cursor, or the first page of a read from `since`. No later page of that read repeats it, at either reason, even while the hole is still behind the cursor. Reading again at the same cursor is the same page, so it may answer the same `gap` again. A consumer counts one resync per `gap`, so a repeat at an advanced cursor would be a second resync.

**A cursor** is opaque and versioned, bound to the plugin, source, account and scope. A foreign cursor is refused with `CURSOR_INVALID`; lost history is `CURSOR_EXPIRED` with `gap`. A consumer saves its cursor in the same transaction as the page it accepts.

The `events` and `cursor` modules hold the normaliser, the hash, the secret-pattern refusal and the codec (the plugin family's part).

### Actors ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §1)

An actor may say **what kind of actor** it is: `kind` is `person`, `agent`, `bot` or `service`. Absent means "not known to be one", never a confirmed person, and every agent, bot and service a plugin can recognise carries one. The kit's `actor-kind` check holds a fixture to that: each actor the fixture names in `machineActors` carries a machine kind on every page that lists it.

An actor may carry up to 10 **identities**: `{ id, strength, basis }`, another scheme-qualified id for the same actor, never the actor's own `id`. `strength` is `strong` (from an authenticated source: a workspace directory, a chat profile's email, a code host's verified email) or `weak` (observed: a `From` or `Reply-To` header, a display name, a signature), and `basis` names the provider field it came from, up to 64 characters, such as `slack.profile.email`. Only a strong identity merges people automatically; a weak one is a proposal the person confirms ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §7). `self: true` is a hint that the actor is the signed-in person, and Memory alone decides who the person is; `self: false` only downgrades.

**Roles** are a vocabulary. `from` is the author, and `author` is read as its alias. A page may list several — a `From` header carries several addresses, and gws lists one `from` actor for each — so a consumer reads the first `from`, or else the first `author`, as the author, and the rest are other senders. The kit's `one-author` asks a plugin adopting v0.3 to list one, because one author is what Memory keys on. `to`, `cc` and `bcc` are recipients, and `mentioned` is an actor the provider resolves from a mention, never a parsed name. `assignee`, `creator`, `reviewer`, `organizer`, `attendee`, `owner`, `speaker` and `agent` keep their meaning, and an unknown role is read as "involved". Whether an item was addressed to or mentions a person is Memory's decision, from `to`, `cc`, `bcc`, `mentioned` and `audience: dm`: a plugin lists them and decides nothing.

### Event metadata ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §2)

| Field | Rule |
|---|---|
| `reply_to` | The parent's `external_id`, or a source-scoped key such as `gmail-message:<Message-ID>`: one line, at most 512 characters. |
| `audience` | `dm`, `group`, `channel`, `email` or `public`. A work item visible to a team is `group`, and one in a public place is `public`. Absent means unknown. |
| `domains` | At most 20 lowercase domains of the recipients, for mail and shared channels. |
| `sections` | At most 20 `{ heading, text }`: a long item by heading. Each `text` takes its own 4,096 characters, so long notes are not cut at the event's 4,096. A heading is one line of at most 300. |
| `parts` | At most 50 `{ id, text, actor? }`: a growing item such as a session or a transcript. A part's `id` and `text` never change once listed, and a re-listed item may list only its new parts. `actor` names an actor id on the same event. |

**`thread`** is normative for every source with conversations or series, and stable across pages.

**One event fits the source's `maxBytes`.** A page always carries at least one event (`fitPage` keeps at least one, and truncation is never a page's answer), so an event whose own JSON is over the source's `maxBytes` (64 KB by default, at most 1 MB) cannot be paged around: a consumer refuses the page as `TOO_LARGE`. So a growing item lists only the parts it has not listed yet, and long notes are split across pages, or cut to the section that matters. The kit's `event-within-max-bytes` names the event that is too large and how to make it fit ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §2, §8).

### Facts ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §3)

An event may carry up to 20 **facts**: what the source already knows in code, such as an issue's assignee, due date and state, derived in the plugin's code from provider fields and never from free text. A fact is one of three core types, and each schema is closed (`additionalProperties: false`):

| Type | Fields |
|---|---|
| `commitment` | `key` (a stable id within the source and account, at most 200), `title` (at most 300), `owner` (an actor id on the same event), `counterparty?` (likewise), `due?` (`YYYY-MM-DD`), `state` (`open`, `done` or `cancelled`) and `url?` (https). Two pages that list the same commitment give the same key. |
| `person.attribute` | `actor`, and at least one of `org`, `team` or `role`, each at most 120, from structured profile or directory data only. |
| `meeting.attended` | `actor`, `response` (`accepted`, `declined`, `tentative` or `needs_action`) and `organizer` (a boolean). |

A source **declares its fact types** in its descriptor (`"facts": ["commitment"]`), and a fact of an undeclared type fails the kit's `facts` check. No fact has a field for a version: Memory stamps the installed package's version, read from disk, on each fact it files, so the page cannot set one, and a new plugin version's facts are proposed until the person confirms that version. No schema has a field for a sensitive trait (health, religion, politics and the like), and v0.3 has no plugin-defined type. The three schemas are published as `dist/schemas/fact.commitment.json`, `fact.person.attribute.json` and `fact.meeting.attended.json`.

### Hints and routines ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §4, §5)

A source may list **hint** files (`"hints": ["hints/mail.md"]`): a hint says how to read one kind of item, in at most 1,500 characters. Its frontmatter is `source` (one of the plugin's own source ids), `kinds` (at least one kind) and, optionally, `produces`, and its body holds the guidance. A hint is data, quoted inside Memory's prompt and never an instruction to it, so a forbidden key — `apply`, `stated_by`, `space`, `budget` or `priority` — makes the file invalid, as any other unknown key does.

A source may list **routine** files (`"routines": ["routines/meeting-actions.md"]`): a routine is for a meaning Memory's core extractor cannot find even with hints. Its frontmatter is `id`, `title`, `reads: { sources, kinds }` (the plugin's own sources only) and `produces`, and its body holds instructions of at most 4,000 characters. A tier, a schedule, a budget, a priority, an apply mode, a `stated_by` or a namespace makes the file invalid: the namespace is the installed package's, and the rest are Memory's decisions. Memory's first engine runs only its own core routines, with plugin hints and facts, so the format is defined now to be stable; a plugin ships a routine only later, and only when hints prove insufficient.

**`produces` names a knowledge type, not a structured fact.** It is one of the seven types Memory's core extractor finds — `commitment`, `decision`, `fact`, `preference`, `constraint`, `person` and `project` (Memory's extractable types, design v3.1 §5.1) — which a file helps it find. That is a different list from the fact types of `facts[]` above, which a plugin derives in code: `person.attribute` and `meeting.attended` are facts, and never a `produces` value, and timeline, voice and voice samples are derived inside Memory and never named either. Memory ignores a `produces` type the person has not consented to, so a file may name a type before that type is on.

The `hints` module holds the list (`PRODUCES_TYPES`) and checks both kinds of file (`hintProblems`, `routineProblems`), and its frontmatter schemas are published as `dist/schemas/hint.json` and `routine.json`.

### Versioning and the digest ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §6)

The package's minor release carries every addition, and `sources.contractVersion` stays 1: within a version the contract only grows. The event `hash` covers a new field only when it is present, so an event without them hashes exactly as in v0.2, and the order a plugin builds a new field in does not change its hash. Memory computes a `sha256:` digest over each whole hint file, each routine file and each facts declaration; a version written in a file is a label only.

### Snapshots

A **snapshot** is the latest state of something, read on demand: `{ data, asOf, cost?, trust }`, with `data` valid against the source's declared `output`.

**The output registry** (`registry`) holds the shapes, so a project that renders a shape renders every source that outputs it: `agenda` (gws `calendar.today`'s shape), `inbox`, `metric`, `list`, `progress`, `note`, `links`, `countdown`, `image`, `thread`, `table` and `record`, seeded from jelly's Home templates. Each is published as JSON Schema in `dist/schemas/output.<name>.json`. A name is never removed or narrowed within a contract version.

### Errors

One table, in the family's form: `CODE: what happened. Next step: …`.

| Code | Means |
|---|---|
| `NEEDS_SIGN_IN` | the provider needs a sign-in (`AUTH_REQUIRED` is the same) |
| `SCOPE_MISSING` | the sign-in lacks a scope the read needs; reconnect with it |
| `ACCOUNT_MISMATCH` | the source is signed in to another account than the grant's |
| `CURSOR_INVALID` | the cursor is not this source's, account's and scope's |
| `CURSOR_EXPIRED` | history is gone; the answer carries `gap` |
| `RATE_LIMITED` | the provider's limit; with `retryAfterSec` |
| `BUDGET_EXCEEDED` | the person's own budget is spent; not the provider's limit |
| `SOURCE_DISABLED` | the person turned the source off; not an error state |
| `TOO_LARGE` | the answer is over the source's `maxBytes` |
| `INPUT_INVALID` | the plugin refused a malformed input; compare the descriptor with the installed plugin |
| `SOURCE_UNKNOWN` | the plugin has no such source; compare the descriptor with the installed plugin |
| `SCHEMA_VIOLATION` | an input or an answer breaks the contract |
| `PERMISSION_DENIED` | a session rule refused the read |
| `UNAVAILABLE` | anything else; try again later |

## L1: the descriptor

One top-level `sources` key in the plugin's `package.json`, read from the **installed package on disk**, never over RPC: an RPC id has no owner in OpenCode, so `describe` and anything said over RPC are diagnostics only. It is host-neutral, not under any project's key; a project's own declaration refers to source ids.

```json
"sources": {
  "contractVersion": 1,
  "items": [
    {
      "id": "gws.gmail", "kind": "events", "reads": "message",
      "tool": "events_list", "input": { "source": "gmail" },
      "accounts": { "named": true },
      "scope": { "keys": ["labels"], "describe": "Which labels" },
      "details": [{ "id": "gws.gmail.message", "tool": "read", "from": ["external_id"] }],
      "permission": { "events": "gws.events_list",
        "operations": ["gmail.users.history.list", "gmail.users.messages.list", "gmail.users.messages.get"] },
      "private": true, "cost": { "class": "free" }, "maxBytes": 262144, "retentionDays": 30
    },
    {
      "id": "gws.calendar.today", "kind": "snapshot", "tool": "calendar_today",
      "output": "agenda", "params": { "window": { "relative": true } },
      "accounts": { "named": true },
      "permission": { "tool": "gws.calendar_today", "operations": ["calendar.events.list"] },
      "private": true, "cost": { "class": "free" }, "maxAgeSec": 900, "maxBytes": 65536
    }
  ]
}
```

The rules:

- every tool a source names is a read (`readOnly`, class `read`);
- `permission.operations` is **required**: grants and a person's off switches key on it. A dotted operation (`gmail.users.messages.get`) is asserted as `<namespace>.read` on `<account>:<operation>`, and a bare one, an MCP tool (`slack_read_channel`), as `<namespace>_<operation>` on `*`; the namespace is the source id's first segment, and every action of the source begins with it;
- `accounts.server` (optional) names a plugin's per-account MCP server, beginning with the namespace and holding `{account}` once, such as `plaud-{account}`: for every account but `default`, a bare operation is asserted as `<server>_<operation>` on `*` (`plaud-work_list_files`), and the default account keeps `<namespace>_<operation>`. The account must then be letters, digits, `_` or `-` ([#30](https://github.com/we-the-rebel-alliance/source-contract/issues/30) item 9). The key is additive to the contract, but Memory's `accounts` schema is strict and `readInstalledDescriptor` runs it first, so a consumer on an older package refuses a descriptor that carries it: it ships in a minor release, consumers re-vendor first, and only then does a plugin (Plaud) declare it.
- optional `permission.readsIdentity`: `true` when the source's content reads assert an identity operation, such as X reading mentions with the signed-in user's id (#30 item 4). Every identity operation is still declared in `permission.operations`; absent means content reads never assert one;
- `scope.keys` are what a person confirms (labels, channels, repositories);
- each `details` entry names the event fields its input is (`external_id`, `thread` and the other identifiers), never `title` or `text`; it is called with `{ account, scope, fields }` under the source's own rules, and the plugin refuses an event outside the confirmed scope;
- `private: true` is shown at consent;
- `cost` states price units, including `probe`'s; a billed source must state them; a price may state `conditions` (the short sentence shown at consent when it applies) and `min` (the lowest rate that may apply, at most `usd`) (#30 item 6);
- `cadence.providerMinMinutes` only where the provider imposes a minimum;
- `maxBytes` defaults to 64 KB and may go up to 1 MB;
- a snapshot's `output` names a registered schema;
- optional `urlHosts`: the hosts a source's `url` may point at, for display (Memory's rules);
- optional `scope.suggest`: `{ tool, operations }`, a read-only tool that lists choices at consent, run only at bind in its own session, and never stored;
- optional `facts` (an events source only): the fact types its events carry, each a core type and each declared once ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §3);
- optional `hints` and `routines`: the paths of the files the package ships for this source, each a relative lowercase `.md` path inside the package and each declared once ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §4, §5). The keys are additive to the contract, but Memory's descriptor schema is strict and `readInstalledDescriptor` runs it first, so a consumer re-vendors before a plugin declares one, as for `removals[]`.

`readInstalledDescriptor` reads, validates and hashes it (`sha256:` of canonical JSON). The package exports one `SourceItem`, Memory's schema type, from `descriptor` and `schema` alike, so an item read from disk goes to `read`, `acceptAnswer` and the conformance kit as it is ([#30](https://github.com/we-the-rebel-alliance/source-contract/issues/30) item 8). A grant stores the hash; a changed descriptor asks the person again. Memory's schema admits three optional keys agreed in [issue #4](https://github.com/we-the-rebel-alliance/source-contract/issues/4): `sources.rpc` (the plugin's tools-RPC id, which `read` then calls), `sources.probe.action` (the probe tool's permission action) and per-source `permission.identity` (the identity operations `probe` asserts, each among `permission.operations`). With the last two declared, `probe` is fenced from the descriptor alone; until then a consumer passes the identity operations. `permission.identity` may be empty: the probe then asserts only `sources.probe.action`; absent still means undeclared, so a consumer uses its fallback ([#30](https://github.com/we-the-rebel-alliance/source-contract/issues/30) item 1). A source whose content reads assert an identity operation declares `permission.readsIdentity: true`, and the kit then allows that overlap for that source only; every identity operation must still be among `permission.operations` ([#30](https://github.com/we-the-rebel-alliance/source-contract/issues/30) item 4). A source that states its grants verbatim (`permission.rules`, GitHub's `github_api` on `GET /user`) declares its probe's grants as `permission.identityRules: [{ action, resource }]`, each among its `rules`, instead of `identity`; `probe` is then fenced to `sources.probe.action` and those rules exactly, and `[]` means the probe asserts only its action ([#30](https://github.com/we-the-rebel-alliance/source-contract/issues/30) item 10). `identityRules` is additive to the contract, but Memory's permission schema is strict and `readInstalledDescriptor` runs it first, so a consumer on an older package refuses a descriptor that carries it: it ships in a minor release, consumers re-vendor first, and only then does a plugin (GitHub) declare it, the same order as `removals[]`.

## L2: the protocol

| Method | In | Out |
|---|---|---|
| `events_list` | `source, account?, scope?, cursor?, since?, limit?` | the page |
| `snapshot_read` (the source's `tool`) | `source, account?, params?` | the snapshot |
| `probe` | `source?, account?` | the owner and the granted scopes; reads no content |
| `describe` | none | the descriptor, for diagnostics only |

**Params are resolved by the library at read time** (`params`), so a plugin receives plain values:

- relative times: `"now"`, `"-90m"`, `"+2h"`, `"-7d"`, `"+1w"`, in the person's time zone, rounded down to the minute, at most 366 days either way;
- windows: `"today"`, `"yesterday"`, `"tomorrow"` (midnight to midnight where the person is), or `{ since, until }`;
- `$me`: the signed-in account, as `probe` names its owner, where the param declares `me: true`.

**Every read can carry `pick`** (`pick`): paths such as `items[].title`, checked against the output schema when the binding is made. Only those paths are returned, and a missing optional key is left out, not an error.

## The trust rule

The descriptor comes from the installed package, its version checked against the install, and **every read runs in a session limited to exact allow rules from the grant** (`permission.sessionRules`): a deny of everything, then the method's action and each operation's rule. OpenCode checks each inner tool call against the calling session's rules, and the last matching rule wins, so the session is a real sandbox whatever the agent allows. A broker or a project may only narrow these rules, and the plugin's own `access` setting stays final.

**On the plugin side** (`tools-rpc`), a method with a resource resolver is resolved before dispatch on the exact `<account>:<operation>` it names, never on `*`. A `class: "read"` method must resolve a read operation unless it declares `resourceKind: "any"` (a method such as gws's `plan`, which dry-runs a change and writes nothing). A resolver's coded refusal reaches the caller with its own code and next step; `null` or an uncoded failure is `RESOURCE_UNRESOLVED` ([#22](https://github.com/we-the-rebel-alliance/source-contract/issues/22), `docs/tools-rpc.md`).

`read` refuses before any call when the grant is another consumer's, the source is off, the descriptor changed since consent or the scope is wider than granted; it then checks the answer's account, its `trust` marker, its size and, for a snapshot, its output. Grants are per consumer, source, account and scope. A cached answer serves only a consumer whose own grant covers the same source, account and scope, never another person or viewer.

## Versions

Semver. `sources.contractVersion` is the contract version; projects read the current and the previous one. Within a version the contract only grows.

The v0.3 rules ship as `0.3.0`, a minor release of the package, and leave `sources.contractVersion` at 1 ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §6). Order matters, as it did for `removals[]`: consumers re-vendor first, then plugins emit the new fields and declare the new files. Every v0.2 page and descriptor stays valid, and every v0.2 recorded fixture passes the kit unchanged. [The guide for plugin authors](adopting-v0.3.md) takes the adoption one step at a time.
