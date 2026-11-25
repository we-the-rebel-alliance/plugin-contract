import type { Finding } from "./types.js";
/** A marker the kit's host harness carries, so a bundle that inlines it can be named. */
export declare const KIT_BUNDLE_MARKER = "plugin-kit:dev-only";
/** Every runtime file that carries the kit, as one `KIT_BUNDLED` error per file. */
export declare function bundledFindings(directory: string): Finding[];
/** The runtime files the check reads, for a test and for docs. */
export declare function runtimeFileList(directory: string): string[];
