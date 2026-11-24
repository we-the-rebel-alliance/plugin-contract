/**
 * The action-grant verifier (contract §8, §13; issue #40): the host signed one action and its exact input, for one
 * consumer, capability, account, scope and manifest; this function says whether the grant the plugin received is that
 * grant, and spends it once through the store the plugin backs.
 *
 * It does no I/O: no file, no network, no clock. `now` is an argument, the keys are arguments and the only effect is
 * the store's `consume`. It never throws for a bad grant — it answers the claims, or a published code and a one-line
 * reason. Every refusal also carries the contract-facing `GRANT_INVALID` (contract §12), which is what a plugin
 * reports; the precise code is for its logs and its own sentence.
 */
import { verify as verifySignature } from "node:crypto"
import {
  DEFAULT_CLOCK_SKEW_SEC,
  DEFAULT_MAX_LIFETIME_SEC,
  GRANT_INVALID,
  MAX_CLOCK_SKEW_SEC,
  MAX_LIFETIME_SEC,
} from "./constants.ts"
import { canonicalScope, digestInput, type GrantScope } from "./input.ts"
import { accountProblem, hashProblem, isPlainObject, textProblem } from "./text.ts"
import { parseToken, readClaims, toPublicKey, type GrantClaims, type GrantKeyMaterial } from "./token.ts"

/** Whether an action always needs a person's confirmation, or may carry one. Non-`local` actions require it. */
export type ConfirmationRule = "required" | "optional"

/** The actions a verifier accepts, each with its confirmation rule. An action not named here is refused. */
export type GrantActions = Readonly<Record<string, ConfirmationRule>>

/** The public keys a verifier trusts, by `kid`, with the key ids it has revoked. */
export interface GrantKeys {
  /** Public keys by key id: a `KeyObject`, a PEM string or SPKI DER bytes. There is no "try every key". */
  readonly keys: Readonly<Record<string, GrantKeyMaterial>>
  /** Key ids refused even when a key is still in the map. Checked before the signature. */
  readonly revoked?: readonly string[]
}

/**
 * Where single use is recorded. The plugin backs this with durable storage: an insert-if-absent keyed by `jti`,
 * answering `true` when this call made the insert and `false` when the grant was already spent.
 *
 * It must not be an in-memory `Map`: a restart would resurrect a spent grant. A store that throws is a refusal
 * (`GRANT_STORE_UNAVAILABLE`), never a crash.
 */
export interface GrantStore {
  consume(jti: string): Promise<boolean>
}

/** Everything the plugin knows about the grant it is about to verify. */
export interface GrantRequest {
  /** The compact token the host signed. */
  readonly grant: string
  /** The exact input the action would run with. Its canonical JSON digest must match the grant's. */
  readonly input: unknown
  /** The action the caller asks to run. */
  readonly act: string
  /** The actions this verifier accepts, each with its confirmation rule. */
  readonly actions: GrantActions
  /** The trusted public keys, by `kid`, and the key ids revoked. */
  readonly keys: GrantKeys
  /** The app or audience the grant must be for. */
  readonly audience: string
  /** The grant key (§14): the consumer the grant was issued to. */
  readonly consumer: string
  /** The capability or method id the grant must name. */
  readonly capability: string
  /** The account alias the grant must name. */
  readonly account: string
  /** The scope the grant must name; absent or `{}` is the whole source. */
  readonly scope?: GrantScope
  /** `sha256:<64 lowercase hex digits>` of the manifest's canonical JSON. */
  readonly manifest: string
  /** The current time in seconds since the Unix epoch; a fraction is fine. Injected: the verifier never reads a clock. */
  readonly now: number
  /** The durable single-use ledger. */
  readonly store: GrantStore
  /** How far a signer's clock may run ahead, in seconds. Default 30, at most 3600. */
  readonly clockSkewSec?: number
  /** The longest lifetime a grant may claim, in seconds. Default 300, at most 86400. */
  readonly maxLifetimeSec?: number
}

