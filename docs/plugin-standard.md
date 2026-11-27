# The plugin standard

What every `<name>-plugin` repository under `we-the-rebel-alliance` must be. A plugin meets the standard when
`npx plugin-kit check` passes in CI and the definition of done (§12) holds. The kit and the contract live in
`plugin-contract`: the package exports the runtime modules and a `plugin-kit` binary. A new plugin starts from the `plugin-template` repository.

## 0. Rules and owners

These rules and the owner table come from the owner's plugin strategy of 24 November 2026; this section supersedes it for
plugin work.

### 0.1 Who owns each job

One owner per job. A neighbour points to the owner and never claims the job.

| Job | Owner | Neighbours, which must point to the owner |
|---|---|---|
| Find or read past OpenCode sessions | OpenCode's session tools, `opencode.session.search` and `opencode.session.read` (`experimental.sqlite_fts`) | utilities' session stopgaps, for status, spend and exact text only |
| Remember things across sessions and people | a shared recall service (hosted and shared) | a hosted MCP server's recall text; OpenCode's home recall setting stays off |
| Scheduled, recurring or event-triggered work | OpenCode automations | boxd `run` (not the default) |
| Parallel work in OpenCode sessions on other boxd machines | `boxd-plugin` | — |
| A helper on the same machine | the `subagent` tool | the `drive-sessions` skill draft, only if an eval shows it helps |
| Messaging people and their agents | `opencode-messaging` | — |
| A third-party service | that service's connector plugin | boxd `run` |
| Stopgaps for missing OpenCode features | `utilities-plugin` | — |

### 0.2 Rules

1. **Need before code.** A plugin or tool exists only if OpenCode can't do the job (counting flags we can turn on) and
   an eval shows agents do better with it than without it.
2. **Three kinds.** Connectors to outside services; products with their own backend; stopgaps.
   Stopgaps live only in `utilities-plugin`, each names the OpenCode feature that replaces it, and each is deleted when
   that feature ships.
