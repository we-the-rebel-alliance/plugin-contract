# `audit`

`audit` builds the evidence an auditor asks for: what each installed plugin may read and do for one person, and the
grant behind each declaration (contract §6, §7, §8 and §13). It is an app-side module: it reads the catalog's installed
manifests and the person's grant records, and answers a plain value. `renderAuditReport` turns that value into
deterministic Markdown.

```js
import { auditReport, renderAuditReport } from "@we-the-rebel-alliance/plugin-contract/audit"

const report = auditReport({
  person: "ana@example.com",
  installed: listing.plugins,             // CatalogPlugin[], or InstalledManifest[]
  options: { "@we-the-rebel-alliance/harbour-plugin": { access: "read-only" } },
  grants: [
    { ...readGrant, person: "ana@example.com", grantedAt: "2026-11-20T10:00:00.000Z" },
    { ...actGrant, person: "ana@example.com", grantedAt: "2026-11-20T10:05:00.000Z" },
  ],
})

const markdown = renderAuditReport(report)
```

## The report

`AuditReport` is `{ person, plugins, problems }`. The report is plain data, so an app may store it or send it as JSON
and check it against `dist/schemas/audit.json` with `AUDIT_REPORT_SCHEMA`. It carries no credential, token or provider
value: only declarations and grant bindings.

Each entry in `plugins` names the package, its version, its manifest hash and the person's `access` level. It holds:

- `methods`: every method with its `class`, the manifest's declared `effect` when it has one, and what the access level
  gives it: `runs`, `asks first` or `off`. The last value comes from `effectFor`, the same rule the access levels use.
- `sources`: every declared source with its read `method`, `operations`, the `accounts` named by its grants, `private`
  and `cost`.
- `actions`: every declared action with its `preview` and `commit` methods, their `operations`, its confirmation rule
  and its grants.

A grant under a source or action is `{ consumer, account, scope, manifestHash, disabled, stale, person, grantedAt }`.
The `scope` is canonical: keys sorted and each list sorted without repeats. `stale` is true when the grant's manifest
hash is not the installed manifest's hash, so the person must consent again. `disabled` is true when the person turned
the binding off.

A grant whose plugin, source or action is not installed is never dropped and never thrown. It is listed under
`problems` with its target, the reason and the whole grant, so the evidence survives even when the plugin has gone.

## The input

`installed` accepts a `CatalogPlugin[]` from `listInstalledPlugins` or an `InstalledManifest[]`; `plugins` is an alias
for the catalogue's own list. The access level is read per plugin, keyed by package or plugin name, from `access` first
and then from `options[plugin].access`; both default to `all`. `access` may also be one level for every plugin.

Each record in `grants` is a read `Grant` or an `ActGrant` with `person` and `grantedAt` beside it, because the grant
types carry neither. A store that keeps the grant in its own row may wrap it as `{ grant, person, grantedAt }`.

## Markdown

`renderAuditReport(report)` writes one section per plugin: a methods table, a table of what it may read and a table of
what it may do. Every read or action row names the grant behind it: consumer, account, scope, granted at and granted by.
A stale or disabled grant is marked in its cell, and every entry under `problems` is marked as a problem at the end.

The output is deterministic: the same report makes the same bytes. Provider text is data, so a pipe or a newline in a
grant's scope is escaped and cannot break a table.

## Errors

`audit` has no error codes and does not throw for a grant that does not fit. An unmatched grant becomes a `problem`.
The report's own shape is checked with `AUDIT_REPORT_SCHEMA`, whose JSON Schema is `dist/schemas/audit.json`.

## Exports

| Export | Does |
|---|---|
| `AUDIT_REPORT_SCHEMA`, `auditReport`, `renderAuditReport` | the report's validator, `auditReport(input)` to build it, and `renderAuditReport(report)` to render it as Markdown |
| `AuditReport`, `AuditPlugin`, `AuditMethod`, `AuditSource`, `AuditAction`, `AuditGrant`, `AuditProblem`, `AuditInput` | the report, its plugin, method, source, action, grant and problem shapes, and the input |
| `AuditAccess`, `AuditConfirmation`, `AuditGrantRecord` | what a method runs as, an action's confirmation rule, and one of the person's grant records |
