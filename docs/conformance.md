# Conformance

A plugin proves it keeps the contract by running the conformance kit in its CI and attaching the report to each
release. An app lists a plugin only with a passing report for the pinned version. The kit is the `conformance` module,
and every check lives here: `plugin-kit` calls these functions and never re-implements one.

```js
import { runConformance, t0, t1 } from "@we-the-rebel-alliance/plugin-contract/conformance"

const report = await runConformance("/path/to/the/installed/plugin")
if (!report.ok) for (const finding of report.findings) console.error(finding.id, finding.message, finding.fix)
```

The plugin is read from the installed package on disk: `readInstalledManifest` validates and hashes its `capabilities`
key, and its own tests record what it answers under `fixtures/conformance.json`. Nothing said over RPC is trusted as a
manifest.

## The interface

```ts
runConformance(pluginDir: string, options?: { hosts?: string[]; record?: boolean }): Promise<ConformanceReport>
t0(pluginDir: string): Promise<Finding[]>
t1(pluginDir: string, host: string): Promise<Finding[]>

interface ConformanceReport { ok: boolean; findings: Finding[] }
interface Finding { id: string; level: "error" | "warning"; message: string; path?: string; fix?: string }
```

`id` is stable (`T0.namespace-length`, `T1.permissions`, `accounts.required`), so CI and a reviewer can tell one finding
from another across releases. `ok` is false when any finding is an error. A warning names something the kit could not
prove. `record: true` turns a missing recording into a warning while a fixture is being written. `hosts` defaults to the
manifest's `plugin.host.tested`; when any host is requested, the first unsupported release (`2.5.0`) is run as well,
for the clean refusal.

`t0` is static: it reads the namespace text recorded in `fixtures/conformance.json`. `runConformance` measures it live
from T1 instead, so the CI gate always uses the registered text. `t1` loads the plugin on one OpenCode release. `runConformance` runs T0, the declaration and its recordings, and
T1.

## T0, the static gate

| Check | Proves |
|---|---|
| `T0.namespace-length` | the namespace text the plugin registers with `ctx.tool.namespace` is one line of at most 400 characters |
| `T0.skill-length` | every `skills/**/SKILL.md` has a description of at most 300 characters |
| `T0.skill-name` | every skill is `<name>` or `<name>-<topic>` |
| `T0.tools` | no text names a tool the manifest does not declare (`tools.<name>.<method>`, and `<name>_<method>` in a skill) |
| `T0.pinned` | a pinned method has session evidence declared in the fixture |
| `T0.docs-*` | every generated doc section matches the manifest |

T0 reads `AGENTS.md`, `README.md`, `SUPPORTED.md`, `docs/**/*.md` and `skills/**/*.md`. A file the plugin does not ship
is not a T0 finding: the file set belongs to the kit's `docs` and `forbidden` checks.

## T1, the host gate

| Check | Proves |
|---|---|
| `T1.load` | the package's server entry imports and exports `Plugin.define({ id, setup })` |
| `T1.id` | the plugin's id is `capabilities.plugin.name` |
| `T1.doors` | every non-MCP method is an agent tool with permission `<name>.<method>` and an RPC method under id `<name>`, and nothing else is registered |
| `T1.permissions` | the access matrix holds for every real primary agent at `all`, `ask-changes` and `read-only` (a plugin whose methods are all reads has one matrix, so only `all` is run), using the one `effectFor` from `./access` |
| `T1.codemode` | every tool is exposed to Code Mode, and only a declared pinned method is pinned |
| `T1.events` | the one RPC registration carries exactly the manifest's bus events |
| `T1.pinned-budget` | a pinned tool's signature is within about 1,000 tokens |
| `T1.rpc-confirmation` | a non-`read` method over RPC with an allow rule and no grant is refused (LD-5); a commit is planned first, and an unplannable commit is a warning |
| `T1.accounts` | with two aliases and `accounts.real`, a missing account is `ACCOUNT_REQUIRED`, an unknown one is `ACCOUNT_UNKNOWN`, and a cursor does not cross accounts |
| `T1.unsupported-host` | a release outside `>=2.4.1 <2.5.0` is refused with `HOST_UNTESTED` and a next step |

