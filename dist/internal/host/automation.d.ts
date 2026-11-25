/** The two OpenCode 2.4 hosts a plugin's tests run on. */
export type HostKind = "server" | "sdk";
/** A trigger, in the shape OpenCode 2.4's automation API takes. */
export type AutomationTrigger = {
    readonly type: "at";
    readonly at: string;
    readonly tz?: string | undefined;
} | {
    readonly type: "every";
    readonly every: string;
    readonly tz?: string | undefined;
} | {
    readonly type: "cron";
    readonly cron: string;
    readonly tz?: string | undefined;
} | {
    readonly type: "event";
    readonly server: string;
    readonly event: string;
    readonly args?: Readonly<Record<string, unknown>> | undefined;
};
/** An action, in the shape OpenCode 2.4's automation API takes. */
export type AutomationAction = {
    readonly type: "prompt";
    readonly prompt: string;
    readonly to?: {
        readonly session: string;
    } | {
        readonly subagent: string;
    } | undefined;
} | {
    readonly type: "code";
    readonly code: string;
    readonly args?: unknown;
} | {
    readonly type: "shell";
    readonly command: string;
};
/** What a test creates: the API's input, with the fields a release test needs. */
export interface AutomationSpec {
    readonly name: string;
    readonly trigger: AutomationTrigger;
    readonly action: AutomationAction;
    readonly tz?: string | undefined;
    readonly expires?: string | undefined;
}
/** The one automation call the harness uses. */
export interface AutomationApi {
    create(spec: AutomationSpec): Promise<{
        readonly id: string;
    }>;
}
/** A client's experimental surface, as much as the harness reads. */
export interface AutomationClient {
    readonly experimental?: {
        readonly automation?: AutomationApi | undefined;
        /** Removed in 2.4; present only on an older fake, so the harness can prove it is not called. */
        readonly schedule?: unknown;
    } | undefined;
}
/** The result of asking a host to run an automation. */
export type AutomationResult = {
    readonly status: "created";
    readonly id: string;
} | {
    readonly status: "skipped";
    readonly reason: string;
};
/** Where an automation runs. */
export interface AutomationHost {
    readonly kind: HostKind;
}
/**
 * Create an automation, or explain why this host cannot run one. `allowScheduler` is the scheduler override the
 * standard names: a test on the embedded host that supplies its own scheduler may create and run it.
 */
export declare function createAutomation(host: AutomationHost, api: AutomationApi, spec: AutomationSpec, options?: {
    readonly allowScheduler?: boolean | undefined;
}): Promise<AutomationResult>;
/** The 2.4 automation API from a client, or a `HOST_API_GONE` naming what to use instead. */
export declare function automationApi(client: AutomationClient): AutomationApi;
