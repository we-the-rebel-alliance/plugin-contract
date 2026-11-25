# `cursor`

The cursor codec for an events source (contract §7). A cursor is opaque base64url JSON of at most 1,024 characters,
bound to `(plugin, source, account, scope)`. A source includes it on every page; an app stores it and sends it back.
A cursor from another plugin, source, account or scope is refused as `foreign`, never restarted silently.

The binding hash catches mix-ups; it is not a signature. A source still checks the state it keeps inside the cursor, and
the grant — not the cursor — decides what may be read. See [events](events.md) for the page and the read.

```js
import { decodeBoundCursor, encodeBoundCursor } from "@we-the-rebel-alliance/plugin-contract/cursor"

const binding = { plugin: "example", source: "messages", account: "work", scope: { channels: ["C01"] } }
const cursor = encodeBoundCursor(binding, { last: "m_42" })
decodeBoundCursor(binding, cursor) // { ok: true, state: { last: "m_42" } }
decodeBoundCursor({ ...binding, account: "personal" }, cursor) // { ok: false, reason: "foreign" }
```

A binding's `scope` in canonical form has its keys sorted, each list sorted and without repeats, and a one-value list
kept as a list. That is the form the cursor's binding and a cache key agree on; the `read` module uses the same
`canonicalScope` for the scope it sends.

## Exports

| Export | Does |
|---|---|
| `encodeBoundCursor` | a cursor for a binding and the source's own state; throws on a reserved key or one over 1,024 characters |
| `decodeBoundCursor` | the state for a binding, or `malformed` / `foreign` |
| `bindingHash` | the first 16 hex digits of SHA-256 over the canonical binding |
| `canonicalScope`, `Scope` | a scope in one canonical form, and the shape it accepts |
| `CursorBinding`, `DecodedCursor`, `CursorRefusal` | the binding, the decoded state, and why a cursor did not decode |
| `MAX_CURSOR_LENGTH`, `CURSOR_VERSION`, `RESERVED_STATE_KEYS` | the bound, the format version and the keys a source's state may not use |

Either refusal is `CURSOR_INVALID` to the caller. An app treats the cursor as opaque and saves it in the same
transaction as the page it accepts.
