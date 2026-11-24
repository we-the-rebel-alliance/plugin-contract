import { type InstalledManifest } from "../manifest.js";
/**
 * One plugin as the host lists it: the part of `ctx.plugin.list()` the catalog reads. A package names its target; a
 * local plugin names its directory; a builtin or SDK plugin has no package manifest. A failed plugin is still listed,
 * because its failure belongs in the catalog's report.
 */
export interface HostPlugin {
    readonly id?: string;
    readonly state: HostPluginState;
    readonly source: {
        readonly type: "package";
        readonly target: string;
        readonly version?: string;
    } | {
        readonly type: "local";
        readonly path: string;
    } | {
        readonly type: "builtin";
    } | {
        readonly type: "sdk";
    };
}
/** The host's plugin state: loaded, or failed with the message and reference its status show. */
export type HostPluginState = {
    readonly status: "active";
} | {
    readonly status: "failed";
    readonly error: string;
    readonly ref?: string;
};
/**
 * The part of OpenCode's plugin context the catalog uses, written structurally so the package needs no
 * `@opencode/plugin`. A plugin passes its own `ctx`.
 */
export interface CatalogHost {
    readonly plugin: {
        list(input?: {
            readonly location?: {
                readonly directory?: string;
            };
        }): Promise<{
            readonly data: readonly HostPlugin[];
        }>;
    };
}
/** Where the OpenCode cache is, and a host's own resolution of a target it installed elsewhere. */
export interface CatalogOptions {
    /** The OpenCode cache directory, the one holding `npm/`. Default: `<XDG_CACHE_HOME or ~/.cache>/opencode`. */
    readonly cacheDirectory?: string;
    /** The directory a target resolved to, when the host knows better than the cache: a checkout, a linked package. */
    readonly resolve?: (target: string) => string | undefined;
}
/** One installed plugin whose manifest validated, and the host target it came from. */
export interface CatalogPlugin extends InstalledManifest {
    /** The host's package target, or a local plugin's path. */
    readonly target: string;
}
/** One plugin whose package or manifest could not be read. */
export interface CatalogProblem {
    /** The host's package target, or a local plugin's path. */
    readonly target: string;
    readonly problems: readonly string[];
}
/** What the catalog found: the manifests, and every plugin that did not yield one. */
export interface CatalogListing {
    readonly plugins: readonly CatalogPlugin[];
    readonly problems: readonly CatalogProblem[];
}
/**
 * The manifests of the host's installed plugins. Each package on disk is read with `readInstalledManifest`, so there
 * is one parser, one validator and one hash. A failed plugin, a missing package, a registry version the install does
 * not match, or an invalid manifest is reported and the rest of the list is still read. The function never throws for
 * a plugin's own package.
 */
export declare function listInstalledPlugins(host: CatalogHost, options?: CatalogOptions): Promise<CatalogListing>;
