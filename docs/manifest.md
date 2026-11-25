# The manifest

A plugin declares what it can do in one top-level `capabilities` key in its `package.json` (contract §4). Apps, the
catalog and the conformance kit read it **from the installed package on disk**, validate it strictly and hash it.
Nothing said over RPC is trusted as a manifest: an RPC id has no owner, so another plugin could answer in its name.

```json
{
  "name": "@we-the-rebel-alliance/example-plugin",
  "version": "0.0.0",
  "capabilities": {
    "version": 1,
    "plugin": {},
    "options": {},
    "methods": {},
    "sources": [],
    "actions": [],
    "events": {}
  }
}
```

`@we-the-rebel-alliance/plugin-contract/manifest` exports the schema, the validator, the hash and the helpers:

```ts
import { checkManifest, manifestHash, readInstalledManifest, findSource } from "@we-the-rebel-alliance/plugin-contract/manifest"

const checked = readInstalledManifest("/path/to/node_modules/@we-the-rebel-alliance/example-plugin", { version: "0.0.0" })
if (checked.ok) {
  checked.value.manifest            // the validated capabilities value
  checked.value.hash                // "sha256:…": a grant stores it, so a changed manifest asks again
  findSource(checked.value.manifest, "example.messages")
}
```

## The shape

Only these keys are the manifest's own. Any other key is refused, except `x-<app>`: an app-only hint that every other
app ignores and no app may require.

| Key | Required | Meaning |
|---|---|---|
| `version` | yes | The wire version. Exactly `1` in v0. Independent of the package's semver. |
| `plugin` | yes | Identity, title, summary, vendor, icons, and the OpenCode range with its tested releases. |
| `accounts` | no | How accounts work (§5). Absent: the plugin signs in to nothing. |
| `options` | yes | JSON Schema 2020-12 of the plugin's options. Must include `access`. |
| `methods` | yes | Every callable, including pass-through MCP tools. |
| `sources` | yes | The reads an app can bind to. May be empty for a tools-only plugin. |
| `actions` | yes | The writes an app can offer a person. May be empty. |
| `events` | yes | The bus events the plugin emits. |
| `x-<app>` | no | App-only hints. Never required, never read by another app. |

### `plugin`

```json
{
  "name": "example",
  "title": "Example",
  "summary": "Messages, channels and files.",
  "vendor": { "id": "example", "name": "Example Inc.", "domain": "example.com" },
  "icons": [{ "src": "assets/icon.svg", "type": "image/svg+xml" }],
  "host": { "opencode": ">=2.4.1 <2.5.0", "tested": ["2.4.1"] }
}
```

- `name`: 1–31 lowercase letters or digits, **no hyphen**. A hyphen separates an account alias, and everything derives
  from the name: repository, package, tool namespace, RPC id, permission actions, capability ids, integrations, MCP
  servers and bus events (contract §3).
- `title`, `summary`: what a person reads.
- `vendor`: the provider's stable id, name and main domain. No scheme or path in `domain`.
- `icons`: at least one; `src` is a path inside the installed package.
- `host`: `opencode` is exactly `>=2.4.1 <2.5.0` in v0, and `tested` includes `2.4.1` (D7). Outside the range a plugin
  refuses to start with `HOST_UNTESTED`, unless `allowUntestedHost` is set. `hostInRange(version)` is the one predicate;
  `assertHost(ctx, manifest)` in `register` reads it and throws the refusal.

### `accounts`

```json
{
  "via": "integration",
  "profile": { "$ref": "#/options/properties/accounts/additionalProperties" },
  "owner": "mailto"
}
```

