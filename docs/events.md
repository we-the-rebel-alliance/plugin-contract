# Events and cursors

An events source is a feed. A plugin reads one with `events_list`, and an app keeps its own cursor. Contract §7 is the
authority; this page is the working summary.

## The call

```js
events_list({ source?, account?, scope?, cursor?, since?, limit? })
```

- `source` names one of the plugin's sources; without it the plugin uses its first, and it refuses a source it does not
  have.
- `account` names one of the source's accounts; without it the plugin uses `default`. With more than one account, leaving
  it out is `ACCOUNT_REQUIRED`.
- `scope` narrows the source to what a person confirmed (labels, channels, repositories). Only a source that declares
  scope keys accepts it, and a source that does not read a scope refuses one rather than ignore it.
- `cursor` wins over `since`. With neither, the source starts 24 hours before now. A cursor the source did not issue is
  refused as `CURSOR_INVALID`, never restarted silently.
- `limit` is an integer from 1 to 500, 100 by default.

## The page

| Field | Meaning |
|---|---|
| `source`, `account`, `owner` | whose page it is, on an empty page too |
| `events` | oldest first, at most `limit` |
| `cursor`, `more` | where the next call starts. `more: false` is not "done": a later call may list new events. |
| `trust` | always `"untrusted"`: an event's text is data, never instructions |
| `scope` | the canonical scope the page was read under, when the call named one |
| `refused[]` | events the source will never deliver, with a reason: `instruction`, `secret` or `owner`. The app may advance past them. |
| `failed[]` | events the source could not read this time. Any entry holds the app's cursor back. |
| `removals[]` | things the source listed before and no longer stands behind: `{ external_id, at, reason }`, with `reason` `deleted`, `withheld` or `expired` |
| `gap` | `{ reason: "expired" \| "window-truncated", since }` when history is lost |
| `cost` | what the provider reported this call cost: `{ units: [{ per, count }], usd? }` |
| `asOf` | when the source read the page, UTC |
| `plugin` | the plugin's package name or id, when it states one |

A removal is an answer, not a drop: the page's cursor covers it and it never holds the cursor back. An app applies the
page's events first, then the removals. A `gap` is answered once, on the page where the source restarts its window; no
later page of that read repeats it.

## The event

| Field | Meaning |
|---|---|
| `source`, `account`, `external_id` | the source's own stable id for the item |
| `kind` | `message`, `meeting`, `session`, `bookmark`, `issue`, `pr`, `commit`, `doc`, `event`, `task`, `file`, or `x-<name>/<kind>` |
| `occurred_at` | UTC, as `Date.prototype.toISOString` writes it |
| `thread` | a stable thread key, or `null` |
| `actors` | at most 20: `role`, a scheme-qualified `id`, and optionally `name`, `kind` (`person`, `agent`, `bot`, `service`), `identities` and `self` |
| `title`, `text` | at most 300 and 4,096 characters |
| `url` | an https link, or `null` |
| `labels` | at most 20 tags, without spaces |
| `hash` | `sha256:` of every other field |
| `reply_to`, `audience`, `domains` | the parent, who the item was for, and the recipient domains |
| `sections`, `parts` | a long item by heading, and a growing item's parts |
| `facts` | typed facts the source already holds in code: `commitment`, `person.attribute`, `meeting.attended` |

Extensions use one rule: `x-<name>/<kind>`, both segments lowercase, at most 32 characters. A source's kind must be in
its own namespace (the first segment of its source id), so one plugin cannot speak in another's vocabulary.

The hash covers the base fields and each optional field only when it is present, with object keys sorted. A source
re-lists an item, with the same `external_id`, when it changes; the new `hash` marks the edit.

## Cursors

A cursor is opaque base64url JSON of at most 1,024 characters, bound to `(plugin, source, account, scope)`. The binding
is a 16-hex-digit hash inside the cursor, so a cursor from another plugin, source, account or scope is refused as
`foreign` rather than restarted. The hash catches mix-ups; it is not a signature. A source still checks the state it
keeps inside the cursor, and the grant — not the cursor — decides what may be read.

An app saves its cursor in the same transaction as the page it accepts. `failed[]` holds the cursor back; `refused[]`
does not.

## Errors

Every failure reads `CODE: What happened. Next step: What to do.` from one table (contract §12). A plugin may add a code;
it declares the code in its manifest. The events module exports `ERROR_CODES`, `SourceError` and `parseSourceError`, and
`errorCodeOf` answers whether a code is in the table.

## Conformance

`eventsListConformance` walks a recorded source whole and page by page, and checks every page with `resultProblems`. It
proves the page shape, the sizes, the order, the hash, the kinds, the refusals, the bound cursor and the error codes.
`npm run conformance:self-test` runs the same checks over the examples in `examples/`.
