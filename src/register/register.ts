/**
 * `register`: doors 1–3 from one handler table (contract §9), plus the access rules that decide whether a method runs
 * (contract §6).
 *
 *   export default Plugin.define({
 *     id: "slack",
 *     setup: (ctx) => register(ctx, manifest, handlers),
 *   })
 *
 * `register` validates the handler table against the manifest's `methods`, resolves the accounts once, generates the
 * access rules into every agent, registers one tool per method in the plugin's namespace, registers one RPC id
 * `<name>` that carries the bus events, and returns the registration. `createBus(name, registration)` wraps it; a
 * plugin never calls `ctx.rpc.register` itself.
 *
 * A handler's input and answer are checked against its schemas, the account is resolved through `accounts`, provider
 * operations are asserted on `<alias>:<operation>`, and a failure is mapped to contract §12. A non-read method over
 * RPC additionally needs a permission ask or a valid action grant (LD-5); see `./rpc.ts`.
 */
import type { Plugin } from "@opencode/plugin"
import { accountsOf, type AccountProfile } from "../accounts.ts"
import type { Manifest } from "../manifest.ts"
import { applyAccess, type AccessContext, type AccessRegistration } from "../access/agents.ts"
import { installRpc, type GrantWiring, type RpcContext } from "./rpc.ts"
import { installTools, type ToolContext } from "./tools.ts"
import { prepare, type CallEnvironment } from "./invoke.ts"
import type { HandlerTable } from "./handlers.ts"
import { assertPluginName } from "../bus.ts"

/** The plugin context the register needs: `ctx`, as OpenCode passes it to `setup`, narrowed structurally. */
export interface RegisterContext {
  /** The plugin's options, from `opencode.json(c)`. */
  readonly options?: Readonly<Record<string, unknown>> | undefined
  readonly agent: AccessContext["agent"] & RpcContext["agent"]
  readonly tool: ToolContext["tool"]
  readonly session: RpcContext["session"]
  readonly permission: RpcContext["permission"]
  readonly rpc: RpcContext["rpc"]
}

/** What a plugin may wire into the register beyond the host context: the action-grant verifier. */
export interface RegisterWiring {
  readonly grant?: GrantWiring | undefined
}

/** The live registration: the bus wraps it, and disposing it removes the tools, the RPC id and the access rules. */
export interface Registration {
  readonly name: string
  readonly access: AccessRegistration
  readonly events: { emit(name: string, data: unknown): Promise<void> }
  dispose(): Promise<void>
}

/**
 * The host's context is assignable to this module's: checked at compile time, so a plugin passes `ctx` as it is, and
 * the host types stay out of the published declaration (`npm run check:dist`).
 */
const hostContextIsRegisterContext = (context: Pick<Plugin.Context, "agent" | "tool" | "session" | "permission" | "rpc" | "options">): RegisterContext => context
void hostContextIsRegisterContext

/** The accounts the manifest and options declare, refused as `OPTIONS_INVALID` when they cannot be read. */
function accountsFor(manifest: Manifest, options: Readonly<Record<string, unknown>>): readonly AccountProfile[] {
  const plan = accountsOf(manifest, options)
  if (!plan.ok) {
    throw new Error(`OPTIONS_INVALID: ${plan.problems.join("; ")}. Next step: fix the plugin's accounts option.`)
  }
  return plan.value.accounts
}

/** Run `action`, and dispose what already exists when it fails, so a setup error leaves nothing half-registered. */
async function withCleanup<T>(cleanup: readonly (() => Promise<void>)[], action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    for (const stop of [...cleanup].reverse()) await stop().catch(() => undefined)
    throw error
  }
}

/**
 * Wire the plugin's methods through doors 1–3 and generate its access rules.
 *
 * The table and the manifest must name the same methods; a declared method without a handler is refused at setup, as
 * is a handler the manifest does not declare. The returned registration is what `createBus` takes.
 */
export async function register(context: RegisterContext, manifest: Manifest, handlers: HandlerTable, wiring: RegisterWiring = {}): Promise<Registration> {
  const name = manifest.plugin.name
  assertPluginName(name)
  const options = context.options ?? {}
  const accounts = accountsFor(manifest, options)
  const access = await applyAccess(context, { manifest, options })
  if (access.problems.length > 0) {
    await access.dispose()
    throw new Error(access.problems.join("\n"))
  }
  return withCleanup([() => access.dispose()], async () => {
    const environment: CallEnvironment = prepare(manifest, handlers, accounts)
    const tools = await installTools(context, environment)
    return withCleanup([() => tools.dispose()], async () => {
      const rpc = await installRpc(context, environment, wiring.grant)
      return {
        name,
        access,
        events: rpc.events,
        async dispose() {
          await rpc.dispose().catch(() => undefined)
          await tools.dispose().catch(() => undefined)
          await access.dispose().catch(() => undefined)
        },
      }
    })
  })
}
