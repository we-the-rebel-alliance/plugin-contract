# The kit: `plugin-kit`

`plugin-kit` is the binary every plugin's development and CI runs. It lives in `plugin-contract` as
`@we-the-rebel-alliance/plugin-contract/kit`, a `bin` entry and a dev export: a plugin adds the package as a
`devDependency` and never bundles the kit into its own `dist/`.

The kit calls the conformance module for every conformance check (`runConformance`, `t0`, `t1` in
`src/conformance.ts`). It does not re-implement a check or keep a second copy of a rule. Its own work is what is about a
repository rather than a plugin's runtime: generated documentation, the forbidden patterns, fixture redaction, the
release files and the host harness.

```sh
npx plugin-kit <command> [options]
```

Every command runs from the plugin's root directory, or with `--dir <path>`. `--json` prints one JSON object and moves
the report off stdout. A command exits `0` when it passes, `1` when a finding is an error, and `2` for a usage mistake.

## Commands

| Command | What it does | Options |
|---|---|---|
| `check` | everything a pull request needs from the kit: T0, T1 on every tested host, generated docs, forbidden patterns | `--host <release>` (repeatable), `--json` |
| `docs` | writes each manifest-driven section between its markers | `--check`, `--json` |
| `record` | runs the recorder, then redacts every JSON fixture under `test/conformance/` | `--account <alias>`, `--fixtures <path>`, `--check`, `--json` |
| `conformance` | the whole conformance report | `--host <release>`, `--record`, `--json` |
| `hosts` | the OpenCode release matrix: `[2.4.1]` | `--json` |
| `release <version>` | checks, a changelog section, the version in `package.json` and the lockfile, one commit and one tag | `--dry-run`, `--json` |
| `supported` | this plugin's row for `SUPPORTED.md` | `--wave <name>`, `--status <state>`, `--json` |
| `forbidden` | app names, `main`-branch links and secrets | `--json` |

`check` does not typecheck, build or run the plugin's unit tests: those are the plugin's own commands, and its CI runs
them beside the kit. T0 and T1 are hard gates (plugin standard §0.2 rule 8); a conformance call that throws becomes a
`KIT_CONFORMANCE` error, never a skipped gate.

### `check` and `conformance`

`check` calls `t0(pluginDir)` once and `t1(pluginDir, host)` for each release the manifest lists in
`capabilities.plugin.host.tested`. `--host` replaces that list, so a lane can try one release without editing the
manifest. `conformance` calls `runConformance(pluginDir, { hosts?, record? })` and prints its report; `--host` and
`--record` are passed through unchanged.

The finding ids are the conformance module's, such as `T0.namespace-length` and `T1.host`. The kit's own ids are stable
and start with `KIT.`, `DOCS.`, `FORBIDDEN.` or `RECORD.`.

### `docs`

The generated sections and the files they belong in are fixed by the plugin standard (§6):

| Section | File | What it lists |
|---|---|---|
| `readme.capabilities` | `README.md` | every method, with its class, accounts, operations and plans/commits |
| `readme.errors` | `README.md` | the contract's error table (contract §12) |
| `capabilities.methods` | `docs/capabilities.md` | the same methods table |
| `capabilities.sources` | `docs/capabilities.md` | every source, its kind, read or output, method, service, signals, cadence, cost, scope and details |
| `capabilities.actions` | `docs/capabilities.md` | every action, its effect and its preview and commit methods |
| `capabilities.events` | `docs/capabilities.md` | the bus events the plugin emits |
| `accounts.profile` | `docs/accounts.md` | the profile fields every alias is checked against |
| `configuration.options` | `docs/configuration.md` | every option, its type, default and description |
| `automations.events` | `docs/automations.md` | one timer recipe per events source, with the cursor in state |

A section sits between its markers, and the text outside them is hand-written and never touched:

```md
<!-- kit:start:capabilities.methods -->
| Method | Class | … |
<!-- kit:end:capabilities.methods -->
```

`plugin-kit docs` replaces what is between a pair. `plugin-kit docs --check` reports a section that differs
(`DOCS.stale`), a missing pair (`DOCS.missing-marker`) or a missing file (`DOCS.missing-file`); `plugin-kit check` runs
the same check. It also reports a missing heading in `AGENTS.md` (`DOCS.agents-section`), because the standard requires
the template's sections.

A generated section is deterministic: the same manifest makes the same bytes, so a diff in a generated section is a
manifest change. Edit the manifest, never the section.

### `record`

`record` first runs `runConformance(pluginDir, { record: true })`, which writes the provider answers through the
plugin's own recorded calls, and then redacts every JSON file under `test/conformance/`. The default can be replaced
with `--fixtures <path>`. With `--account <alias>`, a recorder that writes one directory per alias is redacted for that
alias only: `test/conformance/work/` rather than the whole directory.

Redaction replaces:

