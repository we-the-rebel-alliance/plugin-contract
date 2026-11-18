import { type InstalledDescriptor } from "./descriptor.js";
import type { ActItem } from "./internal/schema/types.js";
/** One installed package whose descriptor validated. */
export interface ListedDeclaration {
    readonly directory: string;
    readonly package: string;
    readonly version: string;
    readonly sources: InstalledDescriptor["sources"];
    /** The package's acts. Empty when the descriptor declares none. */
    readonly acts: readonly ActItem[];
    /** The descriptor hash, covering sources and acts. A grant stores it. */
    readonly hash: string;
}
/** A package that has no descriptor, or one this package refuses. */
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
 * The declarations of the installed packages at `input`: a directory of packages, or a list of package directories.
 * Uses `readInstalledDescriptor` for each, and reports a missing or invalid descriptor instead of dropping it.
 */
export declare function listInstalledDeclarations(input: string | readonly string[]): ListedDeclarations;
