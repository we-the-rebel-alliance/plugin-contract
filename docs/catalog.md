# `catalog`

The installed manifests, and the broker request a consumer sends a host (contract §14). Remote apps cannot read the
disk, and nothing said over RPC is trusted as a manifest, so the catalog is the one trusted door for them.

The module does two things:

- **Listing.** `listInstalledPlugins(ctx)` asks the host which plugins are installed (`ctx.plugin.list()`), finds each
  package's directory, and reads, validates and hashes the manifest with the `manifest` module.
- **The broker.** `brokerRequest` builds the one request a consumer sends a host's broker, `sourceReader` asks the
  broker first and reads embedded when none is offered, and `isBrokerRequest`/`isBrokerAnswer` check the wire shapes.

A catalog plugin serves `catalog.list`, `broker.read` and `broker.act` over RPC, in sessions fenced by the person's
grants. That plugin is its own repository; this module is the shared side it runs on.

## Listing installed plugins

```ts
import { listInstalledPlugins } from "@we-the-rebel-alliance/plugin-contract/catalog"

const listing = await listInstalledPlugins(ctx) // a plugin's own context
for (const plugin of listing.plugins) {
  plugin.manifest.sources   // validated capabilities
  plugin.hash               // sha256:…, the hash a grant stores
}
listing.problems            // packages that could not be read, one entry each
```

`ctx.plugin.list()` answers one entry per installed plugin. The catalog reads its `source` and `state`:

| `source.type` | What the catalog does |
|---|---|
| `local` | reads the manifest at `source.path`; a single-file local plugin has no manifest and is reported |
| `package` | resolves `source.target` through the OpenCode 2.4.1 cache, then reads the manifest |
| `builtin`, `sdk` | skipped: there is no package on disk to read |

A plugin whose host state is `failed` is reported with the host's error and reference, never listed as healthy.

### The 2.4.1 cache

OpenCode 2.4.1 installs package plugins here:

```
<XDG_CACHE_HOME or ~/.cache>/opencode/npm/<key>/<generation>/node_modules/<name>
```

The catalog mirrors `@opencode/util@2.4.1` (`dist/npm.js`: `cacheKey`/`key`, `gitSlug`, `directory`, `generations`,
`current`, `installedName`; `dist/global-roots.js`: `cache`):

- **`<key>`** is `name@latest` for a bare registry target, `name@<spec>` for a version, range or tag, and
  `git-<slug>-<sha256(target)[0..12]>` for a Git target (`github:owner/repo#ref`, `git+…`, `git://`, `owner/repo`, and
  a plain hosted URL such as `https://github.com/owner/repo`).
- **`<generation>`** is a numeric install. The newest generation wins unless a sibling `<generation>.rejected` file
  exists; then the newest generation without one is the installed copy.
- **`<name>`** is the package name for a registry target. For a Git target it is the first key of the generation root's
  `package.json` `dependencies`, falling back to the repository name in the target.

OpenCode reports a registry target as it is configured, including its `@spec`. The catalog reads the target's own cache
entry: `name@<spec>`, or `name@latest` when the host names no spec. If that entry is missing and the host reports no
installed version, the target is **not locatable** and is reported; it is never bound to another entry for the same
package, because that entry was installed for a different version, range or tag. When the host also reports a version,
the catalog may use an entry whose installed version is that version: it checks the target's entry first, then
`@latest`, the version's own entry, and every entry for the package name. A registry package whose installed name is
not the target is reported, never listed: a cache entry must not be bound to another package's manifest.

### What npm reads as a Git target

OpenCode's `parse` calls `npm-package-arg@13.0.2` (`@opencode/util@2.4.1` `dist/npm.js`, `parse` at :44). The catalog
follows it:

