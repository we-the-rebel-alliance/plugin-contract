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
 *   "capability": "<name>.<method>, or the source capability id",
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
import { createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto"
import { TextDecoder } from "node:util"
import { GRANT_ALG, GRANT_TYP, MAX_GRANT_LENGTH } from "./constants.ts"
import { canonicalScope, digestInput, type GrantScope } from "./input.ts"
import { strictJson } from "./json.ts"
import { accountProblem, hashProblem, isPlainObject, jtiProblem, kidProblem, textProblem } from "./text.ts"

/** The header of an action grant. No other member is accepted. */
export interface GrantHeader {
  readonly alg: typeof GRANT_ALG
  readonly kid: string
  readonly typ: typeof GRANT_TYP
}

/** The claims a verified grant carries. `scope` is returned in canonical form. */
export interface GrantClaims {
  /** The plugin's package name as the host uses it, for example `@we-the-rebel-alliance/slack-plugin`. */
  readonly aud: string
  /** The grant key: the consumer the grant was issued to. */
  readonly consumer: string
  /** The method id `<name>.<method>`, for example `slack.events_list`, or the source capability id where the contract calls it that. */
  readonly capability: string
  readonly account: string
  readonly scope: GrantScope
  readonly act: string
  readonly digest: string
  readonly manifest: string
  readonly iat: number
  readonly exp: number
  readonly jti: string
  /** Present, and `true`, only when a person confirmed the action in the host's UI. */
  readonly cfm?: true
}

/**
 * Key material: a `KeyObject`, a PEM string, or DER bytes. `signGrant` wants a private key; `GrantKeys` wants public
 * keys (SPKI DER). The module never reads a file or a key store.
 */
export type GrantKeyMaterial = KeyObject | string | Uint8Array

/** What a host passes to `signGrant`. The private key is explicit: only a host signs. */
export interface SignGrantRequest {
  readonly key: GrantKeyMaterial
  readonly kid: string
  /** The plugin's package name as the host uses it. */
  readonly audience: string
  /** The grant key: the consumer the grant is issued to. */
  readonly consumer: string
  /** The method id `<name>.<method>`, or the source capability id where the contract calls it that. */
  readonly capability: string
  readonly account: string
  readonly scope?: GrantScope
  readonly act: string
  /** The exact input the action will run with. Its canonical digest is bound into the grant. */
  readonly input: unknown
  /** `sha256:<64 lowercase hex digits>` of the manifest's canonical JSON. */
  readonly manifest: string
  /** Whole seconds since the Unix epoch. */
  readonly iat: number
  /** Whole seconds since the Unix epoch; after `iat`, and short. */
  readonly exp: number
  readonly jti: string
  readonly cfm?: true
}

/** The token split apart, with its header read strictly and its signature still to verify. */
export type ParsedToken =
  | {
      readonly ok: true
      readonly header: GrantHeader
      /** The exact bytes the signature covers: the two base64url segments and the dot between them. */
      readonly signingInput: Buffer
      /** The payload decoded as UTF-8 text, not yet parsed or checked. */
      readonly payload: string
      readonly signature: Buffer
    }
  | { readonly ok: false; readonly code: "GRANT_MALFORMED" | "GRANT_UNSUPPORTED_ALGORITHM"; readonly reason: string }

/** The claims read and checked, or why they are not usable. `cfm` is judged separately by the confirmation rule. */
export type ReadClaimsResult =
  | {
      readonly ok: true
      readonly claims: Omit<GrantClaims, "cfm">
      readonly confirmation: "absent" | "confirmed" | "invalid"
    }
  | { readonly ok: false; readonly code: "GRANT_CLAIMS_INVALID"; readonly reason: string }

const BASE64URL = /^[A-Za-z0-9_-]+$/
/** A PEM private key of any label: PKCS#8, RSA, EC, DSA, OpenSSH or an encrypted one. Never trusted as a public key. */
const PRIVATE_PEM = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/
const HEADER_KEYS = ["alg", "kid", "typ"] as const
const CLAIM_KEYS = ["account", "act", "aud", "capability", "consumer", "digest", "exp", "iat", "jti", "manifest", "scope"] as const
const decoder = new TextDecoder("utf-8", { fatal: true })

function decodeSegment(segment: string): Buffer | undefined {
  if (segment.length === 0 || !BASE64URL.test(segment)) return undefined
  const bytes = Buffer.from(segment, "base64url")
  // Re-encoding catches padding, a non-canonical last character and any other alternate spelling.
  return bytes.toString("base64url") === segment ? bytes : undefined
}

function decodeText(bytes: Uint8Array): string | undefined {
  try {
    return decoder.decode(bytes)
  } catch {
    return undefined
  }
}

function malformed(reason: string): ParsedToken {
  return { ok: false, code: "GRANT_MALFORMED", reason }
}

/**
 * Splits a compact grant and checks the token and header syntax: three canonical base64url segments, a UTF-8 header
 * that is a plain object with exactly `alg`, `kid` and `typ`, the published `typ`, the one algorithm, and a usable
 * `kid`. The claims are not read here, and no signature is checked.
 */
export function parseToken(token: unknown): ParsedToken {
  if (typeof token !== "string") return malformed("the grant is not a string")
  if (token.length === 0) return malformed("the grant is empty")
  if (token.length > MAX_GRANT_LENGTH) return malformed(`the grant is over ${MAX_GRANT_LENGTH} characters`)
  const parts = token.split(".")
  if (parts.length !== 3) return malformed("the grant is not header.payload.signature")
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string]
  const headerBytes = decodeSegment(headerSegment)
  const payloadBytes = decodeSegment(payloadSegment)
  const signature = decodeSegment(signatureSegment)
  if (headerBytes === undefined) return malformed("the grant's header is not canonical base64url")
  if (payloadBytes === undefined) return malformed("the grant's claims are not canonical base64url")
  if (signature === undefined) return malformed("the grant's signature is not canonical base64url")

  const headerText = decodeText(headerBytes)
  if (headerText === undefined) return malformed("the grant's header is not UTF-8")
  const headerJson = strictJson(headerText, "the grant's header")
  if (!headerJson.ok) return malformed(headerJson.reason)
  const headerValue = headerJson.value
  if (!isPlainObject(headerValue)) return malformed("the grant's header is not an object")
  const keys = Object.keys(headerValue)
  if (keys.length !== HEADER_KEYS.length || !HEADER_KEYS.every((key) => keys.includes(key))) {
    return malformed("the grant's header is not exactly alg, kid and typ")
  }
  const { alg, kid, typ } = headerValue
  if (typeof typ !== "string" || typ !== GRANT_TYP) return malformed(`the grant's typ is not ${GRANT_TYP}`)
  if (typeof alg !== "string") return malformed("the grant's alg is not a string")
  if (alg !== GRANT_ALG) return { ok: false, code: "GRANT_UNSUPPORTED_ALGORITHM", reason: `the grant's alg is not ${GRANT_ALG}` }
  const kidText = kidProblem(kid)
  if (kidText !== undefined) return malformed(kidText)

  const payload = decodeText(payloadBytes)
  if (payload === undefined) return malformed("the grant's claims are not UTF-8")
  return {
    ok: true,
    header: { alg: GRANT_ALG, kid: kid as string, typ: GRANT_TYP },
    signingInput: Buffer.from(`${headerSegment}.${payloadSegment}`, "ascii"),
    payload,
    signature,
  }
}

