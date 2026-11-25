import { type ForbiddenApp } from "./forbidden-apps.js";
import type { CommandContext, Finding } from "./types.js";
/** What the scan reads. A test can pass its own app list and skip list. */
export interface ForbiddenOptions {
    readonly apps?: readonly ForbiddenApp[] | undefined;
    readonly skip?: readonly string[] | undefined;
}
/** The allowance file, relative to the plugin root. */
export declare const ALLOW_FILE = ".plugin-kit/forbidden-allow";
/** Every forbidden pattern under `dir`, with the line each was found on. */
export declare function forbiddenFindings(dir: string, options?: ForbiddenOptions): Finding[];
/** `plugin-kit forbidden`: scan the plugin directory and print every finding. */
export declare function runForbidden(context: CommandContext): Promise<number>;