- a plain `https://github.com/owner/repo` (or GitLab, Bitbucket, a gist, or `git.sr.ht`) is `type: "git"`, so its cache
  key is `git-<slug>-<sha256(target)[0..12]>` exactly as for `git+https://github.com/owner/repo` or
  `github:owner/repo`; each raw spelling has its own 12-hex hash and the same slug;
- a hosted `ssh://` URL — `ssh://git@github.com/owner/repo.git`, `ssh://github.com/owner/repo.git`, and the same on
  GitLab, Bitbucket or a gist — is `type: "git"`; a non-hosted `ssh://` URL throws `Unsupported URL Type "ssh:"` in
  `npm-package-arg`, so the catalog still reports it as not a target;
- `git+…`, `git://` and `git@host:owner/repo` are Git on any host;
- a non-hosted `https://…` URL, a `.tgz` and a repository page such as `https://github.com/owner/repo/blob/main/x.js`
  are `type: "remote"`, which OpenCode does not install; the catalog reports them as not an npm or Git package target.

Checked against `npa("https://github.com/owner/repo").type === "git"` and
`npa("https://example.com/demo.tgz").type === "remote"` with that parser.

`cacheDirectory` names the OpenCode cache directory, the one that holds `npm/`. It defaults to
`<XDG_CACHE_HOME or ~/.cache>/opencode`:

```ts
const listing = await listInstalledPlugins(ctx, { cacheDirectory: "/home/ana/.cache/opencode" })
```

A host that installed a plugin elsewhere, such as a linked checkout, passes `resolve` instead; it wins over the cache:

```ts
const listing = await listInstalledPlugins(ctx, {
  resolve: (target) => (target === "@example/demo" ? "/home/ana/src/demo" : undefined),
})
```

`listInstalledPlugins` never throws for a plugin's own package. A failed plugin, a missing package, a registry package
whose version is not the one the host names, or a manifest that does not validate is reported in `problems`, and every
other plugin is still listed. Manifests are read with `readInstalledManifest`, so there is one parser, one validator
and one hash.

Each listed plugin carries the host's `target` beside the `InstalledManifest` fields (`package`, `version`,
`directory`, `manifest`, `hash`). Two targets that resolve to the same directory are one entry.

### The host shape

`CatalogHost` is written structurally, so a plugin passes `ctx` as it is; the `@opencode/plugin` types stay out of the
published declarations. It needs `plugin.list()` and nothing else.

## The broker

A broker is a thin layer a host builds over the same library. It adds a persistent cache keyed by the provider identity
from `probe` plus `(source, account, scope, params, window)`, per-person budgets and cadence, and an audit line per read
with no content. The host holds the grants it drew consent for and may only narrow them. It never advances a consumer's
cursor and never transforms an answer.

The consumer passes the transport, from a channel it already trusts. It is one function:

```ts
type BrokerTransport = (request: BrokerRequest, signal?: AbortSignal) => Promise<BrokerAnswer>
```

Never find a broker by asking over RPC: an RPC id has no owner in OpenCode, so another plugin could answer in the
broker's name.

### The request

`brokerRequest(readRequest)` builds it from a read. Every field is a reference or the read itself; the manifest and the
grant never cross the wire.

| Field | Meaning |
|---|---|
| `consumer` | who reads, such as `notes`. **This is the grant key**, and the broker's audit line |
| `package` | the installed package the consumer read its manifest from |
| `version` | that package's installed version |
| `manifestHash` | the `sha256:…` hash the consumer consented under |
| `source` | the source id, such as `slack.mentions` |
| `account` | the account alias, or the default account |
| `scope` | the confirmed scope, in canonical form |
| `cursor`, `since`, `limit` | an events read; `since` may be relative |
| `pick` | a snapshot's selected paths; a broker may apply it to send less, and the client applies it again |

