import { type Manifest } from "./manifest.js";
/** One installed package whose manifest validated. */
export interface ListedDeclaration {
    readonly directory: string;
    readonly package: string;
    readonly version: string;
    /** The validated `capabilities` value. */
    readonly manifest: Manifest;
    /** The manifest hash, covering every key. A grant stores it. */
    readonly hash: string;
}
/** A package that has no manifest, or one this package refuses. */
export interface ListedProblem {
    readonly directory: string;
    readonly problems: readonly string[];
}
/** What a listing found: the declarations, and every package that did not yield one. */
export interface ListedDeclarations {
    readonly declarations: readonly ListedDeclaration[];
    readonly problems: readonly ListedProblem[];
}
/**
 * The manifests of the installed packages at `input`: a directory of packages, or a list of package directories.
 * Uses `readInstalledManifest` for each, and reports a missing or invalid manifest instead of dropping it.
 */
export declare function listInstalledDeclarations(input: string | readonly string[]): ListedDeclarations;
