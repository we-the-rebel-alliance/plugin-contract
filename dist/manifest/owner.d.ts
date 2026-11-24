/** A scheme-qualified id: `mailto:ana@example.com`, `domain:example.com`, `slack-team:T0123`. */
export declare const SCHEME_QUALIFIED: RegExp;
/** The problems with an owner's `orgs`, one sentence each; none when absent or valid. */
export declare function ownerOrgProblems(orgs: unknown, what?: string): string[];
/**
 * The problems with a probe owner, one sentence each; none when it keeps the contract. `what` is the sentence's
 * subject, such as `the probe answer's owner`.
 */
export declare function ownerProblems(owner: unknown, what?: string): string[];
