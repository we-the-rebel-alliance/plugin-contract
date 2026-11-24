import type { Validator } from "./internal/checked.js";
/** The most characters a hint takes, frontmatter and body alike. */
export declare const HINT_MAX = 1500;
/** The keys a hint's frontmatter may have. */
export declare const HINT_KEYS: readonly ["source", "kinds", "produces"];
/**
 * The keys a hint may not set: how the consumer applies it, whose word it states, and where it lands are the
 * consumer's decisions, never the plugin's.
 */
export declare const FORBIDDEN_HINT_KEYS: readonly ["apply", "stated_by", "space", "budget", "priority"];
/**
 * The knowledge types `produces` may name: what a model-based consumer may extract with the hint's help. They are a
 * different list from the structured fact types of `facts[]`: a plugin derives a fact in code, while a hint only helps
 * a model find a piece of knowledge. A type the consumer derives itself is never a `produces` value.
 */
export declare const PRODUCES_TYPES: readonly ["commitment", "decision", "fact", "preference", "constraint", "person", "project"];
export type ProducesType = (typeof PRODUCES_TYPES)[number];
/** What a hint's frontmatter is, once it keeps the contract. */
export interface HintFrontmatter {
    /** One of the plugin's own source ids. */
    readonly source: string;
    /** The kinds of item it says how to read, each a core kind or `x-<namespace>/<name>`. */
    readonly kinds: readonly string[];
    /** The knowledge types its text helps a model find. */
    readonly produces?: readonly ProducesType[] | undefined;
}
/** A hint's frontmatter schema, published as `dist/schemas/hint.json`. */
export declare const HINT_SCHEMA: Validator<HintFrontmatter>;
/** A file read: the frontmatter it declares, and the body it keeps as it is. */
export interface Frontmatter {
    readonly frontmatter: Record<string, unknown>;
    readonly body: string;
}
/**
 * A hint file's frontmatter and body, or why it has neither, one sentence each. `what` names the file in a message
 * ("hint" by default). The frontmatter opens with `---` on a line of its own, is one key a line, and closes with
 * `---`; the body is everything after it, trimmed.
 */
export declare function parseFrontmatter(text: string, what?: string): {
    readonly ok: true;
    readonly value: Frontmatter;
} | {
    readonly ok: false;
    readonly problems: string[];
};
/** What `hintProblems` needs: the plugin's own source ids, which a file may name and no other. */
export interface FileOptions {
    /** Every source id the plugin declares: a hint names one of them. */
    readonly sources: readonly string[];
}
/**
 * A hint file's problems, one sentence each; none when it keeps the contract. A hint is at most 1,500 characters; its
 * frontmatter has the known keys only and no key of the consumer's; its `source` is one of the plugin's own; and its
 * `produces` names a knowledge type a model may extract and no other.
 */
export declare function hintProblems(text: unknown, options: FileOptions): string[];
