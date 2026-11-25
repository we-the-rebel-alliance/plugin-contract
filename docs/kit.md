# The kit: `plugin-kit`

`plugin-kit` is the binary every plugin's development and CI runs. It lives in `plugin-contract` as
`@we-the-rebel-alliance/plugin-contract/kit`, a `bin` entry and a dev export: a plugin adds the package as a
`devDependency` and never bundles the kit into its own `dist/`.

The kit calls the conformance module for every conformance check (`runConformance`, `t0`, `t1` in
`src/conformance.ts`). It does not re-implement a check or keep a second copy of a rule. Its own work is what is about a
repository rather than a plugin's runtime: generated documentation, the forbidden patterns, fixture redaction, the
release guards and the host harness.

```sh
npx plugin-kit <command> [options]
```

Every command runs from the plugin's root directory, or with `--dir <path>`. `--json` prints one JSON object and moves
the report off stdout; a `KitError` is then `{ "ok": false, "error": { "code", "message", "next" } }` on stdout. A
command exits `0` when it passes, `1` when a finding is an error, and `2` for a usage mistake.

## Commands

| Command | What it does | Options |
|---|---|---|
| `check` | everything a pull request needs: the conformance report (T0/T1, accounts, grants, events, unsupported host), the doc file set, forbidden patterns, no bundled kit | `--host <release>` (repeatable), `--json` |
| `docs` | writes each conformance-rendered section between its generated block | `--check`, `--json` |
| `record` | runs the conformance record pass, then redacts `fixtures/conformance.json` | `--account <alias>`, `--check`, `--json` |
| `conformance` | the whole conformance report | `--host <release>`, `--record`, `--json` |
| `hosts` | the OpenCode release matrix: `[2.4.1]` | `--json` |
| `release <version>` | checks, then a local 0.0.x tag; CI publishes the GitHub release | `--dry-run`, `--json` |
| `supported` | this plugin's row for `SUPPORTED.md` | `--wave <name>`, `--status <state>`, `--json` |
| `forbidden` | app identifiers, `main`-branch links, secrets and real emails in verified grant cases | `--json` |

`check` does not typecheck, build or run the plugin's unit tests: those are the plugin's own commands, and its CI runs
them beside the kit. T0 and T1 are hard gates (plugin standard §0.2 rule 8); a conformance call that throws becomes a
`KIT_CONFORMANCE` error, never a skipped gate. It also fails `KIT_BUNDLED` when the plugin's runtime entry or its `dist/`
contains the kit: the kit is a devDependency, never part of a plugin's server build.

### `check` and `conformance`

`check` makes one `runConformance(pluginDir, { hosts? })` call. It covers T0, the declaration and options, the recorded
sources and accounts, the bus and status, actions, grants, the RPC confirmation, T1 on every release in
`capabilities.plugin.host.tested`, and the first unsupported host's clean `HOST_UNTESTED` refusal. `--host` replaces the
tested list. `conformance` prints the same report with `--host` and `--record` passed through. The kit adds only the
required doc-file set, the forbidden scan and `KIT_BUNDLED` around it.

The finding ids are the conformance module's, such as `T0.namespace-length` and `T1.host`. The kit's own ids are stable
and start with `KIT.`, `DOCS.`, `FORBIDDEN.` or `RECORD.`.

### `docs`

The sections and their files are the conformance module's (`src/internal/conformance/docs.ts`): `capabilities` and
`errors` in `README.md`, `capabilities` in `docs/capabilities.md`, `configuration` in `docs/configuration.md`,
`accounts` in `docs/accounts.md`, and `automations` in `docs/automations.md`. `plugin-kit docs` calls
`renderGeneratedDocs(manifest)` from `src/conformance.ts`; it never renders a section itself.

A section sits between its generated markers, and the text outside them is hand-written:

```md
<!-- generated:capabilities -->
…the table…
<!-- /generated:capabilities -->
```

`plugin-kit docs` replaces what is between a pair. `plugin-kit docs --check` reports drift with conformance's
`T0.docs-<section>` findings, a missing pair with the same id, and a missing file with `DOCS.missing-file`;
`plugin-kit check` gets the drift findings from `runConformance` and adds only the missing-file check. Generated text is
deterministic: the same manifest makes the same bytes, so edit the manifest, never the section.

### `record`