/** Every way a grant can be refused. Each one is a test in `test/grant.test.ts`, and each maps to `GRANT_INVALID`. */
export type GrantCode =
  | "GRANT_REQUEST_INVALID"
  | "GRANT_MALFORMED"
  | "GRANT_UNSUPPORTED_ALGORITHM"
  | "GRANT_KEY_UNKNOWN"
  | "GRANT_SIGNATURE_INVALID"
  | "GRANT_CLAIMS_INVALID"
  | "GRANT_ACTION_DISALLOWED"
  | "GRANT_ACTION_MISMATCH"
  | "GRANT_AUDIENCE_MISMATCH"
  | "GRANT_CONSUMER_MISMATCH"
  | "GRANT_CAPABILITY_MISMATCH"
  | "GRANT_ACCOUNT_MISMATCH"
  | "GRANT_SCOPE_MISMATCH"
  | "GRANT_MANIFEST_MISMATCH"
  | "GRANT_DIGEST_MISMATCH"
  | "GRANT_INPUT_INVALID"
  | "GRANT_NOT_YET_VALID"
  | "GRANT_LIFETIME_INVALID"
  | "GRANT_EXPIRED"
  | "GRANT_CONFIRMATION_REQUIRED"
  | "GRANT_CONFIRMATION_INVALID"
  | "GRANT_REPLAYED"
  | "GRANT_STORE_UNAVAILABLE"

/** Every refusal code, in alphabetical order. */
export const GRANT_CODES: readonly GrantCode[] = [
  "GRANT_ACCOUNT_MISMATCH",
  "GRANT_ACTION_DISALLOWED",
  "GRANT_ACTION_MISMATCH",
  "GRANT_AUDIENCE_MISMATCH",
  "GRANT_CAPABILITY_MISMATCH",
  "GRANT_CLAIMS_INVALID",
  "GRANT_CONFIRMATION_INVALID",
  "GRANT_CONFIRMATION_REQUIRED",
  "GRANT_CONSUMER_MISMATCH",
  "GRANT_DIGEST_MISMATCH",
  "GRANT_EXPIRED",
  "GRANT_INPUT_INVALID",
  "GRANT_KEY_UNKNOWN",
  "GRANT_LIFETIME_INVALID",
  "GRANT_MALFORMED",
  "GRANT_MANIFEST_MISMATCH",
  "GRANT_NOT_YET_VALID",
  "GRANT_REPLAYED",
  "GRANT_REQUEST_INVALID",
  "GRANT_SCOPE_MISMATCH",
  "GRANT_SIGNATURE_INVALID",
  "GRANT_STORE_UNAVAILABLE",
  "GRANT_UNSUPPORTED_ALGORITHM",
]

/** A grant that did not verify. */
export interface GrantFailure {
  readonly ok: false
  readonly code: GrantCode
  /** Always `GRANT_INVALID`: the contract §12 code a plugin reports. */
  readonly contractCode: typeof GRANT_INVALID
  /** One line, at most 160 characters, naming no value from the token or the input: safe to log. */
  readonly reason: string
}

/** A grant that verified, with its claims spent once. */
export interface GrantSuccess {
  readonly ok: true
  readonly claims: GrantClaims
}

export type GrantOutcome = GrantSuccess | GrantFailure

interface NormalizedRequest {
  readonly grant: unknown
  readonly input: unknown
  readonly act: string
  readonly rule: ConfirmationRule
  readonly keys: GrantKeys
  readonly audience: string
  readonly consumer: string
  readonly capability: string
  readonly account: string
  readonly scope: GrantScope
  readonly manifest: string
  readonly now: number
  readonly store: GrantStore
  readonly clockSkewSec: number
  readonly maxLifetimeSec: number
}

type CheckedRequest = { readonly ok: true; readonly value: NormalizedRequest } | { readonly ok: false; readonly code: GrantCode; readonly reason: string }

function failure(code: GrantCode, reason: string): GrantFailure {
  return {
    ok: false,
    code,
    contractCode: GRANT_INVALID,
    reason: reason.replace(/\s+/g, " ").trim().slice(0, 160),
  }
}

function requestInvalid(reason: string): CheckedRequest {
  return { ok: false, code: "GRANT_REQUEST_INVALID", reason }
}

