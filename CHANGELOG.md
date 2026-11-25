# Changelog

Releases are tagged GitHub releases, not npm: pin `github:we-the-rebel-alliance/plugin-contract#v<version>`. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/)
as it applies before 1.0: while `0.x`, a minor release may break, so plugins and apps pin exact tags and move together.

## Unreleased

The two kit fixes that passed review in #69. The v0.0.0 secret detector is unchanged; its redesign is #71.

- **`FORBIDDEN.main-branch`:** only a `main` link under the plugin's own GitHub owner is a finding, read from
  `package.json` `repository`. A third-party repository's `main` branch is legitimate, and a package with no repository
  has no owner to flag.
- **`plugin-kit release` outside a plugin:** it reads the package before the check and refuses a `package.json` with no
  `capabilities` with one `KIT_NOT_A_PLUGIN` error naming `scripts/release.mjs`; no conformance or check runs.

## 0.0.0 (2026-11-25)

The first release in `we-the-rebel-alliance`: the contract at wire version 1, greenfield, with no compatibility path to
`source-contract` v0.x.

- **The contract and the standard:** `docs/contract.md` and `docs/plugin-standard.md`, with the settled decisions in
  `docs/decisions.md` and the plugin list in `SUPPORTED.md`. `docs/index.md` lists every page;
  `docs/consumers.md` is the app's end-to-end guide (discover, read, subscribe, act, the app-UI grant flow, access
  levels and the error table).
- **`manifest`:** the `capabilities` schema at wire version 1, strict validation, lookups, canonical JSON and the
  `sha256:` hash, and `readInstalledManifest` from the installed package on disk.
- **`accounts`:** aliases and profiles, the `integration`, `mcp` and `local` mechanisms, per-alias registration and
  status, `account` resolution (`ACCOUNT_REQUIRED`, `ACCOUNT_UNKNOWN`) and redacted reasons.
- **`access`:** the `all`, `ask-changes` and `read-only` levels compiled to OpenCode permission rules, the per-agent
  transform and `unguardedAgents`, the `<server>_<tool>` rewrite, and the fenced session rules a grant compiles to.
- **`register`:** doors 1–3 from one handler table: agent tool, Code Mode and RPC, with strict input and output
  schemas, account resolution, permission assertions, plan/commit, and the RPC envelope that carries a grant and its
  consumer. A non-read method over RPC without an ask or a grant is refused (LD-5).
- **`act` on a plan:** a preview calls the action's `plans: true` method and answers the `planId` the register minted
  for it; the commit calls the action's `commits` method with exactly `{ planId }` and the host-signed action grant that
  `register` verifies, each phase in its own fence, so an app's write works against every plugin built on `register`.
- **Minted plan ids:** the register mints every `planId` from 128 random bits, keeps the plan handler's full answer for
  the commit's `call.plan`, and never reuses a live id; a handler that answers its own `planId` is `PLAN_INVALID`. A
  plan expires after 15 minutes and commits once: a second commit is `PLAN_USED`, a replayed grant `GRANT_INVALID`, and
  the commit fence denies every method outside the commit until it returns.
- **`events` and `cursor`:** the event and page model, `makeEvent`, `eventHash`, secret and instruction screening, page
  and fact checks, the one error table (`ERROR_CODES`, `SourceError`, `parseSourceError`), and the opaque cursor bound
  to plugin, source, account and scope with `foreign` and `malformed` refusals.
- **`bus`:** the typed `changed`, `status` and `account` nudges, `busEvents` for the one registration, the writer
  `register` builds for `registration.bus` and `call.bus`, and `readBusEvent` to decode a payload and refuse a secret.
- **`grant`:** the Ed25519 compact action grant, `signGrant` for the host and `verifyGrant` for `register`, with every
  binding, the canonical input digest, the confirmation rule, the single-use `GrantStore`, and the published
  `GRANT_CODES` that all map to `GRANT_INVALID`.
- **`outputs`:** the twelve snapshot shapes (`agenda`, `inbox`, `metric`, `list`, `progress`, `note`, `links`,
  `countdown`, `image`, `thread`, `table`, `record`), the extension output rule, and `checkOutput`.
- **`read`, `act`, `params` and `pick`:** fenced reads with cursors, detail reads and `probe`; preview then commit of the
  register-minted `{ planId }` under the host-signed action grant; relative times, windows and `$me`; and field
  selection checked against the output schema.
- **`catalog`:** installed manifests from the OpenCode 2.4.1 npm cache, including its generations, rejected siblings,
  Git keys and hosted Git URLs; a manifest read once, validated and hashed; the broker request keyed on `consumer`; and
  `sourceReader`, which asks a broker first and reads embedded otherwise. A registry target with no version and no own
  cache entry is reported, never bound to another entry for the package.
