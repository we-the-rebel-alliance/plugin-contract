# Action grants

A host signs an action grant when a person confirms a write in the host's UI and no agent session is asking. The grant
says: *this one action, with exactly this input, for this consumer, capability, account, scope and manifest, until this
moment, once.* A plugin verifies it with `verifyGrant` and spends it through a durable store.

This page is the published format and the verifier's contract: contract §§8, 12, 13 and 15, roadmap item 1.8, and
issue #40. The module is `@we-the-rebel-alliance/plugin-contract/grant`; it does no I/O and never reads a clock.

## The shape of a grant

A grant is a compact, JWS-like token: three base64url segments, no padding, separated by dots.

```
<header>.<claims>.<signature>
```

The signature is Ed25519 over the ASCII bytes of `<header>.<claims>`, exactly as they appear in the token. This is not
a JWT: the header has exactly three members, the claims are the ones below, and there is no `nbf`, `iss` or `sub`.
Anything else is refused rather than ignored, so a host and a plugin cannot read two different meanings from one token.

The header is exactly:

```json
{ "alg": "Ed25519", "kid": "host-2026-11", "typ": "plugin-contract-act+jwt" }
```

| Member | Rule |
|---|---|
| `alg` | Exactly `Ed25519`. No other algorithm, and no "try the key as HMAC": the key itself must be an Ed25519 public key. |
| `kid` | The key id, 1–64 characters of letters, digits, `.`, `_` and `:`, starting with a letter or a digit. |
| `typ` | Exactly `plugin-contract-act+jwt`. |

The claims are exactly these and no others:

| Claim | Meaning | Rule |
|---|---|---|
| `aud` | The app or audience the grant is for | Non-empty text, at most 200 characters, no control characters |
| `consumer` | The grant key (contract §14): who the grant was issued to | Same text rule |
| `capability` | The `<name>.<capability>` or method id | Same text rule |
| `account` | The account alias | `^[a-z][a-z0-9_]{0,31}$` (contract §5) |
| `scope` | What the capability reads or changes | A canonical scope object (see below) |
| `act` | The action id, `<name>.<action>` | Same text rule as `capability` |
| `digest` | The exact input digest | `sha256:` and 64 lowercase hex digits |
| `manifest` | The manifest hash | `sha256:` and 64 lowercase hex digits |
| `iat` | When the host signed, in whole seconds since the Unix epoch | A non-negative safe integer |
| `exp` | When the grant stops being valid, in whole seconds since the Unix epoch | A non-negative safe integer, after `iat` |
| `jti` | The single-use key | 1–128 characters of letters, digits, `.`, `_` and `:` |
| `cfm` | A person confirmed this action and input | Present only as `true`; see "Confirmation" |

`exp` is exclusive: a grant is valid while `now < exp`. There is no grace period after `exp`; a clock that runs behind
the signer's refuses a grant early, which is the safe direction. `iat` may run at most `clockSkewSec` (default 30)
ahead of the verifier's clock. A grant's lifetime, `exp - iat`, must be positive and at most `maxLifetimeSec` (default
300); a plugin may lower that, never raise it past 86,400.

The limits are fixed in the published format:

| Limit | Value |
|---|---|
| Compact token | At most 8,192 characters, all three segments included |
| Canonical input | At most 65,536 bytes of UTF-8 |
| Nesting | At most 16 objects or arrays inside one another |
| Claim text (`aud`, `consumer`, `capability`, `act`) | At most 200 characters |
| Scope key or value | At most 200 characters |
| Clock skew | Default 30 seconds, at most 3,600 |
| Grant lifetime | Default and recommended 300 seconds, at most 86,400 |

The claims are signed; the token is not encrypted. It holds no secret, but it is a bearer capability until `exp` (the
store makes it single-use), so do not log the token itself.

## Threat model

