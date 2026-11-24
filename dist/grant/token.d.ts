/**
 * The action grant's token: `header.payload.signature` in base64url, signed with Ed25519 over the two encoded
 * segments (a compact JWS-like token, not a JWT).
 *
 * Header, exactly three members:
 *
 * ```json
 * { "alg": "Ed25519", "kid": "host_2026_11", "typ": "plugin-contract-act+jwt" }
 * ```
 *
 * Claims, exactly these and no others:
 *
 * ```json
 * {
 *   "aud": "<the plugin's package name, as the host uses it>",
 *   "consumer": "<the grant key>",
 *   "capability": "<name>.<method>",
 *   "account": "<alias>",
 *   "scope": { "<key>": "<value>" },
 *   "act": "<name>.<action>",
 *   "digest": "sha256:<hex>",
 *   "manifest": "sha256:<hex>",
 *   "iat": 1800000000,
 *   "exp": 1800000060,
 *   "jti": "<single-use key>",
 *   "cfm": true
 * }
 * ```
 *
 * `cfm` is present only when a person confirmed the action in the host's UI; it is `true` and nothing else.
 * `iat` and `exp` are whole seconds since the Unix epoch; a grant lives only while `now < exp`.
 *
 * No I/O: signing uses the private key the caller passes, and verification uses the public key the caller supplies.
 */
import { type KeyObject } from "node:crypto";
import { GRANT_ALG, GRANT_TYP } from "./constants.js";
import { type GrantScope } from "./input.js";
/** The header of an action grant. No other member is accepted. */
export interface GrantHeader {
    readonly alg: typeof GRANT_ALG;
    readonly kid: string;
    readonly typ: typeof GRANT_TYP;
}
/** The claims a verified grant carries. `scope` is returned in canonical form. */
export interface GrantClaims {
    /** The plugin's package name as the host uses it, for example `@we-the-rebel-alliance/slack-plugin`. */
    readonly aud: string;
    /** The grant key: the consumer the grant was issued to. */
    readonly consumer: string;
    /** The method id `<name>.<method>`, for example `slack.events_list`. */
    readonly capability: string;
    readonly account: string;
    readonly scope: GrantScope;
    readonly act: string;
    readonly digest: string;
    readonly manifest: string;
    readonly iat: number;
    readonly exp: number;
    readonly jti: string;
    /** Present, and `true`, only when a person confirmed the action in the host's UI. */
    readonly cfm?: true;
}
/**
 * Key material: a `KeyObject`, a PEM string, or DER bytes. `signGrant` wants a private key; `GrantKeys` wants public
 * keys (SPKI DER). The module never reads a file or a key store.
 */
export type GrantKeyMaterial = KeyObject | string | Uint8Array;
/** What a host passes to `signGrant`. The private key is explicit: only a host signs. */
export interface SignGrantRequest {
    readonly key: GrantKeyMaterial;
    readonly kid: string;
    /** The plugin's package name as the host uses it. */
    readonly audience: string;
    /** The grant key: the consumer the grant is issued to. */
    readonly consumer: string;
    /** The method id `<name>.<method>`. */
    readonly capability: string;
    readonly account: string;
    readonly scope?: GrantScope;
    readonly act: string;
    /** The exact input the action will run with. Its canonical digest is bound into the grant. */
    readonly input: unknown;
    /** `sha256:<64 lowercase hex digits>` of the manifest's canonical JSON. */
    readonly manifest: string;
    /** Whole seconds since the Unix epoch. */
    readonly iat: number;
    /** Whole seconds since the Unix epoch; after `iat`, and short. */
    readonly exp: number;
    readonly jti: string;
    readonly cfm?: true;
}
/** The token split apart, with its header read strictly and its signature still to verify. */
export type ParsedToken = {
    readonly ok: true;
    readonly header: GrantHeader;
    /** The exact bytes the signature covers: the two base64url segments and the dot between them. */
    readonly signingInput: Buffer;
    /** The payload decoded as UTF-8 text, not yet parsed or checked. */
    readonly payload: string;
    readonly signature: Buffer;
} | {
    readonly ok: false;
    readonly code: "GRANT_MALFORMED" | "GRANT_UNSUPPORTED_ALGORITHM";
    readonly reason: string;
};
/** The claims read and checked, or why they are not usable. `cfm` is judged separately by the confirmation rule. */
export type ReadClaimsResult = {
    readonly ok: true;
    readonly claims: Omit<GrantClaims, "cfm">;
    readonly confirmation: "absent" | "confirmed" | "invalid";
} | {
    readonly ok: false;
    readonly code: "GRANT_CLAIMS_INVALID";
    readonly reason: string;
};
/**
 * Splits a compact grant and checks the token and header syntax: three canonical base64url segments, a UTF-8 header
 * that is a plain object with exactly `alg`, `kid` and `typ`, the published `typ`, the one algorithm, and a usable
 * `kid`. The claims are not read here, and no signature is checked.
 */
export declare function parseToken(token: unknown): ParsedToken;
/**
 * Reads the claims and checks their shape: a JSON object with exactly the published claims, every value of the right
 * kind, every hash in the published form and every text claim free of control characters and lone surrogates. `cfm`
 * is reported as absent, confirmed or invalid; the confirmation rule decides whether that is a refusal.
 */
export declare function readClaims(payload: string): ReadClaimsResult;
/**
 * The Ed25519 public key `material` names, or nothing when it is not one. A `KeyObject` is used as it is, a string is
 * read as PEM, and bytes are read as SPKI DER. Private key material is refused on every path: a private `KeyObject`, a
 * private PEM (including an encrypted one) and private DER are never turned into a trusted public key. A trusted key
 * that cannot be read is a configuration error, never a reason to try another key.
 */
export declare function toPublicKey(material: GrantKeyMaterial): KeyObject | undefined;
/**
 * Signs a grant: the host's side of the format, for a host and for tests. The private key is explicit and never read
 * from a file here. Throws when the request is invalid or the input is outside the canonical rules.
 *
 * A plugin never calls this. A plugin holds public keys and calls `verifyGrant`.
 */
export declare function signGrant(request: SignGrantRequest): string;
