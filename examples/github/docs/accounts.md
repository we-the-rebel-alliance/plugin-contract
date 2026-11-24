# Accounts

Several aliases at once, each signed in separately.

<!-- generated:accounts -->
Accounts are held by the **integration** mechanism: the plugin holds the credentials.

| Field | Type | Required |
|---|---|---|
| `host` | string | no |
<!-- /generated:accounts -->

## Picking an account

Pass `account: "<alias>"` on a method that takes one. With two aliases and no account, the call is
refused with `ACCOUNT_REQUIRED`; an alias the plugin does not serve is `ACCOUNT_UNKNOWN`.
