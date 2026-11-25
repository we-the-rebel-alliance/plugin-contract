# Accounts

Two aliases at once, held by the MCP mechanism: the vendor's MCP server keeps the OAuth credential, and OpenCode keys
it per server.

<!-- generated:accounts -->
Accounts are held by the **mcp** mechanism: the vendor's MCP server holds them.

| Field | Type | Required |
|---|---|---|
| `workspace` | string | no |
<!-- /generated:accounts -->

## Sign in per alias

| Alias | MCP server |
|---|---|
| `work` | `trellis-work` |
| `personal` | `trellis-personal` |

## Picking an account

Pass `account: "<alias>"` on a method that takes one. With two aliases and none named, the call is refused with
`ACCOUNT_REQUIRED`; an alias the plugin does not serve is `ACCOUNT_UNKNOWN`. A cursor issued for one alias is refused
for the other with `CURSOR_INVALID`.

## Per-alias tools

The vendor's pass-through tools are permitted per alias: `trellis-work_*` for `work` and `trellis-personal_*` for
`personal`. The derivation is the contract's `serverOf` and `toolAction`; the access rules derive one rule per alias,
so a rule for one alias cannot reach another alias's tool.
