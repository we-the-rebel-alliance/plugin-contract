/** The canonical JSON of `value`. Throws for a value JSON cannot represent. */
export declare function canonicalJson(value: unknown): string;
/** The manifest hash: `sha256:` and the hex digest of the canonical JSON of `value`. Key order does not change it. */
export declare function manifestHash(value: unknown): string;
