# Conformance

A plugin proves it keeps the contract by running the conformance kit in its own CI and attaching the report to each Release. A project's catalogue lists a source plugin only with a passing report for its pinned version.

The kit is the `conformance` module, contributed by Memory (#13), with the family's `eventsListConformance` in `events` (#7). It ships with every Release as one file, `source-contract-conformance-<version>.mjs`, which needs nothing installed.

## What it checks

The draft's ten checks, and Memory's additions:

| # | Check | Where |
|---|---|---|
| 1 | The descriptor validates, and every tool a source names is a read. | `descriptor` (the frame), then Memory's `schema` |
| 2 | **Declared equals asserted.** A recording permission context runs the fixtures and records every action and resource the code asserts: an assertion outside the declaration fails, and a declared grant no call asserts fails as over-granting. | Memory's `conformance` |
| 3 | Events: a stable `external_id`, the library's `hash`, a parseable `occurred_at`, an https `url`, and no secret pattern survives. | the family's `events` |
| 4 | Cursors round-trip with no repeat or gap of events (no event is listed twice or skipped); a foreign cursor is refused; an expired one answers `CURSOR_EXPIRED` with `gap`; `failed[]` holds the cursor back. The `gap` field's own rule is `gap-once-per-read`: a read answers its gap once, on the page where the source restarts, and the page its cursor names carries none ([#28](https://github.com/we-the-rebel-alliance/source-contract/issues/28)). It applies whenever an answer carries `gap`, and a gap page with `more: true` needs that next page recorded. | the family's `cursor`, Memory's additions |
| 5 | Another account is refused. | `read` (`ACCOUNT_MISMATCH`), the kit |
| 6 | `probe` reads no content, asserts only its own grant, and answers `{ source, account, owner: { id, label }, trust }` (never `owner: null`). | Memory's `conformance` |
| 7 | A snapshot's `data` validates against its output. | `registry`, `read` |
| 8 | Paging honours `more`; the answer stays within the source's `maxBytes` and the read's limit, and `TOO_LARGE` is used rather than truncation. | the kit, `read` |
| 9 | Calls stay within the declared cost. | the kit |
| 10 | Every result is marked `trust: "untrusted"`. | `read`, the kit |
| + | **The verb rule.** Names are tokenised (snake, kebab, dot, camelCase); an unambiguous write verb anywhere is refused; a compound (`get_and_send`, `getAndSend`) is refused; a noun-verb in a verb's position with an object after it is a write (`slack_post_message`), while `get_issue` and a single-token `drive.files.export` are reads; an operation's last segment carries no write verb and a noun may lead it (`x.users.mentions`). | Memory's `conformance` |
| + | `details` are called inside the confirmed scope, and an event outside it must be refused with `PERMISSION_DENIED: … Next step: …`. | `read` (`detailFields`), Memory's `conformance` |
| + | **Refused is final**, and the secret screening is proven from a fixture: an event whose `title` or `text` holds a secret (`secretKinds`) fails, and it belongs in `refused[]` with `reason: "secret"`. | the family's `events`, Memory's `conformance` |
| + | **Removals are final** (`removals-are-final`, [#27](https://github.com/we-the-rebel-alliance/source-contract/issues/27)): whenever an answer carries `removals[]`, each entry is `{ external_id, at, reason }`, no id repeats or is also in `failed[]`, and no `at` is later than the page's `asOf`. It is not one of the features every events source must exercise: a source that never removes anything has nothing to record, so the check is not applicable to it. | the family's `events` (`removalProblems`), the kit |
| + | `urlHosts` are exact hosts or `*.` with a registrable domain: no public suffix, shared hosting or punycode. | Memory's `schema`, `conformance` |
| + | **An actor says what it is** (`actor-kind`, [#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §1, §8). `kind` is `person`, `agent`, `bot` or `service`, and every actor the fixture names in `machineActors` carries a machine kind on every page that lists it. The kit cannot tell a person from a bot itself, so the fixture says; without it the check does not apply. The shape rules go with the page: `kind` is one of the four, and an identity is scheme-qualified, unique within its actor, never the actor's own id, and carries `strength` and `basis`; those are `page-result`'s, since they are the page's shape. | the family's `events` (`eventProblems`), the kit |
| + | **One author** (`one-author`, [#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §1, §8): an event that lists more than one `from` or `author` actor is flagged for a plugin adopting v0.3. It is an authoring-time check, not a page rule: a page may validly list several (a `From` header carries several addresses, and gws lists one `from` actor for each), and a consumer reads the first `from`, or else the first `author`. It applies when a page lists an author, and a page with none says nothing about authorship. | the kit |
| + | **A fact's type is declared** (`facts`, [#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §3, §8): every fact a page carries is a type the descriptor's `facts` declares. The rest of a fact is `page-result`'s, since it is the page's shape: the closed schema (so a `version` or a sensitive field fails), the enum values, and every actor reference naming an actor on the same event. It applies when a page carries a fact; a source that declares a type and sends none has nothing to check. | the family's `events` (`factProblems`), the kit |
| + | **A commitment keeps one key** (`commitment-key`, [#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §3, §8): a key names one title and owner across the run, and an event that lists one commitment (one title and owner) under two keys fails, so a key built from a counter or a timestamp is caught. It applies when a page carries a commitment. | the kit |
| + | **A part keeps its text** (`parts-stable`, [#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §2, §8): a part listed again, on a later page of the same event, carries the same text and actor. A re-listed item may list only its new parts, so a shorter list is fine. It applies when a page carries parts. | the kit |
| + | **A hint and a routine are files of the plugin's own** (`hints`, `routines`, [#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §4, §5, §8): each declared path is read (`files`), and a file over its size, with a forbidden or unknown key, with no frontmatter or a malformed one, or naming a source the plugin does not own, fails. The hint is at most 1,500 characters, and a routine's body at most 4,000. `produces` names one of the seven knowledge types Memory's core extractor finds (`commitment`, `decision`, `fact`, `preference`, `constraint`, `person`, `project`), not a structured fact type; Memory ignores one the person has not consented to. Each applies when the source declares one. | the `hints` module (`hintProblems`, `routineProblems`), the kit |

## Running it

The kit is a library: a plugin calls it from its own tests, with its own fixtures, and fails its check on any problem.

```js
import { assertDeclaration, assertConformance } from "@we-the-rebel-alliance/source-contract/conformance"
// or, without installing the package: import { … } from "./source-contract-conformance-<version>.mjs"
```

`assertDeclaration` checks the `sources` key (the schema, then the rules a schema cannot express). `assertConformance` runs each source through the checks above, with a fixture that answers each call. The recording permission context refuses any action the declaration does not hold, and reports any grant nothing asserted. `examples/*/fixtures/conformance.json` shows the fixture format, and `scripts/examples.ts` replays one.

Every check that applies must run: a source that never exercises `failed[]`, `gap`, `refused[]` or `details` has an
*incomplete* report, which is not ok.

## A source that ships hints or routines

A source that declares `hints` or `routines` is checked against the files themselves, so the kit is given a reader for
the plugin's own package:

```js
await sourceConformance({ ...options, files: (path) => readFileSync(join(here, path), "utf8"), ownSources: ["granola.meetings", "granola.notes"] })
```

`files` returns the file's text, or `undefined` when the package holds no such file, and `ownSources` is every source id
the plugin declares, for the own-source rule (it defaults to the source under test). A declared file that the kit cannot
read fails `hints` or `routines`, so a report never passes by leaving a file unread. The formats, the sizes and the
forbidden keys are the `hints` module's ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §4,
§5), and a plugin may call `hintProblems` and `routineProblems` in its own tests as well.

## A fixture whose actors are machines

The kit cannot tell a person from an agent, a bot or a service, so a fixture says which actor ids are machines:

```js
await sourceConformance({ ...options, machineActors: ["slack:B0PILOT01"] })
```

Every actor the fixture names there must carry a `kind` of `agent`, `bot` or `service` on every page that lists it, and
an id no page lists fails, so a fixture cannot pass by naming nothing that appears. Without `machineActors` the
`actor-kind` check does not apply ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45) §1).

## The v0.3 additions to a page

The actor metadata (`kind`, `identities`, `self`), the event metadata (`reply_to`, `audience`, `domains`, `sections`,
`parts`) and `facts[]` are checked by `page-result`, which is the same `eventProblems` that `read` runs, so a shape rule
holds whoever reads the page. The `commitment-key` and `parts-stable` checks hold a value across the pages of one run,
which no single page can. Every one of them is optional: a v0.2 page passes unchanged, and the nine recorded fixtures
do.

## A source that states its rules verbatim

A source whose provider resources are not `<account>:<operation>` states `permission.rules` (GitHub's `github_api` on
`GET /user`). Every per-item rule runs on it as on an `operations` source: the namespace of `reads`, `urlHosts`,
tool verbs and uniqueness ([#30](https://github.com/we-the-rebel-alliance/source-contract/issues/30) item 11). Its probe's
grants are `permission.identityRules`, each among its `rules`; with `sources.probe.action` declared, the probe must
assert exactly that action and those rules, and a content read that asserts one needs `permission.readsIdentity`
(item 10). `examples/github` illustrates the shape: its probe asserts `github.probe` and `github_api` on `GET /user`, and its events read asserts `GET /user` too, hence `readsIdentity`. The shipped GitHub plugin uses `github_probe`, and would declare `identityRules: [{ "action": "github_probe", "resource": "GET /user" }]` with that rule among its `rules`; its events read does not assert `GET /user`, so it needs no `readsIdentity`.

## A page that cannot fail one item

A page fetched in one provider call cannot produce `failed[]`: Calendar's `events.list` answers the whole page at once,
so no single item can fail on its own. Such a source says so:

```js
await sourceConformance({ ...options, atomicPages: { reason: "events.list answers the page in one call" } })
```

`failed-holds-cursor` is then not applicable, the reason is shown in the report's check, and the report can be ok. An
empty reason is no reason: the check applies, and the report is incomplete.

## A source whose cursors never expire

A source whose ids never expire cannot produce an expired cursor, so it cannot exercise `gap-and-cursor-expired`. Such a
source says so:

```js
await sourceConformance({ ...options, noExpiry: { reason: "X's ids never expire" } })
```

`gap-and-cursor-expired` is then not applicable, the reason is shown in the report's check, and the report can be ok. An
empty reason is no reason: the check applies, and the report is incomplete ([#30](https://github.com/we-the-rebel-alliance/source-contract/issues/30) item 5).

## A content read that reads the signed-in identity

A feed sometimes needs the signed-in user's own id: X reads mentions and the home timeline with it. Such a source declares `permission.readsIdentity: true`, and the kit allows its content reads to assert an identity operation. Every identity operation is still declared in `permission.operations`, so the declaration stays exact ([#30](https://github.com/we-the-rebel-alliance/source-contract/issues/30) item 4).


## Restarting an expired cursor

When a source answers `CURSOR_EXPIRED` or a `gap` with reason `expired`, the kit restarts the listing with the cursor
or `since` hint the source gave, and keeps the source's own `input`: `{ ...input, cursor }` or `{ ...input, since }`. A
plugin with several sources is therefore restarted for the same source, not its default ([#30](https://github.com/we-the-rebel-alliance/source-contract/issues/30) item 3).


## Proving the secret screening

`refused-is-final` is mandatory for every events source, because the contract screens every result for secrets. A
plugin proves it with a fixture that carries a secret-shaped event the source refuses:

```json
"refused": [{ "external_id": "18f00000000000aa", "reason": "secret", "detail": "api key" }]
```

The kit runs the family's `secretKinds` over every page's `title` and `text`: an event that holds a secret fails the
check, so a fixture that merely declares the screening cannot pass. `refused[]`'s `reason` is one of `instruction`,
`secret` and `owner`, and `failed[]`'s is an error `code`, both as `events` defines them.

## In this repository

`npm run conformance:self-test` runs on every pull request. It reads each plugin under `examples/` twice on purpose:
once as a consumer finds it on disk (`readInstalledDescriptor` from `dist/`, which hashes it), and once through the kit.
Every recorded page is validated by the family's `events` module (`resultProblems`), so the examples keep the event and
page shape the authority defines. The examples are gws Gmail, gws Calendar and Slack, with Memory's sanitised fixtures.