3. **One owner per job,** from the table above. A description names a neighbouring owner in one clause ("Not for X:
   use Y"), and only where agents could mix them up.
4. **A fixed-context budget:**
   - the namespace line is at most 400 characters;
   - each skill description is at most 300 characters;
   - no pinned tools by default: at most one per plugin (contract §6), and only when session data shows most of that
     plugin's sessions call it;
   - no files in config `instructions`, and no doc that asks for one;
   - no per-request hooks. The only exception in the family is one product's own protocol (at most 1,600 characters),
     and that product is not on this standard. A cost line belongs in the plugin's `status`, not in a hook.
5. **Hosted MCP server instructions belong to the connector.** OpenCode can't drop or replace a server's own text. If
   it claims a job another owner has, or asks the agent to act unprompted, the connector counters it in its own
   namespace line. Nothing is filed upstream (OD-15).
6. **Nothing outside a plugin names its tools.** No `AGENTS.md` line, config instruction file or skill outside the plugin
   points at its tools, so nothing is left behind when the plugin is off or refuses the host.
7. **Supported OpenCode versions are tested.** T1 passes on every supported host, including the one in use, before a
   release, and an unsupported host gets a clean refusal.
8. **Gates.** These are hard gates in `plugin-kit conformance`, on every pull request:
   - **T0 (static):** namespace line ≤400 characters; each skill description ≤300; no text names a tool that doesn't
     exist; no pinned tool without evidence.
   - **T1 (host):** the plugin loads on every supported host; its permissions hold; an unsupported host gets a clean
     refusal.

   The live cross-plugin routing pack is **not a gate yet**. `opencode-evals` is out of scope for this programme, and
   its preventive HALT of 21 November (a live eval made a real paid call without asking) stays until its containment
   fix lands. A gate that can't run is not a gate. The routing pack becomes a release gate when the HALT is lifted.

## 1. Repository

| Item | Standard |
|---|---|
| Name | `we-the-rebel-alliance/<name>-plugin`, public, MIT |
| Default branch | `master`, protected by an org ruleset: PRs only, required check `ci`, linear history |
| Owners | `CODEOWNERS`: the plugin's maintainer plus the contract maintainers for `package.json`, `AGENTS.md` and `docs/` |
| Topics | `opencode-plugin`, `plugin-contract`, `<vendor>` |
| Releases | tags `vX.Y.Z` from `v0.0.0`, built in CI by `plugin-kit release` |
| Issues | labels from the org's label set; `plugin-contract` issues are filed in the contract repository |

## 2. Layout

```
<name>-plugin/
  package.json            name, version, exports, files, capabilities (the manifest), devDependencies only
  src/
    index.ts              Plugin.define({ id: "<name>", setup }) → contract.register(ctx, manifest, handlers)
    handlers/             one file per method: events_list, probe, plan/commit, …; pure where possible
    provider/             the provider client: MCP calls, API or CLI; the only place a URL or binary is named
    accounts.ts           the profile schema and credential wiring, through contract `accounts`
    tui.ts                optional; status dialog only
  skills/<name>/SKILL.md  plus skills/<name>-<topic>/SKILL.md as needed
  test/
    unit/                 handlers and provider mapping
    conformance/          recorded fixtures per account (at least two aliases for plugins with accounts)
    host/                 the built bundle in OpenCode, for each tested release
  docs/                   §6
  assets/                 icon.svg, icon-128.png, icon-256.png
  AGENTS.md  README.md  CHANGELOG.md  CONTRIBUTING.md  SECURITY.md  LICENSE
  .github/workflows/ci.yml, release.yml   thin wrappers around plugin-kit
```

There are no copied scripts. `scripts/` exists only for something truly specific to the plugin, such as gws's native binary
fetch, and the kit checks that none of it duplicates the kit.

## 3. package.json

```json
{
  "name": "@we-the-rebel-alliance/<name>-plugin",
  "version": "0.0.0",
  "type": "module",
  "exports": { "./server": "./dist/index.js", "./tui": "./dist/tui.js" },
  "files": ["dist", "skills", "assets", "README.md", "LICENSE"],
  "repository": "github:we-the-rebel-alliance/<name>-plugin",
  "capabilities": { "version": 1, "plugin": {}, "accounts": {}, "options": {}, "methods": {}, "sources": [], "actions": [], "events": {} },
  "devDependencies": {
    "@opencode/plugin": "2.4.1", "@opencode/sdk": "2.4.1", "@opencode/client": "2.4.1",
    "@we-the-rebel-alliance/plugin-contract": "github:we-the-rebel-alliance/plugin-contract#v0.0.0",
    "typescript": "…", "vitest": "…", "esbuild": "…", "@biomejs/biome": "…"
  }
}
```

- No `dependencies`, `peerDependencies` or lifecycle scripts. The bundle is self-contained: `dist/index.js` (and
  `dist/tui.js`), built with esbuild, with only host modules and Node built-ins left external.
- No app-specific, `sources` or `opencode` keys. Everything an app needs is in `capabilities`.

## 4. Runtime rules

1. **Public API only:** `@opencode/plugin` 2.4.1. The kit's `forbidden` check bans internal APIs. One documented
   exception: utilities' `utilities_sessions_grep` stopgap reads OpenCode's SQLite database over a read-only connection,
   refuses cleanly on an unknown schema, keeps a pinned host range, and is deleted when OpenCode ships exact-text search.
2. **Host range:** `capabilities.plugin.host.opencode` is `>=2.4.1 <2.5.0`, and `tested` lists the releases CI runs. Outside the
   range the plugin refuses to start with `HOST_UNTESTED`, unless `allowUntestedHost` is set.
3. **One `register` call** wires every method through doors 1–3. Handlers never touch tools, RPC or permissions directly.
4. **Accounts** through the contract's `accounts` module: profiles in `options.accounts`, names per contract §3, `account` on
   every method that takes one.
5. **Access** through the contract's `access` module: default rules after each agent's base allow; agents that lack them
   are named in status, never patched.
6. **Writes:** plan, then commit (`plans` and `commits` in `methods`), or an `actions` preview and commit. Non-local commits are
   confirmed by an OpenCode ask, or by a host-signed action grant verified by the contract's `grant` module.
7. **Nudges:** emit `changed` after any write the plugin makes, and on any webhook or push it receives.
8. **Errors:** `CODE: What happened. Next step: What to do.`, from the contract's table. A plugin uses the contract's
   codes. A code that only `status` shows is declared in `capabilities.errors`; no other code is.
9. **Untrusted data:** every answer is marked `trust: "untrusted"`; events are screened for secrets. Status and logs never
   carry credentials, URL query strings or tokens: reasons are redacted and cut to 160 characters.
10. **Transforms** are cheap, synchronous and never throw. Failures are recorded for status.
11. **Greenfield:** no compatibility shims, legacy paths, deprecated aliases or dead code. Delete rather than deprecate.
12. **One endpoint string:** the provider's URL or binary is named once, in `src/provider/`.
13. **Code Mode pin budget:** no method is pinned by default. At most one may be (`pinned: true` in `methods`), only when
    session data shows most of the plugin's sessions call it, and its signature with the namespace guidance stays within
    about 1,000 tokens; every other method is found with `search({ namespace })`. Pinned signatures are sent on every
    turn (joe-broadhead/opencode-charts#33, joe-broadhead/opencode-history#33). The kit measures it.
14. **No per-request hooks** (§0.2 rule 4). Cost and fleet state are read through `status`.

## 5. Options

Every plugin's `options` schema has:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `access` | `all` \| `ask-changes` \| `read-only` | `all` | how much the plugin's methods may do (contract §6) |
| `accounts` | map of alias → profile | one `default` account | plugins with accounts only |
| `allowUntestedHost` | boolean | `false` | start outside the tested OpenCode range |

Plugin-specific options follow, each with a title, description and default. The kit generates the configuration doc from
the schema and checks that the defaults validate.

## 6. Documentation

All docs are written fresh for v0.0.0, in plain English, for two readers: a person installing the plugin, and an agent
working in the repository. Sections marked *generated* are written by `plugin-kit docs` from the manifest between markers,
and CI fails when they drift.

| File | Contents |
|---|---|
| `README.md` | what it does (one paragraph); install; sign in (one account, then several); access levels; capabilities table *(generated)*; errors table *(generated)*; links to docs |
| `AGENTS.md` | the agent guide, from `AGENTS.template.md` in plugin-contract |
| `docs/capabilities.md` | sources, actions, methods with class and operations, bus events *(generated)*, plus a hand-written note per capability |
| `docs/accounts.md` | the mechanism (integration or MCP), profile fields *(generated)*, sign-in per alias, how to pick an account in a call |
| `docs/configuration.md` | the options *(generated)* and examples |
| `docs/architecture.md` | layers, the provider client, what is cached, which OpenCode APIs are used |
| `docs/automations.md` | the timer recipe for each events source, using `tools.<name>.events_list` with a cursor in state, and the suggested cadence *(generated)* |
| `docs/security.md` | what leaves the machine, scopes requested, redaction, the plan/commit flow |
| `CHANGELOG.md` | starts at `0.0.0`; one section per release, written by `plugin-kit release` |
| `CONTRIBUTING.md` | short; points at the plugin standard and the kit commands |
| `SECURITY.md` | how to report, the org's standard text |

There is no doc about any one app. App guides live in each app's own repository.

## 7. Skills

- At least one skill: `skills/<name>/SKILL.md`, which says when to use the plugin, how to pick an account, the access levels,
  and the errors' next steps. Where `<name>` collides with a skill the plugin doesn't own, the main skill is
  `<name>-<topic>` instead (boxd's is `boxd-sessions`, because the boxd VM ships its own `boxd` skill).
- More skills only for distinct workflows (`<name>-search`, `<name>-triage`).
- Skills name tools as `tools.<name>.<method>` and never hard-code an account.

## 8. Tests

| Suite | What it proves |
|---|---|
| unit | handlers, provider mapping, accounts resolution, error mapping |
| conformance | the contract kit against recorded fixtures for at least two accounts, with the T0 and T1 gates (§0.2 rule 8) |
| host | the built bundle loads in each tested OpenCode release; the methods show up as tools, Code Mode entries and RPC; access rules are generated; status validates |
| pack | the packed tarball installs with `opencode plugin add` from a local path and starts |

Fixtures are recorded from real accounts with `plugin-kit record`, which redacts them before commit.

**The host harness and OpenCode 2.4.** `plugin-kit`'s host harness must handle six behaviour changes found in the 2.4.1
migration (`work/plan/HANDOFF-PLUGINS-2026-11-24.md` §3):

1. Plugins load in the background: wait, with a bound, for the plugin to be active before the first RPC.
2. The embedded `@opencode/sdk` host never runs automations; only `@opencode/server` starts the scheduler. Tests that
   need a scheduled run use the server host or a scheduler override.
3. `experimental.schedule` is gone from the 2.4 client; automations are under `/api/experimental/automation`.
4. MCP servers with no `protocol` are probed with `server/discover` first, and a 401 ends the attempt (no `initialize`
   follows).
5. Nested Code Mode calls carry their own call id and `codemode: true`.
6. A turn's first tool step can arrive before the turn start.

## 9. CI and release

- `ci.yml`: `npx plugin-kit check` runs lint (biome), typecheck, build, unit, conformance (with T0 and T1), host
  (matrix over `tested`), pack, docs drift, forbidden APIs, and manifest/name checks, on every pull request.
- `release.yml`: on a `vX.Y.Z` tag cut by `plugin-kit release`, it builds, checks again, and publishes the GitHub
  release with `dist/`, `SHA256SUMS` and the conformance report attached. Native binaries (gws) carry provenance.

## 10. Security

- Least scopes per profile; the scopes requested are listed in `docs/security.md`.
- No secret in config, docs, fixtures or logs. Headless profiles name environment variables, never values.
- Untrusted content is never followed as instructions, never echoed into status, and never used to pick a tool or a recipient.

## 11. AGENTS.md

From `AGENTS.template.md`, kept current with the code. The kit checks that its required sections exist.

## 12. Definition of done

- [ ] Repository renamed and transferred, protected, with CODEOWNERS and topics.
- [ ] `capabilities` manifest complete; no app-specific, `sources` or `opencode` key.
- [ ] Accounts: several aliases at once, each signed in separately; `ACCOUNT_REQUIRED` and `ACCOUNT_UNKNOWN` behave.
- [ ] Every method reachable as a tool, in Code Mode, and over RPC; nothing RPC-only.
- [ ] `methods` classifies every tool, including pass-through MCP tools.
- [ ] Access levels verified in host tests.
- [ ] `changed` emitted after writes; status and probe validate.
- [ ] No dead code, compatibility paths or app-specific code.
- [ ] Docs, skills and AGENTS.md written fresh; generated sections match.
- [ ] T0 and T1 pass: within the fixed-context budget, no pinned method without evidence, no per-request hook.
- [ ] `plugin-kit check` green; v0.0.0 released with SHA256SUMS and the conformance report.
- [ ] Listed in plugin-contract's `SUPPORTED.md` at the matching version.

