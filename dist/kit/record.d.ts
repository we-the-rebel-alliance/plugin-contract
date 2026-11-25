import type { CommandContext } from "./types.js";
/**
 * Replace the patterns in one string: a credential gives the whole string up, because a token's neighbours may be as
 * revealing as the token; an email, a phone number, a home path and a sensitive query value are replaced in place.
 */
export declare function redactText(text: string): string;
/** Replace credentials and personal data in a JSON value, preserving its keys and their order. */
export declare function redactValue(value: unknown, path?: readonly string[]): unknown;
/** The fixture file a plugin records, beside its package. */
export declare const FIXTURE_FILE = "fixtures/conformance.json";
/** The aliases a fixture records, or none when it records no accounts section. */
export declare function fixtureAliases(value: Record<string, unknown>): string[];
/** `plugin-kit record`: run the recorder, then redact and write the one fixture #59 reads. */
export declare function runRecord(context: CommandContext, options: {
    readonly account?: string | undefined;
    readonly fixtures: string | undefined;
    readonly check: boolean;
}): Promise<number>;
