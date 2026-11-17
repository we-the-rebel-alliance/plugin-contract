# Changelog

Releases are tagged GitHub Releases, not npm: pin `github:we-the-rebel-alliance/source-contract#v<version>`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) as it applies before 1.0: a minor version may carry what an older consumer refuses. Every change names its pull request.

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

[0.2.0]: https://github.com/we-the-rebel-alliance/source-contract/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/we-the-rebel-alliance/source-contract/releases/tag/v0.1.0
