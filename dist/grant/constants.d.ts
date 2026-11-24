/**
 * The action grant's published vocabulary: the token type, the one signature algorithm, the contract-facing code and
 * the limits. See `docs/grant.md`.
 */
/** The `typ` header of an action grant. A token that says anything else is malformed. */
export declare const GRANT_TYP = "plugin-contract-act+jwt";
/** The only signature algorithm the verifier accepts. */
export declare const GRANT_ALG = "Ed25519";
/** The contract §12 code every grant refusal maps to. */
export declare const GRANT_INVALID = "GRANT_INVALID";
/** The most characters a compact grant may take, base64url and dots included. */
export declare const MAX_GRANT_LENGTH = 8192;
/** The most bytes a grant's canonical input may take. */
export declare const MAX_INPUT_BYTES = 65536;
/** The most objects or arrays that may nest inside one another; the root container is depth 1. */
export declare const MAX_INPUT_DEPTH = 16;
/** How far a signer's clock may run ahead of the verifier's, in seconds, unless the request says otherwise. */
export declare const DEFAULT_CLOCK_SKEW_SEC = 5;
/** The longest lifetime a grant may claim, in seconds, unless the request says otherwise. */
export declare const DEFAULT_MAX_LIFETIME_SEC = 60;
/** The hard ceiling on a request's `clockSkewSec`: no request may widen the future window past 30 seconds. */
export declare const MAX_CLOCK_SKEW_SEC = 30;
/** The hard ceiling on a request's `maxLifetimeSec`: no request may accept a grant that lives over 5 minutes. */
export declare const MAX_LIFETIME_SEC = 300;