`package`, `version` and `manifestHash` describe the **source**. They are not the consumer's: a broker looks up the
grant by `consumer`, compares the version and hash with its own installed copy, and refuses a read made under another
declaration with `PERMISSION_DENIED` (issue #8).

A broker reading a request from an untrusted channel checks it first:

```ts
import { isBrokerRequest } from "@we-the-rebel-alliance/plugin-contract/catalog"

if (!isBrokerRequest(body)) return { offered: true, ok: false, code: "INPUT_INVALID", message: "…" }
```

`isBrokerRequest` refuses unknown keys and requires a non-empty `consumer`: a request without one cannot be served,
because the consumer is the grant key. It requires `manifestHash` to be `sha256:` followed by 64 hex characters, and
checks the optional fields' types.

### The answer

| Answer | Meaning |
|---|---|
| `{ offered: false }` | no broker now; the client reads embedded for this request |
| `{ offered: true, ok: true, value, asOf?, cached? }` | `value` is the plugin's answer, untransformed |
| `{ offered: true, ok: false, code, message, next?, retryAfterSec? }` | a refusal, read through the error table |

### The client

```ts
import { sourceReader } from "@we-the-rebel-alliance/plugin-contract/catalog"

const reader = sourceReader({ host, broker: transport })
const outcome = await reader.read(request)
outcome.via // "broker" or "embedded"
```

`sourceReader` makes the pre-call checks an embedded read makes before it asks anything: the source is declared, the
person has not turned it off, the grant is this consumer's for the installed manifest hash, the scope is within the
grant and the inputs suit the source's kind. It leaves a relative `since` to the broker, which resolves it in the
person's time zone. It then:

1. reads embedded when no broker is passed, the broker says `{ offered: false }`, the transport throws, or the answer is
   not a broker answer;
2. passes a refusal through the error table, with no embedded read behind the broker's back;
3. checks an `ok: true` value as an embedded read does: the account, `trust: "untrusted"`, the size against `maxBytes`,
   the events page or the output schema, then `pick`.

A brokered read does not ask for thumbnails (#42): the #8 request shape predates them. A broker therefore never needs to
be trusted for shape, and a refused read is never retried elsewhere.

## Negative cases

| Case | What happens |
|---|---|
| A plugin the host reports as failed | reported in `problems` with the host's error and reference, never listed |
| A single-file local plugin | reported: it has no `package.json` manifest |
| A package target with no installed package | reported in `problems`, never thrown |
| A package with no manifest, or one that does not validate | reported in `problems` with the validator's paths |
| A registry package whose version is not the host's | reported in `problems` |
| A spec target whose own cache entry is missing, with no host version | reported in `problems`; never another entry for the package |
| A non-hosted `https://…` URL, or a tarball | reported: not an npm or Git package target |
| A registry package whose installed name is not the target | reported in `problems`, never listed |
| A grant for another manifest hash | `PERMISSION_DENIED` before the broker is asked |
| Another consumer's read | `PERMISSION_DENIED` before the broker is asked |
| The broker is off | the read runs embedded over the consumer's own host |
| A broker refusal | passed through the error table; no embedded read follows |

## Exports

| Export | Does |
|---|---|
| `listInstalledPlugins`, `CatalogHost`, `CatalogOptions`, `CatalogListing`, `CatalogPlugin`, `CatalogProblem`, `HostPlugin`, `HostPluginState` | `listInstalledPlugins(host, options?)`: installed manifests, validated and hashed, and the packages that could not be read |
| `brokerRequest`, `isBrokerRequest`, `BrokerRequest` | `brokerRequest(read)` builds the one request, keyed on `consumer`; `isBrokerRequest(value)` checks a request from an untrusted channel |
| `isBrokerAnswer`, `BrokerAnswer`, `BrokerTransport` | a broker's answer and the one transport function a consumer passes |
| `sourceReader`, `SourceReader`, `ReaderOutcome` | `sourceReader({ host, broker? })`: broker first when offered, embedded otherwise, with `via` on the outcome |

The listing's `hash` is the same hash `readInstalledManifest` gives and a grant stores. A changed manifest changes the
hash, so the person is asked again.
