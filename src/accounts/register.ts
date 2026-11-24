/**
 * Registering a plugin's accounts with OpenCode 2.4.1 (§5).
 *
 * One `integration` per alias for a plugin that holds its credentials, or one vendor MCP server per alias for a plugin
 * whose vendor does, named by `accountName`. The plugin supplies what only it knows: the auth methods for an
 * integration, or the server config for an MCP server. Nothing here needs a real host: a synthetic context with two
 * `transform` functions is enough to test it.
 *
 * The transforms are cheap, synchronous and never throw: a failure is recorded in `problems` and shown in status.
 */
import type { Mcp, Plugin } from "@opencode/plugin"
import type { AccountMechanism, Manifest } from "../manifest/types.ts"
import type { AccountProfile } from "./profiles.ts"
import { accountsOf } from "./profiles.ts"
import { accountLabel, accountName } from "./names.ts"

/**
 * The editor inside `ctx.integration.transform`, as this module uses it. The host's own type is wider; the
 * compile-time proof below keeps this shape assignable to it.
 */
export interface IntegrationEditor {
  update(id: string, update: (integration: { id: string; name: string }) => void): void
  readonly method: { update(input: IntegrationMethodRegistration): void }
}

/** One auth method registration, as `editor.method.update` takes it. The host validates the method's own shape. */
export interface IntegrationMethodRegistration {
  readonly integrationID: string
  readonly [key: string]: unknown
}

/** The editor inside `ctx.mcp.transform`, as this module uses it. */
export interface MCPEditor {
  set(name: string, config: MCPServerConfig): void
}

/** One MCP server config, passed through to the host. */
export interface MCPServerConfig {
  readonly [key: string]: unknown
}

/**
 * The part of a plugin context registration uses: the two transforms, and nothing else. The editor is `unknown` here,
 * because the host's types are wider than this module needs; `registerAccounts` narrows each one.
 */
export interface AccountsContext {
  readonly integration: { readonly transform: (callback: (editor: unknown) => void) => Promise<unknown> }
  readonly mcp: { readonly transform: (callback: (editor: unknown) => void) => Promise<unknown> }
}

/**
 * The host's context is assignable to this module's: checked at compile time, so a plugin passes `ctx` as it is. The
 * `@opencode/plugin` types stay out of the published declarations (`npm run check:dist`).
 */
const hostContextIsAccountsContext = (context: Pick<Plugin.Context, "integration" | "mcp">): AccountsContext => context
type HostIntegrationEditor = Plugin.Context["integration"]["transform"] extends (callback: (editor: infer E) => void) => Promise<unknown> ? E : never
type HostRegistration = Parameters<HostIntegrationEditor["method"]["update"]>[0]
const hostRegistrationIsRegistration = (registration: HostRegistration): IntegrationMethodRegistration => registration
const hostServerConfigIsServerConfig = (config: Mcp.ServerConfig): MCPServerConfig => config
void [hostContextIsAccountsContext, hostRegistrationIsRegistration, hostServerConfigIsServerConfig]

/** What to register: the manifest, the plugin's options, and its own sign-in wiring. */
export interface RegisterAccountsRequest {
  readonly manifest: Manifest
  /** The plugin's options, including `accounts`. */
  readonly options?: Readonly<Record<string, unknown>> | undefined
  /** The auth methods for one integration, named by the id the account gets. */
  readonly auth?: ((account: AccountProfile, integrationID: string) => readonly IntegrationMethodRegistration[]) | undefined
  /** The MCP server config for one alias, named by the server the account gets. */
  readonly server?: ((account: AccountProfile, name: string) => MCPServerConfig) | undefined
}

/** One account as registered: its alias and the integration or server name it uses. */
export interface RegisteredAccount {
  readonly alias: string
  readonly name: string
}

/** What registration did, and what it could not. Never throws for a plugin's own wiring. */
export interface AccountsRegistration {
  readonly mechanism: AccountMechanism | undefined
  readonly accounts: readonly RegisteredAccount[]
  readonly problems: readonly string[]
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Registers every account through `ctx.integration.transform` or `ctx.mcp.transform`. A local plugin registers
 * nothing: its one account is the machine's identity.
 */
export async function registerAccounts(context: AccountsContext, request: RegisterAccountsRequest): Promise<AccountsRegistration> {
  const plan = accountsOf(request.manifest, request.options ?? {})
  if (!plan.ok) return { mechanism: request.manifest.accounts?.via, accounts: [], problems: plan.problems }
  const { mechanism, accounts } = plan.value
  if (mechanism === undefined) return { mechanism, accounts: [], problems: [] }
  const registered: RegisteredAccount[] = accounts.map((account) => ({ alias: account.alias, name: accountName(plan.value.plugin, account.alias) }))
  if (mechanism === "local") return { mechanism, accounts: registered, problems: [] }
  const problems: string[] = []
  if (mechanism === "integration") {
    if (request.auth === undefined) {
      return { mechanism, accounts: registered, problems: ["accounts: the integration mechanism needs auth methods for each alias"] }
    }
    try {
      await context.integration.transform((raw: unknown) => {
        const editor = raw as IntegrationEditor
        for (const account of accounts) {
          const id = accountName(plan.value.plugin, account.alias)
          try {
            editor.update(id, (integration) => {
              integration.name = accountLabel(request.manifest.plugin.title, account.alias)
            })
            for (const method of request.auth?.(account, id) ?? []) {
              editor.method.update({ ...method, integrationID: id })
            }
          } catch (error) {
            problems.push(`accounts.${account.alias}: the integration ${id} could not be registered: ${message(error)}`)
          }
        }
      })
    } catch (error) {
      problems.push(`accounts: the integration transform failed: ${message(error)}`)
    }
    return { mechanism, accounts: registered, problems }
  }
  if (request.server === undefined) {
    return { mechanism, accounts: registered, problems: ["accounts: the mcp mechanism needs a server config for each alias"] }
  }
  try {
    await context.mcp.transform((raw: unknown) => {
      const editor = raw as MCPEditor
      for (const account of accounts) {
        const name = accountName(plan.value.plugin, account.alias)
        try {
          editor.set(name, request.server!(account, name))
        } catch (error) {
          problems.push(`accounts.${account.alias}: the MCP server ${name} could not be registered: ${message(error)}`)
        }
      }
    })
  } catch (error) {
    problems.push(`accounts: the MCP transform failed: ${message(error)}`)
  }
  return { mechanism, accounts: registered, problems }
}