/**
 * Checks the plugin's own request before touching the grant: a mistake here is a configuration error, not an attack,
 * and it is refused with `GRANT_REQUEST_INVALID`. The requested action's policy is checked here too, so a disallowed
 * action costs no cryptography and no store write.
 */
function normalizeRequest(request: GrantRequest): CheckedRequest {
  if (!isPlainObject(request)) return requestInvalid("the request is not an object")
  const record = request as unknown as Record<string, unknown>

  const actProblem = textProblem(record["act"], "the requested action")
  if (actProblem !== undefined) return requestInvalid(actProblem)
  const act = record["act"] as string

  const actions = record["actions"]
  if (!isPlainObject(actions)) return requestInvalid("the request has no actions map")
  if (!Object.hasOwn(actions, act)) return { ok: false, code: "GRANT_ACTION_DISALLOWED", reason: "the requested action is not one this verifier accepts" }
  const rule = actions[act]
  if (rule !== "required" && rule !== "optional") return requestInvalid("an action's confirmation rule is neither required nor optional")

  const keysValue = record["keys"]
  if (!isPlainObject(keysValue)) return requestInvalid("the request has no trusted keys")
  if (!isPlainObject(keysValue["keys"])) return requestInvalid("the trusted keys are not a map of key id to key")
  const revoked = keysValue["revoked"]
  if (revoked !== undefined && (!Array.isArray(revoked) || revoked.some((kid) => typeof kid !== "string"))) {
    return requestInvalid("the revoked key ids are not a list of strings")
  }

  const audience = textProblem(record["audience"], "the expected audience")
  if (audience !== undefined) return requestInvalid(audience)
  const consumer = textProblem(record["consumer"], "the expected consumer")
  if (consumer !== undefined) return requestInvalid(consumer)
  const capability = textProblem(record["capability"], "the expected capability")
  if (capability !== undefined) return requestInvalid(capability)
  const account = accountProblem(record["account"])
  if (account !== undefined) return requestInvalid(account)
  const manifest = hashProblem(record["manifest"], "the expected manifest hash")
  if (manifest !== undefined) return requestInvalid(manifest)

  let scope: GrantScope
  try {
    scope = canonicalScope(record["scope"] as GrantScope | undefined)
  } catch (error) {
    return requestInvalid(error instanceof Error ? error.message : "the expected scope cannot be read")
  }

  const now = record["now"]
  if (typeof now !== "number" || !Number.isFinite(now) || now < 0) return requestInvalid("the current time is not a number of seconds")

  const store = record["store"]
  if (typeof store !== "object" || store === null || typeof (store as GrantStore).consume !== "function") return requestInvalid("the request has no store")

  const skew = record["clockSkewSec"]
  const clockSkewSec = skew === undefined ? DEFAULT_CLOCK_SKEW_SEC : skew
  if (typeof clockSkewSec !== "number" || !Number.isFinite(clockSkewSec) || clockSkewSec < 0 || clockSkewSec > MAX_CLOCK_SKEW_SEC) {
    return requestInvalid(`the clock skew is not between 0 and ${MAX_CLOCK_SKEW_SEC} seconds`)
  }

  const lifetime = record["maxLifetimeSec"]
  const maxLifetimeSec = lifetime === undefined ? DEFAULT_MAX_LIFETIME_SEC : lifetime
  if (typeof maxLifetimeSec !== "number" || !Number.isFinite(maxLifetimeSec) || maxLifetimeSec < 1 || maxLifetimeSec > MAX_LIFETIME_SEC) {
    return requestInvalid(`the maximum lifetime is not between 1 and ${MAX_LIFETIME_SEC} seconds`)
  }

  return {
    ok: true,
    value: {
      grant: record["grant"],
      input: record["input"],
      act,
      rule,
      keys: keysValue as unknown as GrantKeys,
      audience: record["audience"] as string,
      consumer: record["consumer"] as string,
      capability: record["capability"] as string,
      account: record["account"] as string,
      scope,
      manifest: record["manifest"] as string,
      now,
      store: store as GrantStore,
      clockSkewSec,
      maxLifetimeSec,
    },
  }
}

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
 * 9. only now, the store records the `jti` (`GRANT_REPLAYED`, `GRANT_STORE_UNAVAILABLE`).
 *
 * A negative answer means no store write happened. A positive answer means the store recorded this `jti` for the
 * first time.
 */
