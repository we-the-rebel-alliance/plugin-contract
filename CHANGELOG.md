# Changelog

Releases are tagged GitHub Releases, not npm: pin `github:we-the-rebel-alliance/source-contract#v<version>`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) as it applies before 1.0: a minor version may carry what an older consumer refuses. Every change names its pull request.

## [0.3.0] - 2026-11-18

The v0.3 proposal ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45), [#46](https://github.com/we-the-rebel-alliance/source-contract/pull/46)): what an actor is and which ids it has across sources, who an item was for and where it sits, the facts a source already holds in code, and the hint and routine file formats. `contractVersion` stays 1, no error code, method or cursor format changes, and every v0.2 page and descriptor stays valid.

### Upgrading from 0.2.x

- **Consumers (Memory, jelly) re-vendor first.** A consumer on 0.2.x refuses a page that carries any of the new fields, a descriptor that declares `facts`, `hints` or `routines`, and a fact of a new type, because its schemas are strict: a page is `SCHEMA_VIOLATION`. Pin `#v0.3.0`, check the new `SHA256SUMS`, and run your own checks before any plugin sends a new key.
- **Plugins send a new field or declare a file only after both consumers are on 0.3.0.** [The guide for plugin authors](docs/adopting-v0.3.md) takes it one step at a time.
- **The conformance report has six more checks**: `hints`, `routines`, `actor-kind`, `facts`, `commitment-key` and `parts-stable`. Each is not applicable unless the source carries what it checks, so a v0.2 plugin's report stays ok; a plugin that lists checks by name sees them. A source that declares hints or routines passes `files` to the kit, and a declared file the kit cannot read fails, so nothing passes by leaving a file unread.
- **A v0.2 event hashes as it did.** A new field joins the hash only when it is present, so no recorded page changes and no consumer re-reads history.
- **TypeScript only: `EventActor` gains `kind`, `identities` and `self`, and `SourceEvents` gains `facts`, `hints` and `routines`.** Optional throughout, so code that builds an actor or reads an item is unchanged.
- **`makeEvent` normalises the new metadata**: a reply on one line and cut to 512 characters, domains lowercased and de-duplicated, sections and parts cut to their own limits, and an actor's `kind`, identities and facts kept as the plugin gave them for `eventProblems` to judge.

### Added

- Actor metadata on a page ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45), [#46](https://github.com/we-the-rebel-alliance/source-contract/pull/46) §1): `kind` (`person`, `agent`, `bot` or `service`), up to 10 `identities` of `{ id, strength, basis }` with `strength` `strong` or `weak`, and `self` as a hint. `ACTOR_KINDS`, `ACTOR_ROLES`, `AUTHOR_ROLES`, `IDENTITY_STRENGTHS` and `EventIdentity`; an unknown role is read as involved, and a page that lists several `from` actors stays valid, with the first read as the author.
- Event metadata ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45), [#46](https://github.com/we-the-rebel-alliance/source-contract/pull/46) §2): `reply_to` (at most 512 characters), `audience` (`dm`, `group`, `channel`, `email` or `public`), `domains` (at most 20 lowercase), `sections` (at most 20 `{ heading, text }`, each text with its own 4,096 characters) and `parts` (at most 50 `{ id, text, actor? }`, whose ids and texts never change once listed). `AUDIENCES`, `EventSection`, `EventPart`.
- `facts[]` on an event ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45), [#46](https://github.com/we-the-rebel-alliance/source-contract/pull/46) §3): up to 20 typed facts of `commitment`, `person.attribute` or `meeting.attended`, each a closed schema (`additionalProperties: false`), every actor reference an actor on the same event. `FACT_TYPES`, `COMMITMENT_STATES`, `ATTENDANCE_RESPONSES`, `EventFact`, `factProblems`, and `FACT_SCHEMAS` with `dist/schemas/fact.commitment.json`, `fact.person.attribute.json` and `fact.meeting.attended.json`.
- The descriptor's `facts`, `hints` and `routines` ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45), [#46](https://github.com/we-the-rebel-alliance/source-contract/pull/46) §3, §4, §5): a fact type declared by name on an events source only, and relative `.md` paths into the package, each declared once.
- The `hints` module: the hint and routine file formats, `HINT_MAX` (1,500 characters), `ROUTINE_BODY_MAX` (4,000), the forbidden keys, `PRODUCES_TYPES` (the seven knowledge types a file helps Memory find: `commitment`, `decision`, `fact`, `preference`, `constraint`, `person` and `project`, which are not the structured fact types of `facts[]`), `parseFrontmatter`, `hintProblems` and `routineProblems`, and the frontmatter schemas `dist/schemas/hint.json` and `routine.json`.
- The kit's `hints` and `routines` checks, with the `files` and `ownSources` options ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45), [#46](https://github.com/we-the-rebel-alliance/source-contract/pull/46) §8): a file over its size, with a forbidden or unknown key, or naming another plugin's source, fails.
- The kit's `event-within-max-bytes` check: a recorded event whose own JSON is over the source's `maxBytes` fails, since a page always carries at least one event and a consumer would refuse it as `TOO_LARGE`. Its message names the event, the bytes and how to make it fit, and the contract and the guide say how: a growing item lists only its new parts, and long notes are split, or cut by section.
- The kit's `one-author` check (`one-author`): an event that lists more than one `from` or `author` actor is flagged for a plugin adopting v0.3, since a consumer reads the first as the author and an older page may validly list several.
- The kit's `actor-kind` check and its `machineActors` option ([#46](https://github.com/we-the-rebel-alliance/source-contract/pull/46)): an actor the fixture names as an agent, a bot or a service carries a machine kind on every page that lists it.
- The kit's `facts` check ([#46](https://github.com/we-the-rebel-alliance/source-contract/pull/46)): every fact type a page carries is declared by the descriptor.
- The kit's `commitment-key` and `parts-stable` checks ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45), [#46](https://github.com/we-the-rebel-alliance/source-contract/pull/46) §8): a key names one title and owner, an item keeps one key, and a re-listed part keeps its text.
- [The guide for plugin authors](docs/adopting-v0.3.md) ([#46](https://github.com/we-the-rebel-alliance/source-contract/pull/46)): adopting v0.3 one step at a time.

### Changed

- `eventHash` covers a new field only when it is present ([#46](https://github.com/we-the-rebel-alliance/source-contract/pull/46)), with the field's object keys sorted, so an event without the new fields hashes exactly as in v0.2 and the order a plugin builds a field in does not change its hash ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45), [#46](https://github.com/we-the-rebel-alliance/source-contract/pull/46) §6).
- `declarationProblems` refuses a fact type, a hint file or a routine file declared twice ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45), [#46](https://github.com/we-the-rebel-alliance/source-contract/pull/46) §3, §4, §5).

## [0.2.0] - 2026-11-17

The Wave 1 and Wave 4 adoption feedback ([#30](https://github.com/we-the-rebel-alliance/source-contract/issues/30)), plus [#22](https://github.com/we-the-rebel-alliance/source-contract/issues/22), [#27](https://github.com/we-the-rebel-alliance/source-contract/issues/27) and [#28](https://github.com/we-the-rebel-alliance/source-contract/issues/28). `contractVersion` stays 1, and no error code, method or cursor format changes.

### Upgrading from 0.1.x

- **Consumers (Memory, jelly) re-vendor first.** A consumer on 0.1.x refuses the new keys, because its schemas and owner checks are strict: a page that carries `removals[]` (`SCHEMA_VIOLATION`), an owner that carries `verified`, and a descriptor that declares `permission.identityRules`, `accounts.server` or `permission.readsIdentity`, a price with `conditions` or `min`, or an empty `permission.identity`. Pin `#v0.2.0`, check the new `SHA256SUMS`, and run your own checks before any plugin sends a new key.
- **Plugins declare or send a new key only after both consumers are on 0.2.0.** The keys are `removals[]`, `owner.verified: false`, `permission.identityRules`, `accounts.server`, `permission.readsIdentity`, a price's `conditions` and `min`, and `permission.identity: []`. A plugin that sends one sooner is refused by a consumer still on 0.1.x.
- **A probe's `owner.id` must be scheme-qualified** (`mailto:`, `slack:`, `os-user:`) ([#29](https://github.com/we-the-rebel-alliance/source-contract/pull/29)). `read.probe` and the kit now refuse a bare id. Every example, fixture and recorded plugin owner already complies.
- **A `rules` source is now checked like any other item** by `declarationProblems` ([#37](https://github.com/we-the-rebel-alliance/source-contract/pull/37)). A rules-only declaration with a real defect (a foreign `x-` namespace, a bad URL host, a write-verb tool) that passed on 0.1.x now fails. `examples/github` passes.
- **TypeScript only: `descriptor`'s `SourceItem` is now the schema's union** ([#39](https://github.com/we-the-rebel-alliance/source-contract/pull/39)). Code that read an events-only or snapshot-only field (`output`, `reads`, `params`) without narrowing on `kind`, or that relied on the old index signature, needs a narrowing or a cast. Nothing changes at run time.
- **The conformance report has two more checks,** `gap-once-per-read` ([#35](https://github.com/we-the-rebel-alliance/source-contract/pull/35)) and `removals-are-final` ([#36](https://github.com/we-the-rebel-alliance/source-contract/pull/36)). Each is not applicable unless an answer carries `gap` or `removals[]`. A plugin whose report lists checks by name sees them.

### Added

- `permission.identity` may be empty: the probe then asserts only `sources.probe.action`; absent still means undeclared ([#31](https://github.com/we-the-rebel-alliance/source-contract/pull/31), #30 item 1).
- `permission.readsIdentity: true` lets a source's content reads assert an identity operation, for that source only; every identity operation must still be among `permission.operations` ([#32](https://github.com/we-the-rebel-alliance/source-contract/pull/32), #30 item 4).
- The kit's `noExpiry: { reason }` reports `gap-and-cursor-expired` as not applicable for a source whose cursors never expire, as `atomicPages` does ([#33](https://github.com/we-the-rebel-alliance/source-contract/pull/33), #30 item 5).
- A price may carry `conditions` (the sentence shown at consent) and `min` (the lowest rate that may apply) ([#33](https://github.com/we-the-rebel-alliance/source-contract/pull/33), #30 item 6).
- `tools-rpc`: `resourceKind: "any"` lets a read method's resolver name a change's operation, still fenced on that exact operation; a resolver's coded refusal reaches the caller with its own code and next step ([#34](https://github.com/we-the-rebel-alliance/source-contract/pull/34), #22).
- The rule that a gap is answered once per read, and the kit's `gap-once-per-read` check; gws Calendar's fixture gains a paged gap read ([#35](https://github.com/we-the-rebel-alliance/source-contract/pull/35), #28).
- `removals[]` on an events page (`REMOVAL_REASONS`, `EventsRemoval`, `removalProblems`), so a consumer can retract what it derived, and the kit's `removals-are-final` check ([#36](https://github.com/we-the-rebel-alliance/source-contract/pull/36), #27).
- `permission.identityRules: [{ action, resource }]`, a rules source's probe grants, each among its `rules`; `permission.probeRules` and `read.probe` honour it ([#37](https://github.com/we-the-rebel-alliance/source-contract/pull/37), #30 item 10).
- `accounts.server` (such as `plaud-{account}`) for a plugin with one MCP server per account; `permission` exports `serverOf`, `DEFAULT_ACCOUNT` and `SERVER_ACCOUNT_PATTERN` ([#38](https://github.com/we-the-rebel-alliance/source-contract/pull/38), #30 item 9).
- An owner may carry `verified: false` when the provider does not confirm who it is, on a page and on a probe answer ([#41](https://github.com/we-the-rebel-alliance/source-contract/pull/41), #30 item 13).

### Changed

- `ACCOUNT_UNKNOWN` is an alias of `ACCOUNT_MISMATCH`, so `read` no longer reports it as `UNAVAILABLE`; a probe's `owner.id` must be scheme-qualified ([#29](https://github.com/we-the-rebel-alliance/source-contract/pull/29)).
- `descriptor` exports one `SourceItem`, the schema's type, so an item read from disk goes to `acceptAnswer` and the kit without a re-parse ([#39](https://github.com/we-the-rebel-alliance/source-contract/pull/39), #30 item 8).

### Fixed

- The kit's expired-cursor restarts keep the case's input, so a plugin with several sources is restarted for the right one ([#31](https://github.com/we-the-rebel-alliance/source-contract/pull/31), #30 item 3).
- The kit's page-size check uses the source's `maxBytes` and the read's `limit`, as `read.acceptAnswer` does ([#32](https://github.com/we-the-rebel-alliance/source-contract/pull/32), #30 item 2).
- `declarationProblems` runs every per-item rule on a `rules` source ([#37](https://github.com/we-the-rebel-alliance/source-contract/pull/37), #30 item 11).

## [0.1.0] - 2026-11-14

The first Release: the data model, the descriptor, the protocol, the library and the conformance kit (Wave 0).

[0.3.0]: https://github.com/we-the-rebel-alliance/source-contract/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/we-the-rebel-alliance/source-contract/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/we-the-rebel-alliance/source-contract/releases/tag/v0.1.0