T1 loads the built server entry through OpenCode's own `Plugin.Host.resolve` (`./server`, then `.`; never `main` or
`dist/index.js`) and runs it in the embedded `@opencode/sdk` 2.4.1 host: it creates a session, prompts once so the
plugin instance activates, waits for the plugin list, and records the real `ctx` registrations. It imports no private
OpenCode code. The host harness lives in `src/internal/host/` and is owned by conformance; `plugin-kit` is to import this module rather than carry a copy. It
handles the six 2.4 behaviours standard §8 lists: activation before the first RPC, the embedded host never running
automations, no `experimental.schedule`, MCP `server/discover` with 401/403 final, nested Code Mode call ids, and a
turn's first tool step arriving before the start. A plugin repository carries `@opencode/plugin` and `@opencode/sdk`
2.4.1 as devDependencies (standard §3); `dist/` still bundles neither.

## The declaration

The manifest schema already refuses a stray top-level key, a name outside §3, a host range other than the contract's,
and a `delete_*`/`send_*`/`share_*` method whose class disagrees. These findings carry the rest:

| Check | Proves |
|---|---|
| `names.package` | the package is `@we-the-rebel-alliance/<name>-plugin` |
| `methods.class` | a name's prefix and its class agree: a delete, a send, a share, an export, a write, an admin |
| `methods.plans`, `methods.commits` | a plan is a read, and the method it names as its commit is a read plan too |
| `sources.method`, `sources.operations` | a source is read by a read, and its operations are among its method's |
| `sources.details`, `sources.suggest` | a detail and a bind-time read are reads, in the source's namespace, and a suggest's operations stay out of the running grant |
| `sources.thumbnails` | a source that declares thumbnails declares `urlHosts` (#42) |
| `actions.preview`, `actions.commit` | a preview is a read, a commit is not, and they are different methods |
| `options.*` | `access` is the three levels and defaults to `all`; `allowUntestedHost` defaults to false; a wrong default is an error; an account-taking plugin declares `accounts` |

## Recorded sources and accounts

`runConformance` replays what the plugin's own tests recorded. For an events source, every page is checked by
`read.acceptAnswer` (the same call a consumer makes), its source and plugin names, its kinds, its size, its hash
stability, `failed` holding the cursor, one `gap` per read, final `removals`, refused secrets and a billed source's
cost. A thumbnail appears only when the read asked for it, is an https URL of at most 2048 characters with no user info,
query or fragment, is on a host in `urlHosts`, passes the Public Suffix/shared-host safety check (a `*.github.io`
thumbnail does not), and is outside the event's hash.

A snapshot validates against its registry output; a probe reads the account and nothing else; a detail read takes only
the fields its `from` names; a suggest answer lists `{ id, label? }` at most 64 times.

| Check | Proves |
|---|---|
| `pages.*` | the pages, their cursor, gap, removals, secrets, kinds, cost and hash |
| `snapshot.*` | a snapshot's `data` and `asOf` |
| `probe.*` | the owner, the account and `trust: "untrusted"` |
| `details.*` | the detail's declared fields, and an out-of-scope read refused |
| `suggest.*` | the values a person may confirm |
| `accounts.aliases` | at least two aliases, each a valid alias; `local` has one |
| `accounts.required`, `accounts.unknown` | `ACCOUNT_REQUIRED` and `ACCOUNT_UNKNOWN` are recorded, on a method that takes an account |
| `accounts.cursors` | a cursor issued for one account is refused for another |

With `accounts.real: true` in the fixture, T1 runs the same cases against the real host; the fixture plugin below sets
it, so the account behaviour is proven by execution, not only by a recording.

## Events, status, actions, grants

| Check | Proves |
|---|---|
| `events.emitted`, `events.declared` | every emitted bus event is declared, and every declared one is emitted |
| `status.*` | the status answer's shape, its host range, one entry per alias, and no secret |
| `actions.preview` | a recorded preview is `{ output, …, trust: "untrusted" }` |
| `actions.recorded` | every non-local action records a preview and a commit |
| `grants.*` | the recorded grants verify, and #40's wrong audience, replay, expiry and digest mismatch are refused |
| `rpc.confirmation` | a recorded non-read RPC call with the ask denied is refused |

The grant check calls the `grant` module over the plugin's recorded host public key and compact tokens; it never carries
a private key. A non-local action without a recorded grant is a finding. T1 is the live half of the same rule: it calls
each non-read method over RPC with a session whose rules allow it and no grant, and requires `PERMISSION_DENIED`; a
plugin whose rules permit the call fails conformance.

## The fixture

`fixtures/conformance.json` holds what the plugin's own tests recorded. Every section is optional, and the check that
needs one says so:

```json
{
  "plugin": "@we-the-rebel-alliance/acme-plugin",
  "accounts": {
    "real": true,
    "aliases": ["work", "personal"],
    "required": { "method": "events_list", "code": "ACCOUNT_REQUIRED" },
    "unknown": { "method": "events_list", "account": "nobodyhere", "code": "ACCOUNT_UNKNOWN" },
    "cursors": [{ "method": "events_list", "account": "work", "other": "personal", "code": "CURSOR_INVALID" }]
  },
  "sources": {
    "acme.feed": {
      "cases": [
        { "name": "the work account", "input": { "account": "work" }, "expect": "page", "answer": {} },
        { "name": "an expired cursor", "input": { "cursor": "stale" }, "expect": "expired", "refuses": "CURSOR_EXPIRED: … Next step: …" }
      ],
      "probe": { "answer": { "account": "work", "owner": { "id": "mailto:a@example.test", "label": "A" }, "trust": "untrusted" } },
      "details": [{ "id": "acme.feed.item", "event": { "external_id": "1" }, "answer": {} }],
      "suggest": { "answer": { "options": [] } },
      "snapshot": { "answer": {} },
      "atomicPages": { "reason": "one provider call answers the page" }
    }
  },
  "events": { "emitted": ["changed"], "status": {} },
  "actions": [{ "id": "acme.feed.post", "preview": { "answer": {} }, "commit": { "answer": {} } }],
  "grants": { "publicKey": "-----BEGIN PUBLIC KEY-----…", "cases": [] },
  "rpc": { "calls": [{ "method": "post", "ask": "denied", "expect": { "code": "PERMISSION_DENIED" } }] },
  "pinned": { "events_list": "41 of 44 sessions call it" }
}
```

`plugin-kit record` writes and redacts the file; `record: true` lets a plugin run the kit while it is still being
written. `test/fixtures/fixture-plugin/` is the kit's own real plugin: it has write, send and delete methods, a plan and
its commit, a grant action, an events source with thumbnails, a detail, a suggest read and a pinned tool, and the
conformance tests run every hard check against it, positive and negative. `examples/*/fixtures/conformance.json` are
complete recordings, and `npm run conformance:self-test` runs the kit over every example from `dist/` as it ships.

## Generated docs

`renderGeneratedDocs(manifest)` is exported from the same entry, so `plugin-kit docs` writes exactly what T0 compares.
A section sits between markers:

```md
<!-- generated:capabilities -->
…the table…
<!-- /generated:capabilities -->
```

The sections are `capabilities`, `errors`, `configuration`, `accounts` and `automations`. T0 reads them from `README.md`,
`docs/capabilities.md`, `docs/configuration.md`, `docs/accounts.md` and `docs/automations.md` when those files exist,
and fails when a block is missing or differs from the manifest.
