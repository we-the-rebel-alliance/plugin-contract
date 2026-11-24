import type { Manifest } from "../../manifest.js";
import { type Finding } from "./report.js";
/** A generated section's name. */
export type DocsSection = "capabilities" | "errors" | "configuration" | "accounts" | "automations";
/** The sections a plugin ships, and the files that carry them. */
export declare const DOC_FILES: readonly {
    readonly file: string;
    readonly sections: readonly DocsSection[];
}[];
/** Every generated section, rendered from the manifest. Deterministic: the same manifest gives the same text. */
export declare function renderGeneratedDocs(manifest: Manifest): Readonly<Record<DocsSection, string>>;
/**
 * Every problem with the generated sections: a missing marker in a file the plugin ships, and a block that is not what
 * the manifest says. A plugin that ships none of the doc files has nothing to check here; the kit's docs check owns the
 * file set.
 */
export declare function docsFindings(directory: string, manifest: Manifest): Finding[];
