# plugin-contract

The contract between OpenCode plugins and the apps that use them. A plugin declares once what it reads, what it does and
how risky each call is; any app can then use it, and no app is named. This package holds the language and the library:
the manifest schema, the event and page model, the error table, the modules that read and act under a grant, and the
conformance kit.

It is greenfield at `v0.0.0`. There are no compatibility shims and no legacy aliases.

## What a plugin declares

One top-level `capabilities` key in the plugin's `package.json`: identity and the OpenCode range, how accounts work, the
options' JSON Schema, every method with its class and provider operations, the sources an app may bind to, the actions a
person may take, and the bus events the plugin emits. The manifest is read from the installed package on disk, never over
RPC, and hashed; a grant stores the hash, so a changed manifest asks the person again. Contract §4 is the full shape.

An app-only hint is allowed only as an `x-<app>` key, which every other app ignores and no app may require.

## The five doors

Every method is written once and reached through every door (contract §9):

| # | Door | Who | Mechanism |
|---|---|---|---|
| 1 | Agent tool | agents | `ctx.tool`, namespace `<name>`, permission `<name>.<method>` |
| 2 | Code Mode and automations | scripts, automations | `tools.<name>.<method>(…)` |
| 3 | RPC | apps, scripts, the catalog | `POST /api/rpc/<name>/<method>` with `{ sessionID, input }`, under that session's rules |
| 4 | Bus | apps | `rpc.<name>.<event>` on `/api/event` |
| 5 | MCP Events | event automations | an optional `mcp-events` adapter, one local server per plugin |

`register(ctx, manifest, handlers)` wires doors 1–3 from one handler table. A plugin writes no door code. Bus nudges
carry no content: an app re-reads through door 3.

## Accounts

Every plugin that signs in supports several named accounts at once, such as `work` and `personal` (contract §5). The
account with no alias is `default`. A plugin's accounts arrive through one of three mechanisms:

- `integration`: the plugin holds the credentials, one OpenCode integration per alias (`gws`, `gws-work`);
- `mcp`: the vendor's MCP server holds them, one server per alias, each with its own OAuth;
- `local`: the identity of the machine or OS user, one account.

Every method that takes an account resolves it the same way. With more than one account, leaving `account` out is
`ACCOUNT_REQUIRED`; an unknown alias is `ACCOUNT_UNKNOWN`. Cursors are bound to the plugin, capability, account and
scope.

## Modules

Each module is its own entry point: `import { read } from "@we-the-rebel-alliance/plugin-contract/read"`. A plugin
bundles only what it imports.

The module map of the contract (§15), and what this package ships today:

| Module | Side | Does | State |
|---|---|---|---|
| `manifest` | both | schema, validation and hashing of `capabilities` | landing |
| `accounts` | plugin | profiles, names, registration, `account` resolution, status | landing |
| [`access`](docs/access.md) | plugin | default rules from `access` and `methods` | here |
| [`register`](docs/register.md) | plugin | doors 1–3 from one handler table | here |
| `events` | plugin | event normaliser, hash, screening, page building | here |
| `cursor` | plugin | bound cursor codec | here |
| `bus` | plugin | typed `changed`, `status` and `account` emitters | landing |
| `grant` | plugin | action-grant verifier | landing |
| [`outputs`](docs/outputs.md) | both | the snapshot shape registry and its JSON Schemas | here |
| [`read`](docs/read.md), [`act`](docs/act.md) | app | fenced reads and actions, through the catalog or embedded | here |
| [`params`](docs/params.md), [`pick`](docs/pick.md) | app | relative times, `$me`, field selection | here |
| [`catalog`](docs/catalog.md) | app, catalog | installed manifests and the broker request | here |
| `conformance` | CI | the kit | here |
| `kit` | dev | the `plugin-kit` binary | landing |
| `mcp-events` | plugin | optional MCP Events adapter | later |

`docs/conformance.md` describes the kit. `docs/events.md` describes the feed model. `docs/outputs.md` describes the
snapshot shapes. `docs/read.md`, `docs/act.md`, `docs/params.md` and `docs/pick.md` describe the app side, and
`docs/hints.md` the hint file. [`docs/access.md`](docs/access.md) describes the access levels and the grant fences;
[`docs/register.md`](docs/register.md) describes the one handler table and the three doors.

## plugin-kit

`plugin-kit` is the binary every plugin's CI runs: `check`, `docs`, `record`, `conformance`, `hosts`, `release`,
`supported` and `forbidden`. It ships inside this package as a binary and a dev export, and it is never bundled into a
plugin. A new plugin starts from `plugin-template`.

## Install

Releases are tagged GitHub releases, not npm. Each tag carries `dist/`, `SHA256SUMS`, the conformance kit as one file
and the JSON Schema bundle. Pin the exact release tag:

```sh
npm install github:we-the-rebel-alliance/plugin-contract#<tag>
```

The package has no runtime dependencies: `dist/` imports only Node built-ins, and a plugin bundles what it imports into
its own `dist/`. Node 22 or later runs the package; the conformance host needs Node 24 or Bun, and T1 reports
`T1.host-unavailable` elsewhere. CI checks Node 24 and Node 22.

## Docs

- [The contract, v0](docs/contract.md): the manifest, accounts, methods and access, sources, actions, doors, bus events,
  status, errors, trust, catalog, modules, conformance and versions.
- [The plugin standard](docs/plugin-standard.md): what every `<name>-plugin` repository must be.
- [Supported plugins](SUPPORTED.md): the plugins and their state.
- [Decisions](docs/decisions.md): the settled decisions behind v0.
- [Conformance](docs/conformance.md), [events and cursors](docs/events.md), [outputs](docs/outputs.md),
  [access](docs/access.md), [register](docs/register.md).
- The app side: [read](docs/read.md), [act](docs/act.md), [catalog](docs/catalog.md), [params](docs/params.md),
  [pick](docs/pick.md).
- [Hints](docs/hints.md): the generic hint file format.
- [AGENTS.template.md](AGENTS.template.md): the agent guide every plugin starts from.
- [CONTRIBUTING.md](CONTRIBUTING.md): how to build and check this package.

## Licence

MIT. See [LICENSE](LICENSE). `dist/` bundles zod (MIT); see `dist/THIRD-PARTY-NOTICES.md`.
