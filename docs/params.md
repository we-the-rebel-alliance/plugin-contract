# `params`

What a read's inputs may say that only the reader can resolve (contract §7). A plugin receives plain values and never
resolves them itself.

- **Relative times**, in the person's time zone: `"now"`, or a signed whole number of minutes, hours, days or weeks,
  `"-90m"`, `"+2h"`, `"-7d"`, `"+1w"`. Minutes and hours are exact; days and weeks move the date in the person's time
  zone and keep the time of day. The result is UTC, rounded down to the minute, so every read within one minute sends
  the same input. At most 366 days either way.
- **Windows**, in the person's time zone: `"today"`, `"yesterday"` and `"tomorrow"`, each `{ since, until }` from
  midnight to midnight; or `{ since, until }` with each a relative or absolute time.
- **`$me`**: the signed-in account, as `probe` names its owner (`owner.id`).

Which params a snapshot source takes, and which may be relative or `$me`, its manifest says
(`"params": { "window": { "relative": true } }`). An events source's `since` may always be relative.

## Exports

| Export | Does |
|---|---|
| `resolveParams(declared, given, context)` | resolves a snapshot read's params, or names every problem |
| `resolveSince(since, context)` | resolves an events read's `since` |
| `resolveRelativeTime(value, context)` | one relative time, as a UTC ISO date-time |
| `resolveWindow(name, context)` | a named window, midnight to midnight |
| `ParamsContext` | `{ now, timeZone, me? }` |
| `ParamSpec` | `{ relative?, me? }`, as a manifest declares one param |
| `ME`, `WINDOWS`, `WindowName`, `ResolvedWindow` | the marker, the windows and their shapes |
| `MAX_RELATIVE_DAYS`, `isTimeZone` | the bound, and whether the runtime knows a zone |

## Example

```js
import { resolveParams, resolveSince } from "@we-the-rebel-alliance/plugin-contract/params"

const context = { now: new Date("2026-11-24T09:41:00Z"), timeZone: "Europe/Amsterdam", me: "mailto:sam@example.com" }

resolveSince("-1d", context)                         // { ok: true, value: "2026-11-23T09:41:00.000Z" }
resolveParams({ window: { relative: true } }, { window: "today" }, context)
// { ok: true, value: { window: { since: "2026-11-23T23:00:00.000Z", until: "2026-11-24T23:00:00.000Z" } } }
resolveParams({ owner: { me: true } }, { owner: "$me" }, context)
// { ok: true, value: { owner: "mailto:sam@example.com" } }
```

A param the source does not declare is refused, and so is `$me` where the param does not allow it.