- a credential: a string the contract's `secretKinds` recognises, or a value under a key such as `token`, `secret`,
  `password`, `api_key`, `authorization`, `cookie` or `credential`, with `<redacted:secret>`;
- an email address with `<redacted:email>`, a phone number with `<redacted:phone>`, a home directory with
  `<redacted:home>`;
- a value under `email`, `phone`, `username`, `display_name`, `real_name` or `full_name` with
  `<redacted:personal>`;
- a sensitive URL query value (`token`, `key`, `signature`, `password`, `email`, `code`) with `<redacted>`.

The pass is deterministic and idempotent: keys keep their order, a placeholder carries no pattern, and a second run
changes nothing. `record --check` records nothing and fails (`RECORD.unredacted`) when a committed fixture still needs a
redaction, so CI can run it on every pull request.

### `forbidden`

The scan reads text files outside `node_modules`, `dist` and the other generated directories, and never a lockfile:

| Id | What it finds |
|---|---|
| `FORBIDDEN.app-name` | an app's name in code, manifest or docs. An `x-<app>` key is allowed: the prefix is the one place a name belongs. |
| `FORBIDDEN.main-branch` | a GitHub `blob/main`, `tree/main`, `raw/main` or `raw.githubusercontent.com/…/main` link. Every repository in the org uses `master`. |
| `FORBIDDEN.secret` | a credential the contract's own detector (`secretKinds`) recognises. |

The app list is `src/kit/forbidden-apps.ts`, the kit's one denylist. A common word is matched only when it is
capitalised or part of the app's package or repository name, so ordinary prose is not a finding.

### `release`

`release <version>` is the one release command. It:

1. runs `check`, and writes nothing when an error is found;
2. adds the version's section to `CHANGELOG.md`: `Unreleased` is renamed when it exists, otherwise the section follows
   the title;
3. writes the version to `package.json` and, when it exists, `package-lock.json`;
4. commits the files it changed as `chore(release): prepare v<version>`, and creates the annotated tag `v<version>`.

The tag is local. Pushing it is the owner's step; CI publishes the GitHub release on that tag (plugin standard §9).
`--dry-run` prints the plan and writes nothing. The command refuses a tag that already exists instead of moving it.

`supported` prints one row for the data-source table in `SUPPORTED.md`, with the repository, account mechanism, sources,
write classes, signals, suggested cadence, wave and status. `Wave` and `Status` are decisions rather than manifest data,
so they are flags; the defaults are `—` and `supported`.

## The host harness

A plugin's host test imports the harness from the same dev export:

```ts
import { connectMcpServer, createAutomation, createCodeMode, createHost, TurnLog } from "@we-the-rebel-alliance/plugin-contract/kit"
```

The harness handles the six OpenCode 2.4 behaviours in plugin standard §8. Each has a test in `test/kit-host.test.ts`:

1. **Background activation.** `createHost({ kind, plugin, isActive })` exposes `activate()`, which waits with a bound,
   and `call(name, fn)`, which waits for activation before the first RPC. A timeout is `KIT_TIMEOUT`, with the bound and
   a next step, instead of a hang.
2. **The embedded `@opencode/sdk` host never runs automations.** `createAutomation({ kind: "sdk" }, api, spec)` answers
   `{ status: "skipped" }` and does not call the API; `{ kind: "server" }` creates one, and a test on the embedded host
   that supplies its own scheduler passes `{ allowScheduler: true }`.
3. **`experimental.schedule` is gone.** `automationApi(client)` returns the 2.4 `experimental.automation` API, and
   `legacySchedule()` is a `KIT_API_GONE` refusal that names `/api/experimental/automation`. The harness never calls the
   removed method.
4. **MCP `server/discover` first.** `connectMcpServer(config, transport)` probes a server with no `protocol`; a 2xx is
   the connection, a 401 ends the attempt with no `initialize`, and another failure falls back to `initialize`. An
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

## Programmatic use

The dev export also publishes `checkPlugin`, `forbiddenFindings`, `redactText`, `redactValue`, `loadConformance` and the
host harness functions, so a plugin's own test can use the same rules without spawning a process. `main(argv, options)`
runs the command line and returns its exit code; its `conformance`, `git`, `now`, `cwd` and output are injectable, which
is how this package's tests run every command without a network or a repository.

## Package shape

- `src/kit.ts` is the entry; `src/kit/**` is the implementation; `bin/plugin-kit.js` is the executable shim.
- `dist/` and the shim are committed, so a tag installs and runs with no build.
- The kit has no runtime dependency: `dist/kit.js` imports Node built-ins and the package's own chunks.
- The conformance module is imported lazily, and structurally, by `loadConformance`: the kit keeps no copy of a check,
  and a module without `runConformance`, `t0` and `t1` is a clear `KIT_CONFORMANCE` error rather than a missing gate.
