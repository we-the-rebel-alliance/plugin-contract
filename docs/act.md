# `act`

The consumer side of a declared write (contract §8). A write is previewed, then committed. The preview writes nothing;
the commit is the write. A commit whose effect is not `local` needs a confirmation the host issued, either as an
OpenCode permission ask in a session or as a host-signed action grant. Every request carries `aliases`, the plugin's
declared account aliases from its options, so the fence refuses an undeclared account.

## What an act does

1. The act is declared, the grant is this consumer's for the act and the installed manifest hash, and the account
   matches.
2. A non-local commit without a confirmation is refused. The contract does not issue a confirmation and a
   caller-supplied token is not enough: the host's `issuedConfirmation` must accept it.
3. The caller's input is checked against the act's input schema before anything is called.
4. The call runs in a session whose rules are exactly that phase's (`actSessionRules`): a preview session allows the
   preview action and not the commit.
5. The answer is checked: `trust`, its size, `output` against the act's output schema, and `reaches`/`changes` for one
   confirm screen.

## Exports

| Export | Does |
|---|---|
| `act(host, request)` | previews or commits an act under a grant; never throws for a refusal |
| `ActHost` | a `ReadHost` plus optional `issuedConfirmation(check)` |
| `ActRequest` | the action, grant, consumer, `phase`, input and confirmation |
| `ActAnswer` | `{ trust, output, reaches?, changes?, cost?, account? }` |
| `ActOutcome` | a preview, a commit, or a failure |
| `ActParty` | who a commit reaches: `{ id, label? }` |
| `ActGrant`, `ActPhase` | the grant and `"preview" \| "commit"`; the grant's `action` names the write |

## Example

```js
import { act } from "@we-the-rebel-alliance/plugin-contract/act"

const preview = await act(host, { installed, action: "acme.save", grant, consumer: "notes", phase: "preview", input: { title: "Draft" } })
if (!preview.ok) throw new Error(preview.failure.message)

// The person confirms through the host's own issuer. The contract never issues a confirmation.
const confirmation = await askPerson(preview.preview)
const commit = await act(host, { installed, action: "acme.save", grant, consumer: "notes", phase: "commit", input: { title: "Draft" }, confirmation })
```

`ActRequest.action` names the write on a call, and the host's `issuedConfirmation` receives the same `action`, its
`effect`, `account` and `consumer`.

A host without an issuer can render a preview but cannot commit a non-local act. That is deliberate: the contract
verifies a confirmation, it never creates one.