| Threat | What stops it | Code |
|---|---|---|
| Someone writes their own grant | Ed25519 signature checked with a trusted public key | `GRANT_SIGNATURE_INVALID` |
| A token says `alg: none` or an HMAC algorithm | The header must say `Ed25519`, and the trusted key must be Ed25519 | `GRANT_UNSUPPORTED_ALGORITHM` |
| A grant is replayed | The `jti` is spent through a durable store, after every other check | `GRANT_REPLAYED` |
| The input is swapped after signing | The digest of the exact canonical input is bound in the claims | `GRANT_DIGEST_MISMATCH` |
| The input cannot be canonicalised identically twice | Numbers must be safe integers, strings must be well-formed Unicode, nesting and size are capped | `GRANT_INPUT_INVALID` |
| A grant for one action is used for another | `act` is compared with the requested action | `GRANT_ACTION_MISMATCH` |
| A grant for one app, consumer, capability, account, scope or manifest is used for another | Every binding is compared | `GRANT_AUDIENCE_MISMATCH`, `GRANT_CONSUMER_MISMATCH`, `GRANT_CAPABILITY_MISMATCH`, `GRANT_ACCOUNT_MISMATCH`, `GRANT_SCOPE_MISMATCH`, `GRANT_MANIFEST_MISMATCH` |
| A grant outlives its moment | `iat`, `exp` and the lifetime cap, against the injected `now` | `GRANT_NOT_YET_VALID`, `GRANT_EXPIRED`, `GRANT_LIFETIME_INVALID` |
| A write happens without a person's confirmation | The action's confirmation rule, checked against `cfm` | `GRANT_CONFIRMATION_REQUIRED`, `GRANT_CONFIRMATION_INVALID` |
| A header carries a member the verifier ignores | The header is exactly `alg`, `kid`, `typ` | `GRANT_MALFORMED` |
| A claimed key is unknown or retired | The `kid` must name a trusted key and not a revoked one; there is no "try every key" | `GRANT_KEY_UNKNOWN` |
| A bad token crashes the plugin or its store | Every refusal is a value; a throwing store is a refusal | `GRANT_MALFORMED`, `GRANT_STORE_UNAVAILABLE` |
| A short-lived grant is kept alive by a clock trick | `now` is injected by the plugin, never read by this module; the window is capped | `GRANT_EXPIRED`, `GRANT_LIFETIME_INVALID` |

Out of scope: a compromised host private key (revoke its `kid` and rotate), a compromised plugin process (it must
treat input as untrusted anyway), a store that lies, and a person who confirms the wrong thing. The grant proves the
host signed *this* action and input for *this* binding at *this* time, once. It does not prove the provider call is a
good idea.

## Canonical input and digest

The grant binds the input's **canonical JSON** digest, not the input itself. The plugin digests the exact input it is
about to run, so a change of one byte of meaning changes the digest.

A grant input is JSON, and only JSON:

- `null`, a boolean, a string, a safe integer, an array, or a plain object;
- a number must be a safe integer (`Number.isSafeInteger`); `1.5`, `NaN`, `Infinity`, `2 ** 53` and a bigint are
  refused, never rounded or written in another form;
- a string must be well-formed Unicode: a lone surrogate is refused, never replaced;
- at most 16 objects or arrays may nest inside one another;
- the canonical JSON may be at most 65,536 bytes of UTF-8.

The canonical text is deterministic:

- object keys are sorted by UTF-16 code unit;
- arrays keep their order;
- strings are escaped exactly as `JSON.stringify` escapes them;
- safe integers are written in decimal, and `-0` is written `0` (JSON has one zero);
- there is no whitespace.

```ts
canonicalJson({ b: 1, a: [true, null, "x"] }) // '{"a":[true,null,"x"],"b":1}'
digestInput({ a: 2, b: 1 }) // 'sha256:d3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772'
```

