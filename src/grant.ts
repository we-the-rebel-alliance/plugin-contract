/**
 * `@we-the-rebel-alliance/plugin-contract/grant`: the action-grant verifier (contract §8, §13; issue #40).
 *
 * A host signs one action and its exact input for one consumer, capability, account, scope and manifest; a plugin
 * verifies that grant and spends it once through a durable store. No I/O, no clock, no throwing for a bad grant: the
 * verifier answers the claims, or a published code. Every refusal maps to the contract's `GRANT_INVALID`.
 *
 * The token format, the canonical input rules, the key rules and every code are in `docs/grant.md`.
 */
export {
  DEFAULT_CLOCK_SKEW_SEC,
  DEFAULT_MAX_LIFETIME_SEC,
  GRANT_ALG,
  GRANT_INVALID,
  GRANT_TYP,
  MAX_CLOCK_SKEW_SEC,
  MAX_GRANT_LENGTH,
  MAX_INPUT_BYTES,
  MAX_INPUT_DEPTH,
  MAX_LIFETIME_SEC,
} from "./grant/constants.ts"
export { canonicalJson, canonicalScope, digestInput, GrantInputError } from "./grant/input.ts"
export type { GrantScope } from "./grant/input.ts"
export { signGrant } from "./grant/token.ts"
export type { GrantClaims, GrantHeader, GrantKeyMaterial, SignGrantRequest } from "./grant/token.ts"
export { GRANT_CODES, verifyGrant } from "./grant/verify.ts"
export type {
  ConfirmationRule,
  GrantActions,
  GrantCode,
  GrantFailure,
  GrantKeys,
  GrantOutcome,
  GrantRequest,
  GrantStore,
  GrantSuccess,
} from "./grant/verify.ts"
