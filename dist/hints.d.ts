import type { Validator } from "./internal/checked.js";
import { type FactType } from "./internal/events.js";
/** The most characters a hint takes, frontmatter and body alike (#45 §4). */
export declare const HINT_MAX = 1500;
/** The most characters a routine's instructions take (#45 §5). */
export declare const ROUTINE_BODY_MAX = 4000;
/** The keys a hint's frontmatter may have (#45 §4). */
export declare const HINT_KEYS: readonly ["source", "kinds", "produces"];
/** The keys a routine's frontmatter may have (#45 §5). */
export declare const ROUTINE_KEYS: readonly ["id", "title", "reads", "produces"];
/**
 * The keys a hint may not set (#45 §4, §7): a hint is data, and Memory alone decides how its text is used, whose word
 * it states and where it lands.
 */
export declare const FORBIDDEN_HINT_KEYS: readonly ["apply", "stated_by", "space", "budget", "priority"];
/**
 * The keys a routine may not set (#45 §5, §7): the namespace is the installed package's and never declared, and the
 * tier, schedule, budget, priority and apply mode are Memory's, as `stated_by` is.
 */
export declare const FORBIDDEN_ROUTINE_KEYS: readonly ["tier", "schedule", "budget", "priority", "apply", "stated_by", "namespace"];
/** What a hint's frontmatter is, once it keeps the contract (#45 §4). */
export interface HintFrontmatter {
    /** One of the plugin's own source ids. */
    readonly source: string;
    /** The kinds of item it says how to read, each a core kind or `x-<namespace>/<name>`. */
    readonly kinds: readonly string[];
    /** The core fact types its text produces. */
    readonly produces?: readonly FactType[] | undefined;
}
/** What a routine's frontmatter is, once it keeps the contract (#45 §5). */
export interface RoutineFrontmatter {
    /** The routine's id: a lowercase word, unique in the plugin. */
    readonly id: string;
    readonly title: string;
    /** The plugin's own sources and kinds it reads, and no other. */
    readonly reads: {
        readonly sources: readonly string[];
        readonly kinds: readonly string[];
    };
    readonly produces: readonly FactType[];
}
/** A hint's frontmatter schema, published as `dist/schemas/hint.json`. */
export declare const HINT_SCHEMA: Validator<HintFrontmatter>;
/** A routine's frontmatter schema, published as `dist/schemas/routine.json`. */
export declare const ROUTINE_SCHEMA: Validator<RoutineFrontmatter>;
/** A file read: the frontmatter it declares, and the body it keeps as it is. */
export interface Frontmatter {
    readonly frontmatter: Record<string, unknown>;
    readonly body: string;
}
/**
 * A hint or routine file's frontmatter and body, or why it has neither, one sentence each. `what` names the file in a
 * message ("hint", "routine", or "file" by default). The frontmatter opens with `---` on a line of its own, is one key
 * a line, and closes with `---`; the body is everything after it, trimmed.
 */
export declare function parseFrontmatter(text: string, what?: string): {
    readonly ok: true;
    readonly value: Frontmatter;
} | {
    readonly ok: false;
    readonly problems: string[];
};
/** What `hintProblems` and `routineProblems` need: the plugin's own source ids, which a file may name and no other. */
export interface FileOptions {
    /** Every source id the plugin declares: a hint names one of them, and a routine reads one of them. */
    readonly sources: readonly string[];
}
/**
 * A hint file's problems (#45 §4), one sentence each; none when it keeps the contract. A hint is at most 1,500
 * characters; its frontmatter has the known keys only and no key of Memory's; its `source` is one of the plugin's own;
 * and its `produces` names core fact types only.
 */
export declare function hintProblems(text: unknown, options: FileOptions): string[];
/**
 * A routine file's problems (#45 §5), one sentence each; none when it keeps the contract. Its instructions are at most
 * 4,000 characters; its frontmatter has the known keys only and no key of Memory's; it reads only the plugin's own
 * sources; and its `produces` names core fact types only.
 */
export declare function routineProblems(text: unknown, options: FileOptions): string[];