A value outside these rules is **refused rather than digested** (`GRANT_INPUT_INVALID`). That is the point: two copies
of a verifier, or a host and a plugin, must never disagree about what bytes a digest covers. A value that cannot be
written canonically is not an input an action grant can cover; a caller with a `Date`, a `Map`, an `undefined`
property, a sparse array, an accessor or a class instance must turn it into JSON first.

`digestInput` and `canonicalJson` throw `GrantInputError` on such a value; `verifyGrant` catches it and answers
`GRANT_INPUT_INVALID`. `canonicalJson` is exported for a host that wants to show a person what will be digested.

## Scope

A scope is a flat object: each key maps to a non-empty string or a non-empty list of strings. The canonical form sorts
the keys, sorts each list and removes repeats, so order and repeats never matter:

```ts
canonicalScope({ b: ["y", "x", "x"], a: "z" }) // { a: "z", b: ["x", "y"] }
```

An omitted scope and `{}` are the whole source. An empty list is refused, because an omitted key ("all") and an empty
list ("none") would otherwise read the same. Keys and values are non-empty, at most 200 characters, with no control
characters and no lone surrogates. `__proto__` is reserved and refused.

The verifier canonicalises both the grant's scope and the expected scope before comparing them; a different set of
keys, a different value, or a string where the grant has a list is `GRANT_SCOPE_MISMATCH`.

## Keys: `kid`, rotation and revocation

The verifier trusts a map of key id to public key. It looks up exactly the `kid` in the header; it never tries every
key, and an unknown `kid` is `GRANT_KEY_UNKNOWN`. Revocation is checked before the signature: a `kid` in `revoked` is
refused even while its public key is still in the map.

Key material is a `KeyObject`, a PEM string, or SPKI DER bytes. The key must be an Ed25519 public key: an RSA or EC key
is a configuration error (`GRANT_REQUEST_INVALID`), not a fallback algorithm. Loading a key file, a key store or a
secret manager is the plugin's job; this module never reads one.

To rotate:

