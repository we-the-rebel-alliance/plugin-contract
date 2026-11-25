/**
 * The kit's shared types: one finding from any check, and the conformance runner the kit calls.
 *
 * A finding's `id` is stable, so a plugin's CI log and a reviewer can name the same check across runs. The conformance
 * module owns the checks; the kit only prints what it answers and adds its own findings under `KIT.*`, `DOCS.*` and
 * `FORBIDDEN.*`.
 */
/** One problem the kit reports, at one path, with the next step. */
export interface Finding {
    /** A stable dotted id, such as `T0.namespace-length`, `T0.docs-capabilities` or `FORBIDDEN.secret`. */
    readonly id: string;
    readonly level: "error" | "warning";
    /** What happened, one sentence. */
    readonly message: string;
    /** The file the finding is about, relative to the plugin directory. */
    readonly path?: string | undefined;
    /** What to do about it, one sentence. */
    readonly fix?: string | undefined;
}
/** What the conformance module answers: whether the plugin conforms, and every finding. */
export interface ConformanceReport {
    readonly ok: boolean;
    readonly findings: Finding[];
}
/** The options the conformance module takes, exactly as `src/conformance.ts` publishes them. */
export interface ConformanceOptions {
    /** The hosts to load the plugin on. Absent: every host the manifest says it was tested on. */
    hosts?: string[] | undefined;
    /** Record the provider fixtures again, from the signed-in accounts this machine holds. */
    record?: boolean | undefined;
}
/**
 * The conformance module's surface. The kit never re-implements a check: it calls these three functions and nothing
 * else.
 */
export interface ConformanceRunner {
    runConformance(pluginDir: string, options: ConformanceOptions): Promise<ConformanceReport>;
    /** Static checks: no model, no network (contract §16, T0). */
    t0(pluginDir: string): Promise<Finding[]>;
    /** The plugin loaded on one real OpenCode host (contract §16, T1). */
    t1(pluginDir: string, host: string): Promise<Finding[]>;
}
/** Where a command writes. The tests capture both. */
export interface Io {
    readonly stdout: (text: string) => void;
    readonly stderr: (text: string) => void;
}
/** The result of one `git` call. */
export interface GitResult {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}
/** Run `git` in a directory. Injected, so a test can watch a release without a repository. */
export type Git = (args: readonly string[], directory: string) => Promise<GitResult>;
/** Everything a command may use, with the process's defaults filled in by `main`. */
export interface CommandContext {
    /** The plugin directory: the working directory unless `--dir` names another. */
    readonly dir: string;
    readonly io: Io;
    readonly conformance: () => Promise<ConformanceRunner>;
    readonly git: Git;
    readonly now: () => Date;
    readonly json: boolean;
}
/** A failure the kit itself raises, in the contract's `CODE: … Next step: …` form. */
export declare class KitError extends Error {
    readonly code: string;
    /** What happened, without the code and next step. */
    readonly what: string;
    /** What to do about it. */
    readonly next: string;
    constructor(code: string, what: string, next: string);
}
/** Whether any finding is an error. Warnings alone do not fail a check. */
export declare function hasError(findings: readonly Finding[]): boolean;
/** Findings in a stable order: by path, then id, then message. */
export declare function sortFindings(findings: readonly Finding[]): Finding[];
