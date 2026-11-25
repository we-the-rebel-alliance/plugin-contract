# `act`

The consumer side of a declared write (contract §8). A write is previewed, then committed. The preview writes nothing
and answers a plan id; the commit is the write, and it carries the host-signed action grant that the plugin's
`register` verifies. The host reads the plugin's `status` answer (contract §11), and its `status.accounts` supply the
aliases a preview fence may name; a caller cannot invent the list, and unavailable status is refused rather than
defaulted.

## What an act does

1. The act is declared, the grant is this consumer's for the act and the installed manifest hash, and the account
   matches.
2. A **preview** checks the caller's input against the act's input schema, then calls the action's preview method — the
   one declared `plans: true` — with the input, and with `account` only when that method is `accounts: "optional"`. The
   call runs in a session whose rules are exactly the preview's (`actSessionRules(…, "preview", …)`): the preview
   method and its operations, never the commit. The answer must be `trust: "untrusted"`, carry the act's `output` and a
   non-empty `planId`, and name the act's `commit` method. The `planId` is minted by the plugin's `register` with 128
   random bits: `act` carries it, and nobody can choose or guess it. `reaches` and `changes` are checked for one confirm
   screen.
3. A **commit** needs the `planId` the preview answered and a non-empty `grantToken`; either one missing is
   `PERMISSION_DENIED` before any call, and a commit that carries `input` is `SCHEMA_VIOLATION`. The commit calls the
   action's commit method — the one declared `commits: "<preview>"` — with exactly `{ planId }`, in the commit's own
   session fence (`actSessionRules(…, "commit", …)`), and sends `grant` and `consumer` in the RPC envelope. The
   commit's answer is checked like a preview's: `trust`, its size, `output` against the act's output schema, and its
   account.

The person confirms between the two calls. The host signs the grant with `signGrant` for the act's commit method, the
plugin's package as `audience`, the granted account and the exact `{ planId }` as its input, with `cfm: true` for a
non-`local` effect. `act` does not verify the grant and does not read `cfm`: the plugin's `register` does both. It also
does not touch the plan store; the register spends the plan once, and a `planId` from before a reload is `PLAN_INVALID`.

## Exports

| Export | Does |
|---|---|
| `act` | `act(host, request)` previews or commits an act under a grant; never throws for a refusal |
| `ActHost` | a `ReadHost`: sessions, the status read and the RPC call that may carry a grant |
| `ActRequest` | the action, grant, consumer, `phase`, the preview `input`, and the commit's `planId` and `grantToken` |
| `ActAnswer` | `{ trust, output, reaches?, changes?, cost?, account? }` |
| `ActPreview` | an `ActAnswer` plus the plan: `{ planId, method }` |
| `ActOutcome` | a preview, a commit, or a failure |
| `ActParty` | who a commit reaches: `{ id, label? }` |
| `ActGrant`, `ActPhase` | the grant and `"preview" \| "commit"`; the grant's `action` names the write |
| `ReadFailure` | the error table's failure, re-exported from `read` |

## Example

```js
import { randomUUID } from "node:crypto"
import { act } from "@we-the-rebel-alliance/plugin-contract/act"
import { signGrant } from "@we-the-rebel-alliance/plugin-contract/grant"

const preview = await act(host, { installed, action: "acme.save", grant, consumer: "notes", phase: "preview", input: { title: "Draft" } })
if (!preview.ok) throw new Error(preview.failure.message)

// The person confirms. The host signs one action grant for the commit method and exactly { planId }.
const planId = preview.preview.planId
const now = Math.floor(Date.now() / 1000)
const grantToken = signGrant({
  key: hostPrivateKey,
  kid: "host_2026_11",
  audience: "@acme/acme-plugin",
  consumer: "notes",
  capability: "acme.save_note",
  account: grant.account,
  act: "acme.save",
  input: { planId },
  manifest: installed.hash,
  iat: now,
  exp: now + 60,
  jti: randomUUID(),
  cfm: true,
})

const commit = await act(host, { installed, action: "acme.save", grant, consumer: "notes", phase: "commit", planId, grantToken })
if (!commit.ok) throw new Error(commit.failure.message)
```

`ActRequest.action` names the write on both calls. A commit without a plan id and a grant is refused before any call:
the preview and the host's signature are the two steps that make a write happen.
