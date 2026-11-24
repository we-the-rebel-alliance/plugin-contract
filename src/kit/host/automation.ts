/**
 * The second and third OpenCode 2.4 behaviours: the embedded `@opencode/sdk` host never runs automations, and
 * `experimental.schedule` is gone (automations are under `/api/experimental/automation`).
 *
 * A plugin test that needs a scheduled run uses the server host, or passes a scheduler override. The kit never calls
 * the removed client method: it routes every automation through `experimental.automation.create`, the 2.4 surface, and
 * names the replacement when a host lacks it.
 */
import type { HostKind } from "../host.ts"
import { KitError } from "../types.ts"

/** A trigger, in the shape OpenCode 2.4's automation API takes. */
export type AutomationTrigger =
  | { readonly type: "at"; readonly at: string; readonly tz?: string | undefined }
  | { readonly type: "every"; readonly every: string; readonly tz?: string | undefined }
  | { readonly type: "cron"; readonly cron: string; readonly tz?: string | undefined }
  | { readonly type: "event"; readonly server: string; readonly event: string; readonly args?: Readonly<Record<string, unknown>> | undefined }

/** An action, in the shape OpenCode 2.4's automation API takes. */
export type AutomationAction =
  | { readonly type: "prompt"; readonly prompt: string; readonly to?: { readonly session: string } | { readonly subagent: string } | undefined }
  | { readonly type: "code"; readonly code: string; readonly args?: unknown }
  | { readonly type: "shell"; readonly command: string }

/** What a test creates: the API's input, with the fields a release test needs. */
export interface AutomationSpec {
  readonly name: string
  readonly trigger: AutomationTrigger
  readonly action: AutomationAction
  readonly tz?: string | undefined
  readonly expires?: string | undefined
}

/** The one automation call the harness uses. OpenCode 2.4's `create` returns the whole automation; its `id` is enough. */
export interface AutomationApi {
  create(spec: AutomationSpec): Promise<{ readonly id: string }>
}

/** A client's experimental surface, as much as the harness reads. */
export interface AutomationClient {
  readonly experimental?:
    | {
        readonly automation?: AutomationApi | undefined
        /** Removed in 2.4; present only on an older fake, so the harness can prove it is not called. */
        readonly schedule?: unknown
      }
    | undefined
}

/** The result of asking a host to run an automation. */
export type AutomationResult =
  | { readonly status: "created"; readonly id: string }
  | { readonly status: "skipped"; readonly reason: string }

/** Where an automation runs: the two 2.4 hosts. */
export interface AutomationHost {
  readonly kind: HostKind
}

/**
 * Create an automation, or explain why this host cannot run one.
 *
 * `allowScheduler` is the scheduler override the standard names: a test on the embedded host that supplies its own
 * scheduler may create and run the automation; without it, the embedded host skips, because only `@opencode/server`
 * starts the scheduler.
 */
export async function createAutomation(
  host: AutomationHost,
  api: AutomationApi,
  spec: AutomationSpec,
  options: { readonly allowScheduler?: boolean | undefined } = {},
): Promise<AutomationResult> {
  if (host.kind === "sdk" && options.allowScheduler !== true) {
    return { status: "skipped", reason: "the embedded @opencode/sdk host never runs automations; only @opencode/server starts the scheduler" }
  }
  const created = await api.create(spec)
  return { status: "created", id: created.id }
}

/** The 2.4 automation API from a client, or a `KIT_API_GONE` naming what to use instead. */
export function automationApi(client: AutomationClient): AutomationApi {
  const api = client.experimental?.automation
  if (api === undefined || typeof api.create !== "function") {
    throw new KitError(
      "KIT_API_GONE",
      "this host has no experimental.automation API",
      "use OpenCode 2.4.1 or later; automations are created through /api/experimental/automation",
    )
  }
  return api
}

/** The removed 2.4 client method: calling it is refused, with the replacement in the message. */
export function legacySchedule(_client?: AutomationClient): never {
  throw new KitError(
    "KIT_API_GONE",
    "experimental.schedule is gone from OpenCode 2.4",
    "create the automation with ctx.experimental.automation.create, which posts to /api/experimental/automation",
  )
}
