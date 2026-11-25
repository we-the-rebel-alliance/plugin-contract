/**
 * The one place the kit reaches the conformance module.
 *
 * The import is lazy and structural: the kit compiles and its own tests run with a fake runner, and a module that does
 * not publish `runConformance`, `t0` and `t1` is one clear error rather than a missing gate. The kit never re-implements
 * a check and never imports a check's internals.
 */
import { type CommandContext, type ConformanceRunner } from "./types.js";
/** Load the conformance module, or explain which function the installed plugin-contract lacks. */
export declare function loadConformance(importModule?: () => Promise<unknown>): Promise<ConformanceRunner>;
/** `plugin-kit conformance`: run every check the conformance module has, and print its report. */
export declare function runConformance(context: CommandContext, options?: {
    readonly hosts?: string[] | undefined;
    readonly record?: boolean | undefined;
}): Promise<number>;