`record` runs `runConformance(pluginDir, { record: true })`, then reads the plugin's one fixture at
`fixtures/conformance.json` (`readFixture`'s location), redacts it, and writes it back. `--account <alias>` must name
an alias in the fixture's `accounts.aliases`; an unknown alias is a `KIT_ACCOUNT_UNKNOWN` refusal, never a fallback to
another file.

Redaction replaces:

- a credential: a string the contract's `secretKinds` recognises, or a value under a key such as `token`, `secret`,
  `password`, `api_key`, `authorization`, `cookie` or `credential`, with `<redacted:secret>`;
- an E.164 phone number (a leading `+` and 8–15 digits) with `<redacted:phone>`; a timestamp or a plain account id is
  not a phone number, an email address becomes `<redacted:email>`, and a home directory `<redacted:home>`;
- a value under `email`, `phone`, `mobile`, `username`, `login`, `name`, `first_name`, `display_name`, `real_name` or
  `full_name` with `<redacted:personal>`;
- a sensitive URL query value (`token`, `key`, `signature`, `password`, `email`, `code`) with `<redacted>`.

A conformance fixture's `grants.publicKey` and a whole grant case whose `token` that key verifies are signed test data; `record` leaves the case unchanged, and redacts an unverified case and every other grant field. An event whose recorded hash was already wrong is `RECORD.hash-mismatch`; redaction does not repair an unchanged event, and a redacted event is rehashed after the finding. The pass is deterministic
and idempotent: keys keep their order, a placeholder carries no pattern, and a second run changes nothing. `record --check` records nothing and fails (`RECORD.unredacted`) when a committed fixture still needs a
redaction, so CI can run it on every pull request.

### `forbidden`

The scan reads text files outside `node_modules`, `dist` and the other generated directories, and never a lockfile:

| Id | What it finds |
|---|---|
| `FORBIDDEN.app-name` | an app identifier in code, manifest or docs. An `x-<app>` key is allowed: the prefix is the one place a name belongs. |
| `FORBIDDEN.main-branch` | a GitHub `blob/main`, `tree/main`, `raw/main` or `raw.githubusercontent.com/…/main` link under the plugin's own owner, read from its `package.json` `repository`. Every repository in the org uses `master`; a third-party repository's `main` branch is legitimate, and a package with no repository has no owner to flag. |
| `FORBIDDEN.secret` | a credential the contract's own detector (`secretKinds`) recognises. A conformance fixture's `grants.publicKey` and a `grants.cases[].token` that key verifies are public test data, not credentials, and are not reported. The token's payload is still decoded and screened: a secret inside a signed claim is reported, because the signature makes the claim authentic, not secret. |
| `FORBIDDEN.grant-email` | a real person's email in a verified grant case (`expect.ok: true`). The decoded claims, its plain `input` and its plain `request` are scanned; an address must be on `example.test` or `example.com`. The finding names the case, never the address or its domain. |

The app list is `src/kit/forbidden-apps.ts`, the kit's one denylist. It targets the app's own identifiers and
repository prefixes, not ordinary words that happen to be product names.

A real site that must name an app is allowed in `.plugin-kit/forbidden-allow`, one `<path>:<pattern-id> <reason>` per
line, such as `docs/quote.md:app-name This page documents the product itself.` The pattern id is the finding id without
`FORBIDDEN.`, so a fixture that must name a real address uses `grant-email`. A used allowance removes that finding and is
reported as a `FORBIDDEN.suppressed` warning with its reason; a line with no reason is not an allowance. A
`FORBIDDEN.secret` that names the line holding the credential is never allowable; only a whole-file or decoded
signed-claim secret finding can be suppressed.

### `release`

`release <version>` releases only the `0.0.x` line (contract §17). It:

1. reads `package.json` first: a package with no `capabilities` is not a plugin, so it refuses with `KIT_NOT_A_PLUGIN` and
   names `scripts/release.mjs`, the script this contract itself releases through; otherwise it runs `check`, and writes
   nothing when an error is found;
2. requires the release to be prepared, not prepares it: `package.json` must already say the version, and `CHANGELOG.md`
   must already carry its `## [<version>]` section;
3. refuses unless the branch is `master`, `git status --porcelain` is empty, and `HEAD` equals `origin/master` after a
   fetch;
4. creates the annotated tag `v<version>` locally.

It never edits a release file, pushes or publishes. Pushing the tag is the owner's step; CI publishes the GitHub release
on that tag (plugin standard §9). `--dry-run` runs the checks and guards and prints the plan without writing a tag. The
command refuses a tag that already exists instead of moving it.

`supported` prints one row for the data-source table in `SUPPORTED.md`, with the repository, account mechanism, sources,
write classes, signals, suggested cadence, wave and status. `Wave` and `Status` are decisions rather than manifest data,
so they are flags; the defaults are `—` and `supported`.

## The host harness

The harness lives in `src/internal/host/`, beside conformance's real T1 host. The kit re-exports it from the same dev
export, so a plugin's host test imports the same functions and there is one implementation:

```ts
import { connectMcpServer, createAutomation, createCodeMode, createHost, TurnLog } from "@we-the-rebel-alliance/plugin-contract/kit"
```

The harness handles the six OpenCode 2.4 behaviours in plugin standard §8. Each has a test in `test/host-harness.test.ts`:

1. **Background activation.** `createHost({ directory, version, pluginId })` loads the plugin into the real embedded
   `@opencode/sdk` host, prompts a session so the plugin activates, and waits with a bound before the first RPC. A
   timeout is `HOST_TIMEOUT`, with the bound and a next step, instead of a hang.
2. **The embedded `@opencode/sdk` host never runs automations.** `createAutomation({ kind: "sdk" }, api, spec)` answers
   `{ status: "skipped" }` and does not call the API; `{ kind: "server" }` creates one, and a test on the embedded host
   that supplies its own scheduler passes `{ allowScheduler: true }`.
3. **`experimental.schedule` is gone.** `automationApi(client)` returns the 2.4 `experimental.automation` API; a client
   that still offers only `experimental.schedule` is a `HOST_API_GONE` refusal that names
   `/api/experimental/automation`. The harness never calls the removed method.
4. **MCP `server/discover` first.** `connectMcpServer(config, transport)` probes a server with no `protocol`; a 2xx is
   the connection, a 401 or 403 ends the attempt with no `initialize`, and another failure falls back to `initialize`. An
   explicit `legacy` protocol initializes directly; an explicit `2026-07-28` does not fall back. The returned `sent`
   list is the proof of what went over the wire.
5. **Nested Code Mode calls.** `createCodeMode(session)` gives `topLevel` and `nested` calls. Every nested call has its
   own call id and `codemode: true`; a reused id in one session is refused.
6. **A first tool step before the turn start.** `new TurnLog()` holds a step until its turn's start arrives, then emits
   the start first and the held steps in arrival order. `flush()` returns a step whose turn never started, so a test
   never loses one.

The harness's types are structural, so a published declaration names no host package (`npm run check:dist`). A type test
passes the real 2.4.1 `Tool.Context`, `Mcp.ServerConfig` and `experimental.automation.create` to the harness and lets
TypeScript prove the fit.

`HostRun.assert({ sessionID, action, resources })` runs one action through the real `ctx.permission.assert` and answers
`{ ok: true }` or `{ ok: false, code, message }`: the host's deny and rejection are `PERMISSION_DENIED`, an error with
its own code or a leading `CODE:` keeps it, and anything else is `UNAVAILABLE`. It never throws, so a check can bound its
own wait, and a message holding a secret is named by kind and never printed.

## Programmatic use

The dev export also publishes `checkPlugin`, `forbiddenFindings`, `redactText`, `redactValue`, `loadConformance` and the
host harness functions, so a plugin's own test can use the same rules without spawning a process. `main(argv, options)`
runs the command line and returns its exit code; its `conformance`, `git`, `now`, `cwd` and output are injectable, which
is how this package's tests run every command without a network or a repository.

## Package shape

- `src/kit.ts` is the entry; `src/kit/**` is the command implementation; `src/internal/host/**` is the shared harness;
  `bin/plugin-kit.js` is the executable shim.
- `dist/` and the shim are committed, so a tag installs and runs with no build.
- The kit has no runtime dependency: `dist/kit.js` imports Node built-ins and the package's own chunks.
- The conformance module is imported lazily, and structurally, by `loadConformance`: the kit keeps no copy of a check,
  and a module without `runConformance`, `t0` and `t1` is a clear `KIT_CONFORMANCE` error rather than a missing gate.
- `src/internal/host/` is the one host harness; `src/kit.ts` re-exports it, and a kit test proves the exports are the
  same function objects.

## Exports

| Export | Does |
|---|---|
| `COMMANDS`, `HELP`, `main`, `Command`, `MainOptions`, `KitError` | the binary's command table, its help, and the programmatic entry |
| `checkPlugin`, `forbiddenFindings`, `ForbiddenOptions`, `loadConformance`, `ConformanceOptions`, `ConformanceReport`, `ConformanceRunner`, `Finding` | the checks the kit runs without spawning a process |
| `redactText`, `redactValue` | the fixture redaction `record` applies |
| `KIT_BUNDLE_MARKER` | the marker that catches the kit bundled into a plugin |
| `createHost`, `createAutomation`, `automationApi`, `connectMcpServer`, `createCodeMode`, `mcpAddress`, `TurnLog`, `waitForActivation` | the OpenCode 2.4 host harness |
| `ActivationOptions`, `AssertResult`, `AutomationAction`, `AutomationApi`, `AutomationClient`, `AutomationHost`, `AutomationResult`, `AutomationSpec`, `AutomationTrigger`, `CodeModeHarness`, `CodeModeSession`, `HostKind`, `HostOptions`, `HostRun`, `McpConnection`, `McpProtocol`, `McpServerConfig`, `McpTransport`, `ToolCall`, `ToolCallInput`, `ToolCallLike`, `TurnEvent` | the harness's structural types |
| `Git`, `GitResult`, `Io` | the git and output calls `main` takes |
