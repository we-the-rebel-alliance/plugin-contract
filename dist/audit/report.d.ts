import { type AccessLevel, type ActGrant, type Grant } from "../access.js";
import type { Cost, InstalledManifest, MethodClass, MethodEffect } from "../manifest.js";
import type { Validator } from "../internal/checked.js";
/** What an access level gives one method: it runs, it asks first, or it is off. */
export type AuditAccess = "runs" | "asks first" | "off";
/** Whether an action needs a person's confirmation: every effect but `local` does (contract §8). */
export type AuditConfirmation = "required" | "none";
/** One piece of grant evidence under a source or action. It names no credential. */
export interface AuditGrant {
    /** Who reads or acts: the grant's consumer, such as `notes`. */
    readonly consumer: string;
    /** The account alias the person confirmed. */
    readonly account: string;
    /** The scope the person confirmed, with keys and list values in canonical order. */
    readonly scope: Readonly<Record<string, readonly string[]>>;
    /** The manifest hash the person consented to. */
    readonly manifestHash: string;
    /** The person turned this binding off. */
    readonly disabled: boolean;
    /** The grant's hash is not the installed manifest's hash, so the person must consent again. */
    readonly stale: boolean;
    /** Who gave the grant. */
    readonly person: string;
    /** When they gave it, ISO 8601. */
    readonly grantedAt: string;
}
/**
 * One of the person's grant records: a read `Grant` or an `ActGrant` with `person` and `grantedAt` beside it. A record
 * may also wrap the grant in `grant`, for a store that keeps the evidence in its own row.
 */
export type AuditGrantRecord = ((Grant | ActGrant) & {
    readonly person: string;
    readonly grantedAt: string;
}) | {
    readonly grant: Grant | ActGrant;
    readonly person: string;
    readonly grantedAt: string;
};
/** One method, its declared narrowing and what the person's access level makes of it. */
export interface AuditMethod {
    /** The method's name, as `capabilities.methods` keys it. */
    readonly method: string;
    readonly class: MethodClass;
    /** The manifest's own narrowing, when it declares one. */
    readonly effect?: MethodEffect | undefined;
    /** What the access level gives the method: `runs`, `asks first` or `off`. */
    readonly access: AuditAccess;
}
/** One source the plugin declares, with the grants behind it. */
export interface AuditSource {
    readonly id: string;
    /** The declared method that reads the source. */
    readonly method: string;
    /** The provider operations the source's reads assert. */
    readonly operations: readonly string[];
    /** The accounts the grants behind this source name, sorted. */
    readonly accounts: readonly string[];
    /** True when everything the source reads is personal. */
    readonly private: boolean;
    readonly cost: Cost;
    readonly grants: readonly AuditGrant[];
}
/** One action the plugin declares, with the grants behind it. */
export interface AuditAction {
    readonly id: string;
    /** The declared method that previews the action. */
    readonly preview: string;
    /** The declared method that commits the action. */
    readonly commit: string;
    /** The provider operations the preview and the commit assert. */
    readonly operations: readonly string[];
    /** The action's confirmation rule: every effect but `local` needs one. */
    readonly confirmation: AuditConfirmation;
    readonly grants: readonly AuditGrant[];
}
/** One installed plugin as the audit shows it. */
export interface AuditPlugin {
    readonly package: string;
    readonly version: string;
    readonly manifestHash: string;
    readonly access: AccessLevel;
    readonly methods: readonly AuditMethod[];
    readonly sources: readonly AuditSource[];
    readonly actions: readonly AuditAction[];
}
/** A grant whose plugin, source or action is not installed: kept, with the reason. */
export interface AuditProblem {
    readonly kind: "read" | "act";
    /** The grant's source id or action id. */
    readonly target: string;
    /** Why it is not in a plugin's table. */
    readonly reason: string;
    /** The grant itself, so the evidence is never lost. */
    readonly grant: AuditGrant;
}
/** What an auditor receives: one person, every installed plugin, and the grants that do not fit. */
export interface AuditReport {
    readonly person: string;
    readonly plugins: readonly AuditPlugin[];
    readonly problems: readonly AuditProblem[];
}
/** The report's input: the installed plugins, the person's access levels and grant records. */
export interface AuditInput {
    /** The person the report is about. */
    readonly person: string;
    /** The catalog's installed plugins (`CatalogPlugin[]` or `InstalledManifest[]`). */
    readonly installed?: readonly InstalledManifest[];
    /** An alias for `installed`, for a caller that names the catalogue's `plugins` list directly. */
    readonly plugins?: readonly InstalledManifest[];
    /** The person's grants, each with `person` and `grantedAt`. */
    readonly grants?: readonly AuditGrantRecord[];
    /**
     * The access level per plugin, keyed by package or plugin name. A single level applies to every plugin. The value
     * is `options.access`, and its default is `all`.
     */
    readonly access?: AccessLevel | Readonly<Record<string, AccessLevel | Readonly<Record<string, unknown>>>>;
    /** Each plugin's stored options, keyed by package or plugin name; `options.access` is read from here. */
    readonly options?: Readonly<Record<string, AccessLevel | Readonly<Record<string, unknown>>>>;
}
/** Build the audit report for one person. Never throws for a grant that does not fit: it goes to `problems`. */
export declare function auditReport(input: AuditInput): AuditReport;
/** The report's schema, published as `dist/schemas/audit.json`. */
export declare const AUDIT_REPORT_SCHEMA: Validator<AuditReport>;