- **`hints`:** the generic hint file, its strict frontmatter, the forbidden consumer decisions and `hintProblems`.
- **`schemas`:** every published JSON Schema by name, generated from the zod source of truth and bundled at the release.
- **The conformance kit (`conformance`):** T0 (namespace and skill budgets, tool references, pin evidence, generated
  docs), T1 (the plugin loads on 2.4.1, its doors and permissions hold, LD-5's RPC refusal, a clean `HOST_UNTESTED` for
  an unsupported host), the declaration and its classes, two-account recordings, events, status, actions, and the #40
  grant cases including the four refusals.
- **`kit`:** `plugin-kit` with `check`, `docs`, `record`, `conformance`, `hosts`, `release`, `supported` and
  `forbidden`; fixture redaction; the release guards; and the shared OpenCode 2.4 host harness.
- **The examples** under `examples/`: `integration` (accounts through the integration mechanism, with a fake provider),
  `mcp` (two aliases, `accounts.real: true`), and `tools` (methods only). Each is an installed package as an app finds
  it on disk, with a manifest, a server entry, a skill, generated docs and a recorded fixture, run through the kit by
  `npm run conformance:self-test`. All three call `assertHost`, build their `status` answer with `statusAnswer` and the
  call's own `unguardedAgents()`, reuse the exported output schemas, and take their bus from `register` in one step.
- **Ergonomics at setup:** `manifest` exports `hostInRange`; `register` exports `assertHost`, so a plugin refuses an
  untested release with `HOST_UNTESTED` in one call; `register` always builds the bus writer from its one RPC
  registration and gives it to every handler call as `call.bus` and to the plugin as `registration.bus`, with no flag,
  no optional writer and no second registration; `accounts` exports `STATUS_SCHEMA` and `statusAnswer`, which builds the
  whole `status` answer from the manifest, the installed and host versions, the account states, the problems and
  `call.unguardedAgents()`, so a status handler keeps no state between `register` and the call; `events` exports
  `PAGE_SCHEMA`, `PROBE_SCHEMA` and `LIST_OPTIONS_SCHEMA`, so a plugin reuses the answer shapes instead of copying them.
- **The pre-tag API freeze:** the writer is the only way to emit — `register` does not return the RPC events emitter, so
  `registration.bus` and `call.bus` are the only writers, and every emit passes the schema and secret checks. A handler
  call carries no access registration: nothing on `call` can change or dispose the rules. `call.unguardedAgents()`
  answers `{ ok: true, agents }` or `{ ok: false, error }` instead of throwing, and `statusAnswer` takes that answer
  and reports a failure as a problem. The examples build every page with `eventsListResult`, `parseEventsListInput`
  and `fitPage`, and every probe with `probeResult`. `events` exports an explicit list, and `cut`, `PAGE` and `PROBE`
  are internal.
- **Plan safety:** the register copies each recorded plan with `structuredClone`, so nothing the handler or the public
  answer holds can change `call.plan` later, and refuses a plan over `PLAN_MAX_BYTES` (64 KB of JSON) or one a copy
  cannot carry with `PLAN_INVALID`.
- **Cancellation:** a cancelled call rejects the permission ask it opened (found by its source id), so a stale request
  does not stay on the person's screen, and still answers the contract's cancellation refusal. Every RPC ask carries
  the call's id as its source, fresh or not, so aborting an RPC read that asked rejects its ask too.
- **`forbidden`:** a conformance fixture's signed grant claims are decoded and screened, so a secret inside a signed
  claim is `FORBIDDEN.secret`; a verified grant case with an address outside `example.test` and `example.com` is
  `FORBIDDEN.grant-email`.
- **Conformance:** T1 proves on the real 2.4.1 host that a grant for one account alias allows that alias's MCP tool and
  that another alias's tool is denied with exactly `PERMISSION_DENIED` (`T1.grant-alias`), using the mcp example's two
  aliases and a real session fence. Each assert is bounded to 1.5 s, so a compiled rule that asks becomes a `TIMEOUT`
  finding instead of hanging the kit, and `HostRun.assert` answers a contract code rather than throwing;
  `grantAliasFindings` is exported and a stub-host test proves a leaky allow, an unanswered ask, a deny on the granted
  alias's own tool and another deny code all fail.
- **The docs check:** `test/docs.test.ts` compares every module page's `## Exports` table with the module's real export
  declarations, both directions, and fails if a name is missing or does not exist.