1. Add the new public key under a new `kid` before the host starts signing with it.
2. Keep the old `kid` trusted until every grant it signed has expired (at most the plugin's `maxLifetimeSec`).
3. Remove the old key, or put its `kid` in `revoked` first if it may have been compromised.

A plugin holds public keys only. `signGrant` exists for the host (and for tests) and requires the Ed25519 private key
explicitly; it never reads one from a file or an environment variable. A plugin must not call it.

## The store and single use

Single use belongs to durable storage, not to this module and not to an in-memory `Map`. A restart that forgets a
spent `jti` would resurrect the grant, so the plugin backs this interface:

```ts
interface GrantStore {
  /** True when this call recorded the jti; false when it was already recorded. */
  consume(jti: string): Promise<boolean>
}
```

The store must implement an atomic insert-if-absent keyed by `jti`. Two verifier calls with the same grant at the same
moment must produce exactly one `true`; the other gets `false` and `GRANT_REPLAYED`. A unique constraint, a conditional
write or a transaction is the right shape; "select, then insert" is not. The store should record the first use even
though the grant's own `exp` will soon make pruning safe: after `exp`, the row may be deleted.

The verifier calls `consume` **last**, after the signature, every binding, the time window, the input digest and the
confirmation rule. A refusal before that point writes nothing. A store that throws, or answers anything other than
`true` or `false`, is `GRANT_STORE_UNAVAILABLE`: the action is refused, never run, and the plugin does not crash.

A sketch, with SQLite's insert-if-absent spelling:

```ts
const store: GrantStore = {
  async consume(jti) {
    const result = await db.run("INSERT OR IGNORE INTO action_grants (jti, first_used_at) VALUES (?, ?)", jti, Date.now())
    return result.changes === 1
  },
}
```

The store needs the `jti` only. A receipt that names the action, digest and time can be written beside it by the
plugin, from the verified claims, after `verifyGrant` answers `ok: true`.

## Confirmation

A non-`local` action needs a person's confirmation (contract §8). In an agent session that is a host permission ask,
which any client can answer. From an app's UI, with no agent, it is this grant: the host records the confirmation as
`cfm: true` in the claims.

The verifier takes each action's rule with the allowed actions:

```ts
type ConfirmationRule = "required" | "optional"
```

- `required`: `cfm` must be present and `true`; absent is `GRANT_CONFIRMATION_REQUIRED`, anything else is
  `GRANT_CONFIRMATION_INVALID`.
- `optional`: `cfm` may be absent or `true`; any other value is `GRANT_CONFIRMATION_INVALID`.

Map the plugin's manifest to the rule: an action whose `effect` is not `local` is `required`; a `local` action is
`optional`. The module does not decide that for the plugin, because the manifest is the plugin's own declaration.

`cfm` is a Boolean claim with exactly one accepted value. A host that signs `cfm: false`, `cfm: "always"` or
`cfm: 1` has not proven a confirmation, and the grant is refused.

## Codes

Every refusal has a precise code and the contract-facing `contractCode: "GRANT_INVALID"` (contract §12). A plugin
reports `GRANT_INVALID` and its own sentence; it may log the precise code. A reason is one line of at most 160
characters and names no value from the token or the input, so it is safe to log.

| Code | Meaning | What a plugin should say |
|---|---|---|
| `GRANT_REQUEST_INVALID` | The plugin's own request is wrong: no store, a bad expected hash, an unusable trusted key, an out-of-range limit | "The confirmation check is misconfigured. Next step: check the plugin's configuration and update it." |
| `GRANT_MALFORMED` | The token, its header or its base64url is not the published shape | "That confirmation cannot be read. Next step: confirm the action again." |
| `GRANT_UNSUPPORTED_ALGORITHM` | The header names an algorithm other than Ed25519 | "That confirmation uses an unsupported signature. Next step: update the host and the plugin." |
| `GRANT_KEY_UNKNOWN` | The `kid` is not trusted, or has been revoked | "That confirmation was signed with a key this plugin no longer trusts. Next step: confirm the action again." |
| `GRANT_SIGNATURE_INVALID` | The signature does not verify with the trusted key | "That confirmation's signature is not valid. Next step: confirm the action again." |
| `GRANT_CLAIMS_INVALID` | The claims are not the published shape | "That confirmation's contents cannot be read. Next step: update the host and the plugin." |
| `GRANT_ACTION_DISALLOWED` | The requested action is not one this verifier accepts | "That action is not one this plugin can confirm. Next step: pick an action the plugin declares." |
| `GRANT_ACTION_MISMATCH` | The grant is for another action | "That confirmation is for a different action. Next step: confirm this action again." |
| `GRANT_AUDIENCE_MISMATCH` | The grant is for another audience | "That confirmation is for a different app. Next step: confirm the action in this app again." |
| `GRANT_CONSUMER_MISMATCH` | The grant is for another consumer | "That confirmation is for a different consumer. Next step: confirm the action again." |
| `GRANT_CAPABILITY_MISMATCH` | The grant is for another capability | "That confirmation is for a different capability. Next step: confirm the action again." |
| `GRANT_ACCOUNT_MISMATCH` | The grant is for another account | "That confirmation is for a different account. Next step: confirm the action for this account again." |
| `GRANT_SCOPE_MISMATCH` | The grant is for another scope | "That confirmation is for a different selection. Next step: confirm the action again." |
| `GRANT_MANIFEST_MISMATCH` | The grant is for another manifest hash | "That confirmation was for another version of this plugin. Next step: confirm the action again." |
| `GRANT_DIGEST_MISMATCH` | The input is not the input the grant signed | "That confirmation was for different input. Next step: confirm the action again." |
| `GRANT_INPUT_INVALID` | The input is outside the canonical rules and cannot be digested | "That input cannot be confirmed safely. Next step: simplify the input, then confirm again." |
| `GRANT_NOT_YET_VALID` | `iat` is ahead of the verifier's clock beyond the skew | "That confirmation is not valid yet. Next step: check the clocks, then confirm again." |
| `GRANT_LIFETIME_INVALID` | The lifetime is zero, negative or over the accepted maximum | "That confirmation has an invalid lifetime. Next step: confirm the action again with a short-lived grant." |
| `GRANT_EXPIRED` | `now` is at or past `exp` | "That confirmation has expired. Next step: confirm the action again." |
| `GRANT_CONFIRMATION_REQUIRED` | The action requires `cfm` and the grant has none | "That action needs a person's confirmation. Next step: confirm it in the app." |
| `GRANT_CONFIRMATION_INVALID` | `cfm` is present but is not `true` | "That confirmation cannot be read. Next step: confirm the action again." |
| `GRANT_REPLAYED` | The store has already recorded this `jti` | "That confirmation has already been used. Next step: confirm the action again." |
| `GRANT_STORE_UNAVAILABLE` | The store threw or answered something other than true or false | "The confirmation could not be recorded. Next step: try again later; if it keeps failing, check the plugin's status." |

The contract-facing message keeps the family's form:

```
GRANT_INVALID: That confirmation has expired. Next step: confirm the action again.
```

## Check order

The verifier answers the first refusal and never goes further:

1. the request is well formed, and the requested action is allowed and has a confirmation rule;
2. the token is three canonical base64url segments, and the header is exactly `alg`, `kid`, `typ`;
3. the `kid` is trusted and not revoked;
4. the Ed25519 signature verifies over the exact header and claims segments;
5. the claims are a JSON object with exactly the published claims and values;
6. `aud`, `consumer`, `capability`, `account`, `scope`, `manifest`, then `act` match the request;
7. the lifetime is positive and within the maximum, `iat` is not ahead, `exp` is not past;
8. the input canonicalises and its digest is `digest`;
9. the confirmation rule holds;
10. the store records the `jti` for the first time.

A failure at any step before 10 writes nothing to the store. A positive answer means the store recorded the grant.

## Example

```ts
import { verifyGrant, type GrantStore } from "@we-the-rebel-alliance/plugin-contract/grant"

const outcome = await verifyGrant({
  grant: token, // the compact token the host sent
  input, // the exact input this call will run with, before validation changes it
  act: "demo.mail.send",
  actions: { "demo.mail.send": "required" }, // from the manifest's action effect
  keys: { keys: { "host-2026-11": publicPem }, revoked: [] },
  audience: "app:mail",
  consumer: "consumer:mail",
  capability: "demo.mail.send",
  account: "work",
  scope: { label: ["INBOX"] },
  manifest: "sha256:…", // the installed manifest's hash
  now: Math.floor(Date.now() / 1000), // the plugin reads the clock, not the module
  store, // the plugin's durable ledger
})

if (!outcome.ok) {
  // outcome.code is precise; outcome.contractCode is GRANT_INVALID
  return { code: "GRANT_INVALID", message: `GRANT_INVALID: ${sentenceFor(outcome.code)}` }
}
// Run the action with the exact input, and record the receipt from outcome.claims.
```

`verifyGrant` is asynchronous because the store is. It never throws for a bad grant, a bad input or a store failure: a
refusal is an `ok: false` value. `signGrant` is the host's side and throws on an invalid request; a plugin never calls
it.

## What this module does not do

- It reads no file, no network, no environment and no clock. `now`, the keys and the store are arguments.
- It does not load or watch key files, and it does not implement the store. A key-file reader belongs to the host or
  the plugin; a durable ledger belongs to the plugin.
- It does not decide an action's confirmation rule. The plugin maps its manifest's `effect` to `required` or
  `optional`.
- It does not run the action, validate the action's input against its JSON Schema, or emit events. Those are the
  plugin's `register` and handler work.
- It does not make a grant confidential. Do not log the token; treat it as a bearer capability until `exp`.
