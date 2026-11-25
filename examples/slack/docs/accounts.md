# Accounts

Several aliases at once, each signed in separately.

<!-- generated:accounts -->
Accounts are held by the **mcp** mechanism: the vendor's MCP server holds them.

| Field | Type | Required |
|---|---|---|
| `workspace` | string | no |
<!-- /generated:accounts -->

## Picking an account

Pass `account: "<alias>"` on a method that takes one. With two aliases and no account, the call is
refused with `ACCOUNT_REQUIRED`; an alias the plugin does not serve is `ACCOUNT_UNKNOWN`.
