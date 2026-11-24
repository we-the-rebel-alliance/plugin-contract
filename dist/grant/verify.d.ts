import { GRANT_INVALID } from "./constants.js";
import { type GrantScope } from "./input.js";
import { type GrantClaims, type GrantKeyMaterial } from "./token.js";
/** Whether an action always needs a person's confirmation, or may carry one. Non-`local` actions require it. */
export type ConfirmationRule = "required" | "optional";
/** The actions a verifier accepts, each with its confirmation rule. An action not named here is refused. */
export type GrantActions = Readonly<Record<string, ConfirmationRule>>;
/** The public keys a verifier trusts, by `kid`, with the key ids it has revoked. */
export interface GrantKeys {
    /** Public keys by key id: a `KeyObject`, a PEM string or SPKI DER bytes. There is no "try every key". */
    readonly keys: Readonly<Record<string, GrantKeyMaterial>>;
    /** Key ids refused even when a key is still in the map. Checked before the signature. */
    readonly revoked?: readonly string[];
}
/**
 * Where single use is recorded. The plugin backs this with durable storage: an atomic insert-if-absent keyed by
 * `claims.jti`, answering `true` when this call made the insert and `false` when the grant was already spent.
 *
 * The store receives the full verified claims, so it can write its receipt (`act`, `digest`, `exp`, `cfm`) in the same
 * insert and prune by `claims.exp`. It must not be an in-memory `Map`: a restart would resurrect a spent grant. A
 * store that throws is a refusal (`GRANT_STORE_UNAVAILABLE`), never a crash.
 */
export interface GrantStore {
    consume(claims: GrantClaims): Promise<boolean>;
}
/** Everything the plugin knows about the grant it is about to verify. */
export interface GrantRequest {
    /** The compact token the host signed. */
    readonly grant: string;
    /** The exact input the action would run with. Its canonical JSON digest must match the grant's. */
    readonly input: unknown;
    /** The action the caller asks to run. */
    readonly act: string;
    /** The actions this verifier accepts, each with its confirmation rule. */
    readonly actions: GrantActions;
    /** The trusted public keys, by `kid`, and the key ids revoked. */
    readonly keys: GrantKeys;
    /** The plugin's package name as the host uses it; the grant's `aud` must be this. */
    readonly audience: string;
    /** The grant key (§14): the consumer the grant was issued to. */
    readonly consumer: string;
    /** The method id `<name>.<method>` the grant must name. */
    readonly capability: string;
    /** The account alias the grant must name. */
    readonly account: string;
    /** The scope the grant must name; absent or `{}` is the whole source. */
    readonly scope?: GrantScope;
    /** `sha256:<64 lowercase hex digits>` of the manifest's canonical JSON. */
    readonly manifest: string;
    /** The current time in seconds since the Unix epoch; a fraction is fine. Injected: the verifier never reads a clock. */
    readonly now: number;
    /** The durable single-use ledger. */
    readonly store: GrantStore;
    /** How far a signer's clock may run ahead, in seconds. Default 5, at most 30. */
    readonly clockSkewSec?: number;
    /** The longest lifetime a grant may claim, in seconds. Default 60, at most 300. */
    readonly maxLifetimeSec?: number;
}
/** Every way a grant can be refused. Each one is a test in `test/grant.test.ts`, and each maps to `GRANT_INVALID`. */
export type GrantCode = "GRANT_REQUEST_INVALID" | "GRANT_MALFORMED" | "GRANT_UNSUPPORTED_ALGORITHM" | "GRANT_KEY_UNKNOWN" | "GRANT_SIGNATURE_INVALID" | "GRANT_CLAIMS_INVALID" | "GRANT_ACTION_DISALLOWED" | "GRANT_ACTION_MISMATCH" | "GRANT_AUDIENCE_MISMATCH" | "GRANT_CONSUMER_MISMATCH" | "GRANT_CAPABILITY_MISMATCH" | "GRANT_ACCOUNT_MISMATCH" | "GRANT_SCOPE_MISMATCH" | "GRANT_MANIFEST_MISMATCH" | "GRANT_DIGEST_MISMATCH" | "GRANT_INPUT_INVALID" | "GRANT_NOT_YET_VALID" | "GRANT_LIFETIME_INVALID" | "GRANT_EXPIRED" | "GRANT_CONFIRMATION_REQUIRED" | "GRANT_CONFIRMATION_INVALID" | "GRANT_REPLAYED" | "GRANT_STORE_UNAVAILABLE";
/** Every refusal code, in alphabetical order. */
export declare const GRANT_CODES: readonly GrantCode[];
/** A grant that did not verify. */
export interface GrantFailure {
    readonly ok: false;
    readonly code: GrantCode;
    /** Always `GRANT_INVALID`: the contract §12 code a plugin reports. */
    readonly contractCode: typeof GRANT_INVALID;
    /** One line, at most 160 characters, naming no value from the token or the input: safe to log. */
    readonly reason: string;
}
/** A grant that verified, with its claims spent once. */
export interface GrantSuccess {
    readonly ok: true;
    /** The `kid` of the trusted key that verified the signature, for logs and receipts. */
    readonly kid: string;
    readonly claims: GrantClaims;
}
export type GrantOutcome = GrantSuccess | GrantFailure;
/**
 * Verifies a host-signed, single-use action grant and spends it, in this order:
 *
 * 1. the request is well formed and the requested action is allowed (`GRANT_REQUEST_INVALID`,
 *    `GRANT_ACTION_DISALLOWED`);
 * 2. the token and header are well formed (`GRANT_MALFORMED`, `GRANT_UNSUPPORTED_ALGORITHM`);
 * 3. the `kid` names a trusted, unrevoked key (`GRANT_KEY_UNKNOWN`) and the signature verifies
 *    (`GRANT_SIGNATURE_INVALID`);
 * 4. the claims have the published shape (`GRANT_CLAIMS_INVALID`);
 * 5. the bindings match: audience, consumer, capability, account, scope, manifest, then action;
 * 6. the window is sane and current (`GRANT_LIFETIME_INVALID`, `GRANT_NOT_YET_VALID`, `GRANT_EXPIRED`);
 * 7. the input is canonical (`GRANT_INPUT_INVALID`) and its digest is the grant's (`GRANT_DIGEST_MISMATCH`);
 * 8. the confirmation rule holds (`GRANT_CONFIRMATION_REQUIRED`, `GRANT_CONFIRMATION_INVALID`);
 * 9. only now, the store records the verified claims' `jti` (`GRANT_REPLAYED`, `GRANT_STORE_UNAVAILABLE`).
 *
 * A negative answer means no store write happened. A positive answer means the store recorded this `jti` for the
 * first time.
 */
export declare function verifyGrant(request: GrantRequest): Promise<GrantOutcome>;