- `via`: `integration` (the plugin holds the credentials), `mcp` (the vendor's MCP server holds them, with its own
  OAuth) or `local` (one account, the machine's identity).
- `profile`: a JSON-Schema `$ref` into `options`, pointing at the profile schema every alias is checked against. Optional.
- `owner`: the scheme a probe's owner id uses, such as `mailto`.

When `accounts` is present, `options` must declare `accounts` with an `additionalProperties` schema and must include
`access`. See [accounts](accounts.md).

### `options`

```json
{
  "type": "object",
  "properties": {
    "access": { "type": "string", "enum": ["all", "ask-changes", "read-only"], "default": "all" },
    "accounts": { "type": "object", "additionalProperties": { "type": "object", "properties": { "region": { "type": "string" } } } },
    "allowUntestedHost": { "type": "boolean", "default": false }
  }
}
```

A JSON Schema 2020-12 object. It must include `access`; it must include `accounts` when `accounts` is declared; it may
include `allowUntestedHost`. Plugin-specific options follow. Titles and descriptions double as form labels. The
validator also checks that zod can read the schema (`z.fromJSONSchema`), so a consumer never has to interpret a schema
this package cannot.

### `methods`

One table covers every callable, so a consumer knows how risky a call is before the plugin runs.

```json
{
  "status": { "class": "read", "accounts": "none" },
  "probe": { "class": "read", "accounts": "optional", "operations": ["example.users.get"] },
  "events_list": { "class": "read", "accounts": "optional" },
  "plan_send": { "class": "read", "plans": true, "accounts": "optional" },
  "send_message": { "class": "send", "commits": "plan_send", "accounts": "optional", "operations": ["example.messages.create"] },
  "mcp:*": { "class": "read" }
}
```

| Field | Meaning |
|---|---|
| `class` | `read`, `write`, `send`, `share`, `delete`, `export` or `admin`. Required. |
| `accounts` | `optional` when the method takes an `account`, `none` when it does not. Defaults to `none`. |
| `operations` | The provider operations the method may assert, for grants and session rules. |
| `plans` | `true` for a method that dry-runs a change; the register mints its `planId`, and the plan commits once, only through that method. |
| `commits` | The planning method this method commits. It then takes only `{ planId }`. |
| `effect` | A narrowing of `access`: `ask` or `deny`, never `allow`. |
| `pinned` | `true` for the one method Code Mode sends on every turn. |

Rules:

- `status` is required on every plugin; `probe` is required on every plugin that declares `accounts` (§11).
- A `commits` target exists, declares `plans: true`, and is not the method itself. A method cannot both plan and commit.
- At most one method has `pinned: true`. None by default. A pin is allowed only when session data shows most of a
  plugin's sessions call it, and its signature stays within about 1,000 tokens.
- `delete_*` and `remove_*` are class `delete`; `send_*` and `post_*` are class `send`; `share_*` is class `share`
  (contract §16, joe-broadhead/opencode-linear#28). The rule applies to contract method names, not to `mcp:<tool>`.
- Pass-through MCP tools are declared as `mcp:<tool>` or `mcp:*` and keep the vendor's case (`mcp:getJiraIssue`). Two tool names that normalise to the same effective OpenCode action (`files.delete` and `files_delete`), or that differ only in case (OpenCode's matcher is case-insensitive on Windows), are refused at both names.

### `sources`

A source is an events feed with a cursor, or a snapshot of the latest state.

| Field | Kind | Meaning |
|---|---|---|
| `id` | both | `<plugin>.<capability>`, such as `example.messages`. The first segment is the plugin's name. |
| `kind` | both | `events` or `snapshot`. |
| `method` | both | The declared method that reads it. |
| `input` | both | The fixed input that selects it, such as `{ "source": "messages" }`. |
| `service` | both | `{ id, label }`: what a person turns on and off. Sources with one id share one label (#44 item 1). |
| `operations` | both | The provider operations its reads assert. |
| `scope` | both | `{ keys, describe, suggest? }`: what a person confirms. `suggest.method` is a declared read that lists values. |
| `cadence` | both | `{ providerMinMinutes?, suggestMinutes? }`. |
| `signals` | both | How it can nudge: `bus`, `mcp-events`, `webhook`. |
| `private` | both | Everything it reads is personal. Shown at consent. |
| `cost` | both | `{ class: free \| metered \| billed, units? }`. A metered or billed source states its price units. |
| `maxBytes` | both | The most bytes one answer may take: default 64 KB, at most 1 MB. |
| `details` | events | Follow-up reads of one event: `{ id, method, from }`, where `from` names only identifying event fields. |
| `facts` | events | The fact types its events carry. |
| `hints` | events | Hint files the package ships, relative paths ending in `.md`. |
| `urlHosts` | both | The hosts an event's `url` and `thumbnail` may point at. |
| `reads` | events | A core event kind (`message`, `meeting`, `session`, `bookmark`, `issue`, `pr`, `commit`, `doc`, `event`, `task`, `file`) or `x-<plugin>/<kind>`. |
| `thumbnails` | events | `true` when the source can answer `thumbnail` (#42). Requires `urlHosts`. |
| `output` | snapshot | A registry output name (`agenda`, `inbox`, `metric`, `list`, `progress`, `note`, `links`, `countdown`, `image`, `thread`, `table`, `record`) or `x-<plugin>/<name>`. |

`details[].from` may name `external_id`, `kind`, `occurred_at`, `url`, `thread`, `actors`, `labels` or `hash`. It never
names `title` or `text`, so item text cannot choose what is read next.

### `actions`

```json
{
  "id": "example.messages.send",
  "effect": "notify",
  "preview": "plan_send",
  "commit": "send_message",
  "input": { "type": "object" },
  "output": { "type": "object" }
}
```

- `id`: `<plugin>.<action>`.
- `effect`: `local`, `notify` (reaches someone), `spend` (costs money) or `irreversible`.
- `preview`, `commit`: two **different** declared methods. The preview writes nothing.
- `input`, `output`: JSON Schema 2020-12.

### `events`

Only `changed`, `status` and `account` are the manifest's bus events (contract §10). Each is declared with an empty
object; the data's shape is the contract's.

```json
{ "changed": {}, "status": {}, "account": {} }
```

## Validation and error paths

`checkManifest(value)` returns `{ ok: true, value }` or `{ ok: false, problems }` where every problem names its path from
`capabilities`:

```
capabilities.methods.send_message.class: a send_* or post_* method must be class send
capabilities.methods.send_message.commits: "plan_send" does not declare plans: true
capabilities.sources[0].thumbnails: a source that declares thumbnails must declare urlHosts
capabilities.options.properties.access: the options schema must include access
capabilities.extra: is not a key the manifest defines; app-only hints use x-<app>
```

`manifestProblems(value)` is the same list, or `[]`. `readInstalledManifest(directory, { version? })` reads the installed
`package.json`, checks the version when one is named, validates `capabilities` and hashes the declared value. Its problems
name the package and version first.

## Canonical hashing

The hash is `sha256:` and the hex digest of the **canonical JSON** of `capabilities`:

- object keys are sorted by UTF-16 code unit at every depth;
- arrays keep their order;
- an object member whose value is `undefined` is left out; `undefined` inside an array becomes `null`;
- strings use JSON's escaping; numbers must be finite; `-0` is written `0`.

Key order cannot change a hash; any value can. `canonicalJson(value)` and `manifestHash(value)` are exported. A grant
stores the hash, so moving a source to another service, renaming a method or changing a thumbnail declaration is a real
change for consent.

## Built-in declarations

### `service` (#44 item 1)

A person turns off Gmail or Calendar, not the whole plugin. Sources with the same `service.id` are one service; every
one of them uses the same `label`, at most 64 characters. A source with no `service` means the plugin is one service
named after itself. The service is part of the hash.

### `methods`: `plans` and `commits` (#44 item 2)

`plans: true` says the method dry-runs a change. `commits: "<method>"` says this method commits that exact plan, and a
consumer refuses any input but `{ planId }`. The validator checks the target exists, plans, and is another method.

### `owner.orgs` (#44 item 2)

A probe address answers `owner: { id, label, verified?, orgs? }`. `orgs` names at most five organizations the provider
says the account belongs to, each `{ id, label }` with a scheme-qualified id (`domain:example.com`,
`slack-team:T0123`). A consumer checks its allow list against the ids; it never parses the owner's own id. `verified:
false` on the owner covers its `orgs` too. `ownerProblems(owner)` and `ownerOrgProblems(orgs)` are exported, and the
probe-answer check uses them.

### `thumbnail` (#42)

An events source may declare `thumbnails: true`, and must then declare `urlHosts`. A read asks for thumbnails with
`thumbnails: true`; only such a source accepts it. An event then carries `thumbnail` when the item has one. It is
never `null`, is left out when not asked for, and stays **outside `eventHash`**: how an item looks is not what it says,
a rotating CDN link does not edit the item, and one item keeps one hash. `thumbnailUrlProblems(url, urlHosts)` checks
that a URL is:

- `https:`, at most 2048 characters;
- free of user info, a query string and a fragment, so it cannot carry a signature or a token;
- on a host that matches one of the source's `urlHosts` (`*.cdn.example` matches subdomains, not the bare domain).

## A complete example

```json
{
  "version": 1,
  "plugin": {
    "name": "example",
    "title": "Example",
    "summary": "Messages, channels and files.",
    "vendor": { "id": "example", "name": "Example Inc.", "domain": "example.com" },
    "icons": [{ "src": "assets/icon.svg", "type": "image/svg+xml" }],
    "host": { "opencode": ">=2.4.1 <2.5.0", "tested": ["2.4.1"] }
  },
  "accounts": {
    "via": "integration",
    "profile": { "$ref": "#/options/properties/accounts/additionalProperties" },
    "owner": "mailto"
  },
  "options": {
    "type": "object",
    "properties": {
      "access": { "type": "string", "enum": ["all", "ask-changes", "read-only"], "default": "all" },
      "accounts": {
        "type": "object",
        "additionalProperties": { "type": "object", "properties": { "workspace": { "type": "string" } } }
      },
      "allowUntestedHost": { "type": "boolean", "default": false }
    }
  },
  "methods": {
    "status": { "class": "read", "accounts": "none" },
    "probe": { "class": "read", "accounts": "optional", "operations": ["example.users.get"] },
    "events_list": { "class": "read", "accounts": "optional" },
    "events_detail": { "class": "read", "accounts": "optional", "operations": ["example.messages.get"] },
    "list_channels": { "class": "read", "accounts": "optional", "operations": ["example.channels.list"] },
    "plan_send": { "class": "read", "plans": true, "accounts": "optional" },
    "send_message": { "class": "send", "commits": "plan_send", "accounts": "optional", "operations": ["example.messages.create"] },
    "mcp:*": { "class": "read" }
  },
  "sources": [
    {
      "id": "example.messages",
      "kind": "events",
      "reads": "message",
      "method": "events_list",
      "input": { "source": "messages" },
      "service": { "id": "example.chat", "label": "Chat" },
      "operations": ["example.messages.list", "example.messages.get"],
      "scope": { "keys": ["channels"], "describe": "Channels to read.", "suggest": { "method": "list_channels" } },
      "cadence": { "providerMinMinutes": 1, "suggestMinutes": 2 },
      "signals": ["bus", "webhook"],
      "private": true,
      "cost": { "class": "free" },
      "maxBytes": 262144,
      "details": [{ "id": "example.messages.thread", "method": "events_detail", "from": ["thread"] }],
      "urlHosts": ["files.example.com"],
      "thumbnails": true
    },
    {
      "id": "example.channels",
      "kind": "snapshot",
      "output": "list",
      "method": "list_channels",
      "service": { "id": "example.chat", "label": "Chat" },
      "operations": ["example.channels.list"],
      "cost": { "class": "free" }
    }
  ],
  "actions": [
    {
      "id": "example.messages.send",
      "effect": "notify",
      "preview": "plan_send",
      "commit": "send_message",
      "input": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] },
      "output": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }
    }
  ],
  "events": { "changed": {}, "status": {}, "account": {} },
  "x-example": { "placement": "sidebar" }
}
```

`x-example` is an app-only hint: another app ignores it, and the conformance kit reads only its name.

## Exports

| Export | Does |
|---|---|
| `MANIFEST_SCHEMA`, `MANIFEST_VERSION`, `OPENCODE_RANGE`, `TESTED_OPENCODE`, `checkManifest`, `manifestProblems`, `readInstalledManifest`, `findInstalledPackage`, `canonicalJson`, `manifestHash` | the schema, the validator, the installed read and the canonical hash |
| `findAction`, `findMethod`, `findSource`, `maxBytesOf`, `methodAccounts`, `hostInRange`, `MAX_BYTES_DEFAULT`, `MAX_BYTES_LIMIT`, `PLUGIN_NAME`, `SERVICE_ID_MAX`, `SERVICE_LABEL_MAX`, `OWNER_ORGS_LIMIT`, `THUMBNAIL_URL_MAX`, `EXTENSION_KEY` | the lookups, the host-range predicate and the published limits |
| `ACTION_EFFECTS`, `ACCOUNT_MECHANISMS`, `BUS_EVENTS`, `COST_CLASSES`, `DETAIL_FIELDS`, `METHOD_ACCOUNTS`, `METHOD_CLASSES`, `METHOD_EFFECTS`, `SOURCE_KINDS`, `SOURCE_SIGNALS`, `SCHEME_QUALIFIED`, `hostMatches`, `thumbnailUrlProblems`, `ownerProblems`, `ownerOrgProblems` | the closed sets and the checks built on them |
| `ActionEffect`, `ActionItem`, `AccountMechanism`, `AccountsInfo`, `BusEvent`, `Cadence`, `Cost`, `CostClass`, `Detail`, `DetailField`, `HostRange`, `Icon`, `InstalledManifest`, `JsonSchema`, `Manifest`, `ManifestEvents`, `MethodAccounts`, `MethodClass`, `MethodEffect`, `MethodItem`, `Owner`, `OwnerOrg`, `PluginInfo`, `Price`, `Scope`, `Service`, `SourceEvents`, `SourceItem`, `SourceKind`, `SourceSignal`, `SourceSnapshot`, `Suggest`, `Vendor` | the manifest's types |
