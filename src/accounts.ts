/**
 * `accounts`: profiles, names, registration, `account` resolution and status (contract §5).
 *
 *   const plan = accountsOf(manifest, options)            // every alias, its profile, its mechanism
 *   await registerAccounts(ctx, { manifest, options, auth }) // one integration or MCP server per alias
 *   const named = resolveAccount(plan.value.accounts, { account }) // the alias, or ACCOUNT_REQUIRED/UNKNOWN
 *   accountStatuses(plan.value.accounts, signals)        // one entry per alias
 *   statusAnswer({ manifest, version, hostVersion, accounts, unguardedAgents }) // the whole status answer
 *
 * OpenCode holds the credentials; this module only declares and names them. The mechanism is `integration` (the
 * plugin holds them), `mcp` (the vendor's MCP server holds them, with its own OAuth) or `local` (the machine's
 * identity).
 */
export { ALIAS_PATTERN, DEFAULT_ALIAS, aliasProblem, isAlias } from "./accounts/alias.ts"
export { accountLabel, accountName } from "./accounts/names.ts"
export { accountsOf, hasAccount, localIdentity } from "./accounts/profiles.ts"
export type { AccountProfile, AccountsPlan } from "./accounts/profiles.ts"
export { registerAccounts } from "./accounts/register.ts"
export type {
  AccountsContext,
  AccountsRegistration,
  IntegrationEditor,
  IntegrationMethodRegistration,
  MCPEditor,
  MCPServerConfig,
  RegisterAccountsRequest,
  RegisteredAccount,
} from "./accounts/register.ts"
export { aliasesSentence, resolveAccount } from "./accounts/resolve.ts"
export type { AccountCode, ResolvedAccount } from "./accounts/resolve.ts"
export { ACCOUNT_STATES, accountStatus, accountStatuses, NO_ACCOUNTS, REASON_MAX, redactReason, STATUS_SCHEMA, statusAnswer } from "./accounts/status.ts"
export type { AccountSignal, AccountState, AccountStatus, StatusAnswer, StatusInput } from "./accounts/status.ts"
