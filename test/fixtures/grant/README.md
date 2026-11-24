# Action-grant fixtures

Six synthetic vectors for the `grant` verifier: `valid`, `expired`, `replayed`, `digest-mismatch`, `wrong-aud` and
`bad-signature`.

They were produced once, on 24 November 2026, by a one-off script calling `signGrant` with a freshly generated Ed25519
key. The private key was discarded immediately; only the public key (`public-key.pem`) is kept here. No token belongs
to a real host, plugin or person, and none verifies against one.

Each `<name>.json` records:

| Field | Meaning |
|---|---|
| `token` | The compact token, signed once and never regenerated |
| `input` | The exact input the verifier is given |
| `request` | The plugin's expected `act`, `actions`, `audience`, `consumer`, `capability`, `account`, `scope`, `manifest` and `now` |
| `store.used` | The `jti` values already in the ledger before the call |
| `expect` | `{ ok: true, kid, claims }` or `{ ok: false, code }` |

`test/grant-fixtures.test.ts` runs every vector and fails if one of the six names is missing. To add a vector, sign a
token in a one-off host harness with a throwaway key, copy its public key here if the key is new, and never commit a
private key.