function claimsFailure(reason: string): ReadClaimsResult {
  return { ok: false, code: "GRANT_CLAIMS_INVALID", reason }
}

function wholeSeconds(value: unknown, what: string): string | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? undefined : `${what} is not a whole number of seconds`
}

/**
 * Reads the claims and checks their shape: a JSON object with exactly the published claims, every value of the right
 * kind, every hash in the published form and every text claim free of control characters and lone surrogates. `cfm`
 * is reported as absent, confirmed or invalid; the confirmation rule decides whether that is a refusal.
 */
export function readClaims(payload: string): ReadClaimsResult {
  const parsed = strictJson(payload, "the grant's claims")
  if (!parsed.ok) return claimsFailure(parsed.reason)
  const value = parsed.value
  if (!isPlainObject(value)) return claimsFailure("the grant's claims are not an object")
  const allowed = new Set<string>([...CLAIM_KEYS, "cfm"])
  if (Object.keys(value).some((key) => !allowed.has(key))) return claimsFailure("the grant holds a claim this verifier does not know")
  for (const key of CLAIM_KEYS) {
    if (!Object.hasOwn(value, key)) return claimsFailure(`the grant has no ${key} claim`)
  }

  const problems: readonly [unknown, string][] = [
    [value["aud"], "the audience"],
    [value["consumer"], "the consumer"],
    [value["capability"], "the capability"],
    [value["act"], "the action"],
  ]
  for (const [claim, what] of problems) {
    const problem = textProblem(claim, what)
    if (problem !== undefined) return claimsFailure(problem)
  }
  const account = accountProblem(value["account"])
  if (account !== undefined) return claimsFailure(account)
  const digest = hashProblem(value["digest"], "the input digest")
  if (digest !== undefined) return claimsFailure(digest)
  const manifest = hashProblem(value["manifest"], "the manifest hash")
  if (manifest !== undefined) return claimsFailure(manifest)
  const iat = wholeSeconds(value["iat"], "the iat")
  if (iat !== undefined) return claimsFailure(iat)
  const exp = wholeSeconds(value["exp"], "the exp")
  if (exp !== undefined) return claimsFailure(exp)
  const jti = jtiProblem(value["jti"])
  if (jti !== undefined) return claimsFailure(jti)

  let scope: GrantScope
  try {
    scope = canonicalScope(value["scope"] as GrantScope)
  } catch (error) {
    return claimsFailure(error instanceof Error ? error.message : "the scope cannot be read")
  }

  const confirmation = !Object.hasOwn(value, "cfm") ? "absent" : value["cfm"] === true ? "confirmed" : "invalid"
  return {
    ok: true,
    claims: {
      aud: value["aud"] as string,
      consumer: value["consumer"] as string,
      capability: value["capability"] as string,
      account: value["account"] as string,
      scope,
      act: value["act"] as string,
      digest: value["digest"] as string,
      manifest: value["manifest"] as string,
      iat: value["iat"] as number,
      exp: value["exp"] as number,
      jti: value["jti"] as string,
    },
    confirmation,
  }
}

