/**
 * Permission: the exact OpenCode session rules a grant allows (contract §6 and §13).
 *
 * Every read runs in a session limited to these rules. OpenCode checks each inner tool call a plugin makes against the
 * calling session's rules, and the last matching rule wins, so the rules are a deny of everything, then one allow per
 * action and resource the source declares:
 *
 *   [{ action: "*", resource: "*", effect: "deny" },
 *    { action: "gws.events_list", resource: "*", effect: "allow" },
 *    { action: "gws.read", resource: "ana@example.com:gmail.users.messages.list", effect: "allow" }, …]
 *
 * The method's action is allowed on `*`, because the tools RPC resolves a method before dispatch on `*`. Each
 * operation is allowed as the conformance kit reads it (`operationRule`): a dotted operation as `<namespace>.read` on
 * `<account>:<operation>`, and a bare one, an MCP tool, as `<server>_<operation>` on `*`, where the server is the
 * plugin's name for the `default` account and `<plugin>-<alias>` for any other (§5: MCP tools are
 * `<name>-<alias>_<tool>`). The namespace is the source id's first segment.
 *
 * The broker and a project may only narrow these rules, and the plugin's own `access` setting stays final.
 */
import type { Checked } from "./internal/checked.js";
import type { ActionItem, Manifest, SourceItem } from "./manifest.js";
/** One OpenCode permission rule, as a session or an agent holds it. */
export interface PermissionRule {
    readonly action: string;
    readonly resource: string;
    readonly effect: "allow" | "deny" | "ask";
}
/**
 * A person's grant: one consumer may read one source, for one account, within one scope (contract §6 and §13).
 */
export interface Grant {
    /** Who reads: a consumer, such as `notes` or `notes.home`, or an app with its viewer. */
    readonly consumer: string;
    /** The source id. */
    readonly source: string;
    /** The account the person confirmed. */
    readonly account: string;
    /** The scope the person confirmed, by scope key: channel ids, label names. Absent for a source without a scope. */
    readonly scope?: Readonly<Record<string, readonly string[]>>;
    /** The manifest hash the person consented to; a changed manifest asks again. */
    readonly manifestHash: string;
    /** The person turned this binding off: a read answers SOURCE_DISABLED, which is not an error state. */
    readonly disabled?: boolean;
}
/**
 * A person's grant for one action: one consumer may preview and commit one action, for one account, against the
 * manifest hash they consented to. The same shape as a read grant, for an action id.
 */
export interface ActGrant {
    /** Who acts: a consumer, such as `notes`, or an app with its viewer. */
    readonly consumer: string;
    /** The action id. */
    readonly action: string;
    /** The account the person confirmed. */
    readonly account: string;
    /** The manifest hash the person consented to; a changed manifest asks again. */
    readonly manifestHash: string;
    /** The person turned this binding off. An action then answers SOURCE_DISABLED, the table's existing code. */
    readonly disabled?: boolean;
}
/** Which call a fenced action session allows. Preview never allows the commit action. */
export type ActPhase = "preview" | "commit";
/** The first rule of every fenced session: nothing is allowed that a later rule does not allow. */
export declare const DENY_ALL: PermissionRule;
/**
 * An account a rule may name: no wildcard (`*`, `?`), no `:` (it separates account and operation), no whitespace or
 * control character, at most 320 characters. A wildcard here would widen the grant to other accounts.
 */
export declare const ACCOUNT_PATTERN: RegExp;
/** Why `account` cannot be named in a rule, or undefined when it can. */
export declare function accountProblem(account: unknown): string | undefined;
/** A source's namespace: its id's first segment, which every action of the source begins with. */
export declare function namespaceOf(source: Pick<SourceItem, "id">): string;
/** The account the default MCP server serves: its tools are `<namespace>_<tool>`, the plugin's own name. */
export declare const DEFAULT_ACCOUNT = "default";
/** An account that may stand in a per-account server's name: a tool id's characters only. */
export declare const SERVER_ACCOUNT_PATTERN: RegExp;
/**
 * The MCP server a bare operation of the plugin runs on for `account` (§5): the plugin's namespace for `default`, and
 * `<namespace>-<account>` for any other alias (`list_files` is `plugin_list_files` for `default` and
 * `plugin-work_list_files` for `work`). The same rule as `accounts/names.ts`, derived here so permission has no import
 * cycle.
 */
export declare function serverOf(namespace: string, account: string): string;
/**
 * The rule that allows one operation for `account`: a dotted operation as `<namespace>.read` on
 * `<account>:<operation>`, a bare one (an MCP tool) as `<server>_<operation>` on `*`. The same derivation as the
 * conformance kit, so declared equals asserted means the same thing in a plugin's CI and in a consumer's session.
 */
export declare function operationRule(source: Pick<SourceItem, "id">, operation: string, account: string): PermissionRule;
/** The method action a source's read asserts: `<namespace>.<method>`. */
export declare function methodAction(source: SourceItem): string;
/**
 * The session rules for reading `source` under `grant`: deny everything, then allow the method and each declared
 * operation for the granted account. Refused when the grant is for another source or its account cannot be named in a
 * rule.
 */
export declare function sessionRules(source: SourceItem, grant: Pick<Grant, "source" | "account">): Checked<readonly PermissionRule[]>;
/**
 * The session rules for one phase of `act` under `grant`: deny everything, then allow that phase's action and each
 * declared operation for the granted account. A preview session allows the preview action and not the commit action,
 * so the commit method cannot run while previewing. Operations are derived like a source's (`operationRule`).
 */
export declare function actSessionRules(manifest: Manifest, act: Pick<ActionItem, "id" | "preview" | "commit">, grant: Pick<ActGrant, "action" | "account">, phase: ActPhase): Checked<readonly PermissionRule[]>;
/**
 * The session rules for one detail read of `source` under `grant`: the source's own rules, plus the detail's declared
 * method. Refused when the source declares no such detail.
 */
export declare function detailRules(source: SourceItem, detailId: string, grant: Pick<Grant, "source" | "account">): Checked<readonly PermissionRule[]>;
/**
 * The session rules for the source's `probe` on `account`: deny everything, then allow the probe's action and its
 * identity operations. That a probe reads no content is the kit's check of its answer.
 */
export declare function probeRules(source: SourceItem, account: string, identityOperations: readonly string[], probeAction?: string): Checked<readonly PermissionRule[]>;
/**
 * How OpenCode decides an action on a resource under `rules`: the last rule whose action and resource match wins (`*`
 * matches any run of characters and `?` one), and no match asks. The same evaluation the tools RPC runs.
 */
export declare function evaluate(rules: readonly PermissionRule[], action: string, resource?: string): PermissionRule["effect"];
/** True when `grant` covers a read of `source` for `account` within `scope`: the same source and account, and every scope value granted. */
export declare function grantCovers(grant: Grant, request: {
    readonly source: string;
    readonly account: string;
    readonly scope?: Readonly<Record<string, readonly string[]>>;
}): boolean;
