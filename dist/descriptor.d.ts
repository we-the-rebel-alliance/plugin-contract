import type { Checked } from "./internal/checked.js";
/** The most bytes a source may declare for one answer (1 MB), and the default when it declares none (64 KB): `events`' `MAX_BYTES`. */
export declare const MAX_BYTES_LIMIT: number;
export declare const DEFAULT_MAX_BYTES: number;
/** Who may be asked, and how (design §2.2 `permission`): Memory's schema type, so there is one definition (#30, item 8). */
export type SourcePermission = Permission;
/** A detail read, a declared read per event whose inputs come only from the event's own fields: Memory's schema type (#30, item 8). */
export type SourceDetail = Detail;
/** One source a plugin declares: Memory's schema type, the one `SourceItem` the package exports (#30, item 8). */
export type { SourceItem } from "./internal/schema/types.js";
import type { Detail, Permission, SourceItem } from "./internal/schema/types.js";
/** The `sources` key. */
export interface SourcesDescriptor {
    readonly contractVersion: number;
    /** The plugin's tools-RPC id, `<OpenCode plugin id>.tools` (#4). Optional; when declared, `read` calls it. */
    readonly rpc?: string;
    /** The plugin's one `probe` tool: the permission action it asserts (#4, #8). Optional. */
    readonly probe?: {
        readonly action: string;
    };
    readonly items: readonly SourceItem[];
}
/** A descriptor as read from an installed package. */
export interface InstalledDescriptor {
    /** The package's name and version, from the same package.json. */
    readonly package: string;
    readonly version: string;
    /** The package's directory on disk. */
    readonly directory: string;
    readonly sources: SourcesDescriptor;
    /** `sha256:` and the hex digest of the canonical JSON of `sources`. */
    readonly hash: string;
}
/** The event fields a detail read may take its input from (Memory's schema): identifiers and metadata, never `title` or `text`. */
export declare const DETAIL_FIELDS: readonly ["external_id", "kind", "occurred_at", "url", "thread", "actors", "labels", "hash"];
/** The `sources` value checked against Memory's schema, then the frame; its problems, one sentence each, when it breaks them. */
export declare function checkSources(value: unknown): Checked<SourcesDescriptor>;
/** Canonical JSON: object keys sorted at every depth, no spaces. Arrays keep their order. */
export declare function canonicalJson(value: unknown): string;
/** The descriptor's hash: `sha256:` and the hex digest of its canonical JSON. Key order does not change it. */
export declare function descriptorHash(value: unknown): string;
/**
 * The descriptor of the package installed at `directory`: its package.json's `sources`, checked and hashed. With
 * `version`, the package.json must say that version, so a consumer reads the package it believes is installed.
 */
export declare function readInstalledDescriptor(directory: string, options?: {
    readonly version?: string;
}): Checked<InstalledDescriptor>;
/**
 * The directory of the package `name` as Node would find it installed from `from`: the nearest
 * `node_modules/<name>/package.json` at or above it. Undefined when none is installed.
 */
export declare function findInstalledPackage(name: string, from: string): string | undefined;
/** A source by id, from a descriptor. */
export declare function findSource(descriptor: SourcesDescriptor, id: string): SourceItem | undefined;
/** The most bytes one answer of this source may take: its `maxBytes`, or 64 KB. */
export declare function maxBytesOf(source: {
    readonly maxBytes?: number | undefined;
}): number;
