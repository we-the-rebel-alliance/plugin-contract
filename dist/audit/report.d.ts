import { type AccessLevel, type ActGrant, type Grant } from "../access.js";
import type { CatalogPlugin } from "../catalog.js";
import type { Validator } from "../internal/checked.js";
import { type Cost, type InstalledManifest, type MethodClass, type MethodEffect } from "../manifest.js";
/** The effect an access level and a method give a call, as an auditor reads it. */
export type AuditAccess = "runs" | "asks first" | "off";
/** One method a plugin declares, and the effect the person's level gives it. */
export interface AuditMethod {
    /** The method's name in the manifest, such as `events_list` or `mcp:*`. */
    readonly method: string;
    readonly class: MethodClass;
    /** The method's own narrowing, when it declares one. */
    readonly effect?: MethodEffect | undefined;
    /** What the person's access level gives it, from the same `effectFor` the access rules use. */
    readonly access: AuditAccess;
}
/** One grant behind a source or an action, as the report shows it. */
export interface AuditGrantBinding {
    /** Who the grant was issued to. */
    readonly consumer: string;
    /** The account alias the person confirmed. */
    readonly account: string;
    /** The confirmed scope, in canonical form: keys sorted, each list sorted and without repeats. */
    readonly scope: Readonly<Record<string, string | readonly string[]>>;
    /** The manifest hash the person consented to. */
    readonly manifestHash: string;
    /** The person turned the binding off. */
    readonly disabled: boolean;
    /** The person who gave the grant. */
    readonly person: string;
    /** When the person gave it, ISO 8601. */
    readonly grantedAt: string;
    /** The installed manifest's hash is not the one the grant names, so consent is stale. */
    readonly stale?: true | undefined;
}
/** One source a plugin declares, and every grant behind it. */
export interface AuditSource {
    readonly id: string;
    /** The declared method that reads the source. */
    readonly method: string;
    /** The provider operations the source's reads assert. */
    readonly operations: readonly string[];
    /** Whether the reading method takes an account. */
    readonly accounts: "optional" | "none";
    /** Everything the source reads is personal. */
    readonly private: boolean;
    /** What one read costs, as the manifest declares it. */
    readonly cost: Cost;
    readonly grants: readonly AuditGrantBinding[];
}
/** One action a plugin declares, and every grant behind it. */
export interface AuditAction {
    readonly id: string;
    /** The declared method that previews the action. It writes nothing. */
    readonly preview: string;
    /** The declared method that commits the action. */
    readonly commit: string;
    /** The operations the preview and commit methods declare, in declaration order and without repeats. */
    readonly operations: readonly string[];
    /** Whether the action always needs the person's confirmation. A non-`local` action does. */
    readonly confirmation: "required" | "optional";
    readonly grants: readonly AuditGrantBinding[];
}
/** One installed plugin, its declarations and the person's access level. */
export interface AuditPlugin {
    readonly package: string;
    readonly version: string;
    readonly manifestHash: string;
    readonly access: AccessLevel;
    readonly sources: readonly AuditSource[];
    readonly actions: readonly AuditAction[];
    readonly methods: readonly AuditMethod[];
}
/** A grant that names something the installed plugins do not declare, kept with its binding. */
export interface AuditProblem {
    /** What is missing, in one sentence. */
    readonly problem: string;
    readonly grant: AuditGrantBinding;
}
/** The evidence an auditor reads: one person, every installed plugin, and every grant that could not be placed. */
export interface AuditReport {
    readonly person: string;
    readonly plugins: readonly AuditPlugin[];
    readonly problems: readonly AuditProblem[];
}
/** A read grant with the person and moment the host keeps beside it; the grant types carry neither. */
export interface ReadGrantRecord extends Grant {
    readonly person: string;
    readonly grantedAt: string;
}
/** An action grant with the person and moment the host keeps beside it; the grant types carry neither. */
export interface ActGrantRecord extends ActGrant {
    readonly person: string;
    readonly grantedAt: string;
}
/** One of the person's grant records: a read grant or an action grant. */
export type AuditGrantRecord = ReadGrantRecord | ActGrantRecord;
/** What `auditReport` reads: the installed plugins, the person's access level per plugin, and their grants. */
export interface AuditInput {
    /** The person this report is for. */
    readonly person: string;
    /** `listInstalledPlugins`' plugins, or any installed manifests. */
    readonly plugins: readonly (InstalledManifest | CatalogPlugin)[];
    /** The `options.access` level by plugin name. A plugin not named here is `all`. */
    readonly access?: Readonly<Record<string, AccessLevel>> | undefined;
    /** The person's grant records; each carries the `person` and `grantedAt` the grant types do not. */
    readonly grants?: readonly AuditGrantRecord[] | undefined;
}
/** The audit report schema, published as `dist/schemas/audit.json`. */
export declare const AUDIT_SCHEMA: Validator<AuditReport>;
/**
 * Builds the audit report for one person: every installed plugin's sources, actions and methods under the person's
 * access level, with the grants behind each, and every grant that names something not installed in `problems`.
 */
export declare function auditReport(input: AuditInput): AuditReport;
