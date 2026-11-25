import type { CommandContext, Finding } from "./types.js";
/** Run the conformance gate, the docs file set, the forbidden scan and the bundled-kit check. */
export declare function checkPlugin(context: CommandContext, options?: {
    readonly hosts?: readonly string[] | undefined;
}): Promise<Finding[]>;
/** `plugin-kit check`: run the gates and print one report. */
export declare function runCheck(context: CommandContext, options?: {
    readonly hosts?: readonly string[] | undefined;
}): Promise<number>;