export async function verifyGrant(request: GrantRequest): Promise<GrantOutcome> {
  const checked = normalizeRequest(request)
  if (!checked.ok) return failure(checked.code, checked.reason)
  const value = checked.value

  const token = parseToken(value.grant)
  if (!token.ok) return failure(token.code, token.reason)

  const kid = token.header.kid
  if (value.keys.revoked?.includes(kid) === true) return failure("GRANT_KEY_UNKNOWN", "the grant's key has been revoked")
  if (!Object.hasOwn(value.keys.keys, kid)) return failure("GRANT_KEY_UNKNOWN", "no trusted key has the grant's key id")
  const publicKey = toPublicKey(value.keys.keys[kid]!)
  if (publicKey === undefined) return failure("GRANT_REQUEST_INVALID", "the trusted key for the grant's key id is not an Ed25519 public key")

  let signed = false
  try {
    signed = verifySignature(null, token.signingInput, publicKey, token.signature)
  } catch {
    signed = false
  }
  if (!signed) return failure("GRANT_SIGNATURE_INVALID", "the grant's signature does not verify with its key")

  const read = readClaims(token.payload)
  if (!read.ok) return failure(read.code, read.reason)
  const claims = read.claims

  if (claims.aud !== value.audience) return failure("GRANT_AUDIENCE_MISMATCH", "the grant is for another audience")
  if (claims.consumer !== value.consumer) return failure("GRANT_CONSUMER_MISMATCH", "the grant is for another consumer")
  if (claims.capability !== value.capability) return failure("GRANT_CAPABILITY_MISMATCH", "the grant is for another capability")
  if (claims.account !== value.account) return failure("GRANT_ACCOUNT_MISMATCH", "the grant is for another account")
  if (JSON.stringify(claims.scope) !== JSON.stringify(value.scope)) return failure("GRANT_SCOPE_MISMATCH", "the grant is for another scope")
  if (claims.manifest !== value.manifest) return failure("GRANT_MANIFEST_MISMATCH", "the grant is for another manifest")
  if (claims.act !== value.act) return failure("GRANT_ACTION_MISMATCH", "the grant is for another action")

  if (claims.exp <= claims.iat || claims.exp - claims.iat > value.maxLifetimeSec) {
    return failure("GRANT_LIFETIME_INVALID", "the grant's lifetime is not positive and within the accepted maximum")
  }
  if (claims.iat > value.now + value.clockSkewSec) return failure("GRANT_NOT_YET_VALID", "the grant is not valid yet")
  if (claims.exp <= value.now) return failure("GRANT_EXPIRED", "the grant has expired")

  let digest: string
  try {
    digest = digestInput(value.input)
  } catch (error) {
    return failure("GRANT_INPUT_INVALID", error instanceof Error ? error.message : "the input is not canonical JSON")
  }
  if (digest !== claims.digest) return failure("GRANT_DIGEST_MISMATCH", "the input is not the input the grant was signed for")

  if (value.rule === "required") {
    if (read.confirmation === "absent") return failure("GRANT_CONFIRMATION_REQUIRED", "the grant carries no confirmation, and the action requires one")
    if (read.confirmation !== "confirmed") return failure("GRANT_CONFIRMATION_INVALID", "the grant's confirmation is not true")
  } else if (read.confirmation === "invalid") {
    return failure("GRANT_CONFIRMATION_INVALID", "the grant's confirmation is neither absent nor true")
  }

  let firstUse: unknown
  try {
    firstUse = await value.store.consume(claims.jti)
  } catch {
    return failure("GRANT_STORE_UNAVAILABLE", "the grant store could not record the grant")
  }
  if (firstUse === false) return failure("GRANT_REPLAYED", "the grant has already been used")
  if (firstUse !== true) return failure("GRANT_STORE_UNAVAILABLE", "the grant store answered something other than true or false")

  return { ok: true, claims: { ...claims, ...(read.confirmation === "confirmed" ? { cfm: true } : {}) } }
}