function isKeyObject(value: unknown): value is KeyObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Uint8Array) &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { asymmetricKeyType?: unknown }).asymmetricKeyType === "string" &&
    typeof (value as { export?: unknown }).export === "function"
  )
}

/**
 * The Ed25519 public key `material` names, or nothing when it is not one. A `KeyObject` is used as it is, a string is
 * read as PEM, and bytes are read as SPKI DER. Private key material is refused on every path: a private `KeyObject`, a
 * private PEM (including an encrypted one) and private DER are never turned into a trusted public key. A trusted key
 * that cannot be read is a configuration error, never a reason to try another key.
 */
export function toPublicKey(material: GrantKeyMaterial): KeyObject | undefined {
  let key: KeyObject
  if (isKeyObject(material)) {
    key = material
  } else if (typeof material === "string") {
    // `createPublicKey` happily derives a public key from a private PEM; a trusted key must never be private material.
    if (PRIVATE_PEM.test(material)) return undefined
    try {
      key = createPublicKey(material)
    } catch {
      return undefined
    }
  } else if (material instanceof Uint8Array) {
    try {
      key = createPublicKey({ key: Buffer.from(material), format: "der", type: "spki" })
    } catch {
      return undefined
    }
  } else {
    return undefined
  }
  return key.type === "public" && key.asymmetricKeyType === "ed25519" ? key : undefined
}

function privateKey(material: GrantKeyMaterial): KeyObject {
  let key: KeyObject
  if (isKeyObject(material)) {
    key = material
  } else if (typeof material === "string") {
    try {
      key = createPrivateKey(material)
    } catch {
      throw new Error("grant: the signing key cannot be read as PEM")
    }
  } else if (material instanceof Uint8Array) {
    try {
      key = createPrivateKey({ key: Buffer.from(material), format: "der", type: "pkcs8" })
    } catch {
      throw new Error("grant: the signing key cannot be read as PKCS8 DER")
    }
  } else {
    throw new Error("grant: the signing key is not a private key")
  }
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") throw new Error("grant: the signing key is not an Ed25519 private key")
  return key
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

/**
 * Signs a grant: the host's side of the format, for a host and for tests. The private key is explicit and never read
 * from a file here. Throws when the request is invalid or the input is outside the canonical rules.
 *
 * A plugin never calls this. A plugin holds public keys and calls `verifyGrant`.
 */
export function signGrant(request: SignGrantRequest): string {
  const kid = kidProblem(request.kid)
  if (kid !== undefined) throw new Error(`grant: ${kid}`)
  const aud = textProblem(request.audience, "the audience")
  if (aud !== undefined) throw new Error(`grant: ${aud}`)
  const consumer = textProblem(request.consumer, "the consumer")
  if (consumer !== undefined) throw new Error(`grant: ${consumer}`)
  const capability = textProblem(request.capability, "the capability")
  if (capability !== undefined) throw new Error(`grant: ${capability}`)
  const account = accountProblem(request.account)
  if (account !== undefined) throw new Error(`grant: ${account}`)
  const act = textProblem(request.act, "the action")
  if (act !== undefined) throw new Error(`grant: ${act}`)
  const manifest = hashProblem(request.manifest, "the manifest hash")
  if (manifest !== undefined) throw new Error(`grant: ${manifest}`)
  const jti = jtiProblem(request.jti)
  if (jti !== undefined) throw new Error(`grant: ${jti}`)
  const iat = wholeSeconds(request.iat, "the iat")
  if (iat !== undefined) throw new Error(`grant: ${iat}`)
  const exp = wholeSeconds(request.exp, "the exp")
  if (exp !== undefined) throw new Error(`grant: ${exp}`)
  if (request.exp <= request.iat) throw new Error("grant: the lifetime is not positive")
  if (request.cfm !== undefined && request.cfm !== true) throw new Error("grant: cfm, when present, is true")
  const scope = canonicalScope(request.scope)
  const digest = digestInput(request.input)
  const key = privateKey(request.key)

  const claims = {
    aud: request.audience,
    consumer: request.consumer,
    capability: request.capability,
    account: request.account,
    scope,
    act: request.act,
    digest,
    manifest: request.manifest,
    iat: request.iat,
    exp: request.exp,
    jti: request.jti,
    ...(request.cfm === true ? { cfm: true } : {}),
  }
  const header: GrantHeader = { alg: GRANT_ALG, kid: request.kid, typ: GRANT_TYP }
  const encodedHeader = encode(header)
  const encodedClaims = encode(claims)
  const signature = sign(null, Buffer.from(`${encodedHeader}.${encodedClaims}`, "ascii"), key)
  return `${encodedHeader}.${encodedClaims}.${signature.toString("base64url")}`
}
