import { type InstalledManifest } from "../manifest.js";
/**
 * One plugin as the host lists it: the part of `ctx.plugin.list()` the catalog reads. A package names its target; a
 * local plugin names its directory; a builtin or SDK plugin has no package manifest.
 */
export interface HostPlugin {
    readonly id?: string;
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
    readonly location?: {
        readonly directory: string;
    };
}
/** Where to look for package targets. The host's own directory is the default root. */
export interface CatalogOptions {
    /** Directories whose `node_modules` hold installed packages, searched in order. Default: the host's directory. */
    readonly roots?: readonly string[];
    /** The directory a target resolved to, when the host knows it: a package cache, a checkout, a linked package. */
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
 * is one parser, one validator and one hash. A missing package, a version the install does not match, or an invalid
 * manifest is reported and the rest of the list is still read. The function never throws for a plugin's own package.
 */
export declare function listInstalledPlugins(host: CatalogHost, options?: CatalogOptions): Promise<CatalogListing>;
