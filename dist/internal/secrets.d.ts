/** Where a credential assignment's value sits, so a caller can judge the syntax around it. */
export interface AssignmentSite {
    /** The text between the key and the value, such as `: ` or ` = `. */
    readonly separator: string;
    /** The quote that wraps the value (`"`, `'` or a backtick), or `undefined` for a bare value. */
    readonly quote: string | undefined;
    /** Where the value starts in the text, inside its quote. */
    readonly valueIndex: number;
    /** The value as written, without its quote. */
    readonly value: string;
}
/** One secret found in a piece of text: its kind, where it starts, and for an assignment where its value sits. */
export interface SecretFinding {
    readonly kind: string;
    readonly index: number;
    readonly assignment?: AssignmentSite;
}
/** Every secret in one piece of text, in the order the patterns find them, each with its position. */
export declare function secretFindings(text: unknown): SecretFinding[];
/** The kinds of secret in one piece of text: "private key", "api key", "token", "password", "connection string". */
export declare function secretKinds(text: unknown): string[];
