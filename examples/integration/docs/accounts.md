# Accounts

Two aliases at once, held by the integration mechanism: OpenCode keeps the credentials, and the plugin registers its
key method on each integration.

<!-- generated:accounts -->
Accounts are held by the **integration** mechanism: the plugin holds the credentials.

| Field | Type | Required |
|---|---|---|
| `workspace` | string | no |
<!-- /generated:accounts -->

## Sign in per alias

| Alias | Integration |
|---|---|
| `work` | `harbour-work` |
| `personal` | `harbour-personal` |

## Picking an account

Pass `account: "<alias>"` on a method that takes one. With two aliases and none named, the call is refused with
`ACCOUNT_REQUIRED`; an alias the plugin does not serve is `ACCOUNT_UNKNOWN`. A cursor issued for one alias is refused
for the other with `CURSOR_INVALID`.
