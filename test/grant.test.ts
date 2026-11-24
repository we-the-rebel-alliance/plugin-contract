// The action-grant verifier (issue #40): the token, the canonical input, every refusal code and the durable single-use
// store. Keys are generated here with `node:crypto`; no fixture, no file and no clock is read.
import { generateKeyPairSync, randomUUID, sign as signBytes, type KeyObject } from "node:crypto"
import { describe, test } from "node:test"
import { expect } from "./support/expect.ts"
import {
  canonicalJson,
  canonicalScope,
  digestInput,
  GRANT_ALG,
  GRANT_CODES,
  GRANT_TYP,
  GrantInputError,
  MAX_GRANT_LENGTH,
  MAX_INPUT_BYTES,
  signGrant,
  verifyGrant,
  type GrantClaims,
  type GrantCode,
  type GrantKeyMaterial,
  type GrantOutcome,
  type GrantRequest,
  type GrantStore,
  type SignGrantRequest,
} from "../src/grant.ts"

const NOW = 1_800_000_000
const MANIFEST = `sha256:${"a".repeat(64)}`
const OTHER_MANIFEST = `sha256:${"b".repeat(64)}`
const KID = "host_2026_11"
const NEW_KID = "host_2026_12"
const ACT = "demo.mail.send"
const PREVIEW = "demo.mail.preview"
const AUDIENCE = "@we-the-rebel-alliance/demo-plugin"
const CONSUMER = "consumer:demo"
const CAPABILITY = "demo.mail.send"
const ACCOUNT = "work"
const SCOPE = { label: ["INBOX", "IMPORTANT"] }
const INPUT = { to: "person@example.com", body: "hello" }

const HOST = generateKeyPairSync("ed25519")
const OTHER = generateKeyPairSync("ed25519")
const PEM = HOST.publicKey.export({ type: "spki", format: "pem" }) as string
const DER = HOST.publicKey.export({ type: "spki", format: "der" })

const BASE_SIGN: Omit<SignGrantRequest, "cfm"> = {
  key: HOST.privateKey,
  kid: KID,
  audience: AUDIENCE,
  consumer: CONSUMER,
  capability: CAPABILITY,
  account: ACCOUNT,
  scope: SCOPE,
  act: ACT,
  input: INPUT,
  manifest: MANIFEST,
  iat: NOW - 5,
  exp: NOW + 55,
  jti: "grant_0001",
}

/** A valid grant, with or without the confirmation claim. */
function signed(overrides: Partial<SignGrantRequest> = {}, confirmed = true): string {
  return signGrant({ ...BASE_SIGN, ...overrides, ...(confirmed ? { cfm: true } : {}) })
}

interface Ledger {
  readonly used: Set<string>
  readonly calls: GrantClaims[]
  readonly store: GrantStore
}

/** A durable ledger's shape: atomic insert-if-absent by `jti`, shared across verifier calls. */
function newLedger(): Ledger {
  const used = new Set<string>()
  const calls: GrantClaims[] = []
  return {
    used,
    calls,
    store: {
      async consume(claims) {
        calls.push(claims)
        if (used.has(claims.jti)) return false
        used.add(claims.jti)
        return true
      },
    },
  }
}

function makeRequest(overrides: Partial<GrantRequest>, ledger: Ledger): GrantRequest {
  return {
    grant: signed(),
    input: INPUT,
    act: ACT,
    actions: { [ACT]: "required" },
    keys: { keys: { [KID]: HOST.publicKey } },
    audience: AUDIENCE,
    consumer: CONSUMER,
    capability: CAPABILITY,
    account: ACCOUNT,
    scope: SCOPE,
    manifest: MANIFEST,
    now: NOW,
    store: ledger.store,
    ...overrides,
  }
}

async function attempt(overrides: Partial<GrantRequest> = {}, ledger: Ledger = newLedger()): Promise<{ outcome: GrantOutcome; calls: GrantClaims[] }> {
  return { outcome: await verifyGrant(makeRequest(overrides, ledger)), calls: ledger.calls }
}

/** Asserts a refusal's exact code, `GRANT_INVALID` and a one-line reason, and that no store write happened. */
async function refuses(code: GrantCode, overrides: Partial<GrantRequest> = {}, ledger: Ledger = newLedger()): Promise<void> {
  const { outcome, calls } = await attempt(overrides, ledger)
  if (outcome.ok) throw new Error(`expected ${code}, the grant verified`)
  expect(outcome.code).toBe(code)
  expect(outcome.contractCode).toBe("GRANT_INVALID")
  expect(outcome.reason.length).toBeLessThanOrEqual(160)
  expect(outcome.reason).not.toMatch(/\n/)
  if (code !== "GRANT_REPLAYED" && code !== "GRANT_STORE_UNAVAILABLE") expect(calls).toHaveLength(0)
}

// ── The token's low-level helpers, used to sign claims that `signGrant` would never write ──────────────────────

const HEADER: Record<string, unknown> = { alg: GRANT_ALG, kid: KID, typ: GRANT_TYP }
const CLAIMS: Record<string, unknown> = {
  aud: AUDIENCE,
  consumer: CONSUMER,
  capability: CAPABILITY,
  account: ACCOUNT,
  scope: { label: ["IMPORTANT", "INBOX"] },
  act: ACT,
  digest: digestInput(INPUT),
  manifest: MANIFEST,
  iat: NOW - 5,
  exp: NOW + 55,
  jti: "grant_0002",
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

function rawPayload(payload: string, header: Record<string, unknown> = HEADER): string {
  const encodedHeader = encode(header)
  const encodedPayload = Buffer.from(payload, "utf8").toString("base64url")
  const signature = signBytes(null, Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"), HOST.privateKey)
  return `${encodedHeader}.${encodedPayload}.${signature.toString("base64url")}`
}

function raw(header: Record<string, unknown>, claims: unknown, key: KeyObject = HOST.privateKey): string {
  const encodedHeader = encode(header)
  const encodedClaims = encode(claims)
  const signature = signBytes(null, Buffer.from(`${encodedHeader}.${encodedClaims}`, "ascii"), key)
  return `${encodedHeader}.${encodedClaims}.${signature.toString("base64url")}`
}

/** A token over exact header and payload text, so a test can write two keys with the same name. */
function rawText(headerText: string, payloadText: string): string {
  const encodedHeader = Buffer.from(headerText, "utf8").toString("base64url")
  const encodedPayload = Buffer.from(payloadText, "utf8").toString("base64url")
  const signature = signBytes(null, Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"), HOST.privateKey)
  return `${encodedHeader}.${encodedPayload}.${signature.toString("base64url")}`
}

function payloadOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>
}

function headerOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>
}

describe("canonical input", () => {
  test("sorts object keys, keeps array order and writes one zero", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":1}')
    expect(canonicalJson({})).toBe("{}")
    expect(canonicalJson([])).toBe("[]")
    expect(canonicalJson("x")).toBe('"x"')
    expect(canonicalJson(-0)).toBe("0")
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }))
  })

  test("sorts keys by UTF-16 code unit, not by locale", () => {
    expect(canonicalJson({ z: 1, A: 2, a: 3, á: 4 })).toBe('{"A":2,"a":3,"z":1,"á":4}')
  })

  test("escapes strings as JSON.stringify does", () => {
    const value = 'a"b\\c\nd\te\u0001f'
    expect(canonicalJson(value)).toBe(JSON.stringify(value))
    expect(canonicalJson("🙂")).toBe('"🙂"')
  })

  test("refuses a number that is not a safe integer rather than digesting it", () => {
    for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53, -(2 ** 53) - 1]) {
      expect(() => canonicalJson({ value }), String(value)).toThrow(/safe integer/)
      expect(() => digestInput({ value }), String(value)).toThrow(/safe integer/)
    }
  })

  test("refuses a value that is not JSON: undefined, bigint, function, symbol, class, Map, Date", () => {
    class Point {
      readonly x = 1
    }
    for (const value of [undefined, 1n, () => 1, Symbol("x"), new Point(), new Map(), new Date(0), new Uint8Array(1)]) {
      expect(() => canonicalJson(value), String(value)).toThrow(/not a JSON value|not a plain object/)
    }
    try {
      canonicalJson(1.5)
    } catch (error) {
      expect(error instanceof GrantInputError).toBe(true)
    }
    expect(() => canonicalJson({ a: undefined })).toThrow(/undefined/)
    expect(() => canonicalJson({ [Symbol("x")]: 1 })).toThrow(/symbol/)
    expect(() => canonicalJson(Object.defineProperty({}, "a", { get: () => 1, enumerable: true }))).toThrow(/accessor/)
    expect(() => canonicalJson(Object.defineProperty({}, "a", { value: 1, enumerable: false }))).toThrow(/non-enumerable/)
  })

  test("refuses a sparse array and an array with a property that is not an index", () => {
    const sparse = [1, 2, 3]
    delete (sparse as unknown[])[1]
    expect(() => canonicalJson(sparse)).toThrow(/sparse/)
    const extra = [1]
    ;(extra as unknown as Record<string, unknown>)["x"] = 2
    expect(() => canonicalJson(extra)).toThrow(/sparse|not an index/)
  })

  test("refuses a lone surrogate rather than replacing it", () => {
    expect(() => canonicalJson("\uD800")).toThrow(/lone surrogate/)
    expect(() => canonicalJson("a\uDC00b")).toThrow(/lone surrogate/)
    expect(canonicalJson("a\uD83D\uDE42b")).toBe(JSON.stringify("a🙂b"))
  })

  test("allows 16 nested objects or arrays and refuses 17", () => {
    const nest = (depth: number) => {
      let value: unknown = 1
      for (let index = 0; index < depth; index++) value = [value]
      return value
    }
    expect(canonicalJson(nest(16))).toBe(`${"[".repeat(16)}1${"]".repeat(16)}`)
    expect(() => canonicalJson(nest(17))).toThrow(/more than 16/)
    const objects = (depth: number) => {
      let value: unknown = 1
      for (let index = 0; index < depth; index++) value = { child: value }
      return value
    }
    expect(() => canonicalJson(objects(17))).toThrow(/more than 16/)
  })

  test("allows exactly 64 KiB of canonical JSON and refuses one byte more", () => {
    expect(canonicalJson("x".repeat(MAX_INPUT_BYTES - 2))).toHaveLength(MAX_INPUT_BYTES)
    expect(() => canonicalJson("x".repeat(MAX_INPUT_BYTES - 1))).toThrow(/over 65536 bytes/)
    expect(() => digestInput({ text: "x".repeat(MAX_INPUT_BYTES) })).toThrow(/over 65536 bytes/)
  })

  test("binds the canonical bytes: key order changes the object, never the digest", () => {
    expect(digestInput({ b: 1, a: 2 })).toBe("sha256:d3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772")
    expect(digestInput({ a: 2, b: 1 })).toBe(digestInput({ b: 1, a: 2 }))
    expect(digestInput(INPUT)).toBe("sha256:0ef586ad7a37f50da5be0d162b5d01bd12edaad795af109712fef1d9360d3958")
  })

  test("canonicalises a scope: sorted keys, sorted and deduplicated lists", () => {
    expect(canonicalScope(undefined)).toEqual({})
    expect(canonicalScope({ b: ["y", "x", "x"], a: "z" })).toEqual({ a: "z", b: ["x", "y"] })
    expect(canonicalScope({ label: ["INBOX", "IMPORTANT"] })).toEqual({ label: ["IMPORTANT", "INBOX"] })
    expect(() => canonicalScope({ a: [] })).toThrow(/list is empty/)
    expect(() => canonicalScope({ a: [1] } as never)).toThrow(/not a string/)
    expect(() => canonicalScope({ "": "x" })).toThrow(/empty/)
    expect(() => canonicalScope({ a: "x\ny" })).toThrow(/control character/)
    expect(() => canonicalScope(JSON.parse('{"__proto__":"x"}') as never)).toThrow(/reserved/)
  })
})

describe("the token", () => {
  test("signs the published header and claims, and nothing else", () => {
    const token = signed()
    expect(token.split(".")).toHaveLength(3)
    expect(headerOf(token)).toEqual({ alg: GRANT_ALG, kid: KID, typ: GRANT_TYP })
    const claims = payloadOf(token)
    expect(Object.keys(claims)).toEqual(["aud", "consumer", "capability", "account", "scope", "act", "digest", "manifest", "iat", "exp", "jti", "cfm"])
    expect(claims).toEqual({
      aud: AUDIENCE,
      consumer: CONSUMER,
      capability: CAPABILITY,
      account: ACCOUNT,
      scope: { label: ["IMPORTANT", "INBOX"] },
      act: ACT,
      digest: digestInput(INPUT),
      manifest: MANIFEST,
      iat: NOW - 5,
      exp: NOW + 55,
      jti: "grant_0001",
      cfm: true,
    })
    expect(Object.hasOwn(payloadOf(signed({}, false)), "cfm")).toBe(false)
  })

  test("a hand-built token verifies: the signature covers header.claims, not our writer", async () => {
    const token = raw(HEADER, { ...CLAIMS, cfm: true })
    const { outcome, calls } = await attempt({ grant: token })
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.claims).toEqual({ ...CLAIMS, scope: { label: ["IMPORTANT", "INBOX"] }, cfm: true } as unknown as GrantClaims)
    expect(calls.map((claims) => claims.jti)).toEqual(["grant_0002"])
  })

  test("signGrant throws on an invalid request or input and needs an explicit private key", async () => {
    expect(() => signed({ kid: "bad kid" })).toThrow(/key id/)
    expect(() => signed({ kid: "host/2026" })).toThrow(/key id/)
    expect(() => signed({ jti: "grant/0001" })).toThrow(/grant id/)
    expect(() => signed({ account: "Work" })).toThrow(/account/)
    expect(() => signed({ manifest: "abc" })).toThrow(/manifest hash/)
    expect(() => signed({ iat: NOW, exp: NOW })).toThrow(/lifetime/)
    expect(() => signed({ input: 1.5 })).toThrow(/safe integer/)
    expect(() => signGrant({ ...BASE_SIGN, cfm: false as unknown as true })).toThrow(/cfm/)
    expect(() => signGrant({ ...BASE_SIGN, key: HOST.publicKey })).toThrow(/private key/)
    expect(() => signGrant({ ...BASE_SIGN, key: "not a pem" })).toThrow(/PEM/)
    const der = HOST.privateKey.export({ type: "pkcs8", format: "der" })
    const pem = HOST.privateKey.export({ type: "pkcs8", format: "pem" }) as string
    for (const key of [der, pem]) {
      const { outcome } = await attempt({ grant: signGrant({ ...BASE_SIGN, key, cfm: true }) })
      expect(outcome.ok).toBe(true)
    }
  })

  test("reports every refusal code once, in alphabetical order", () => {
    expect(new Set(GRANT_CODES).size).toBe(GRANT_CODES.length)
    expect([...GRANT_CODES].sort()).toEqual([...GRANT_CODES])
    expect(GRANT_CODES).toContain("GRANT_MALFORMED")
    expect(GRANT_CODES).toContain("GRANT_REPLAYED")
  })
})

describe("verifyGrant: valid grants", () => {
  test("verifies a grant and returns its claims, spending the jti once", async () => {
    const { outcome, calls } = await attempt()
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(calls.map((claims) => claims.jti)).toEqual(["grant_0001"])
    expect(outcome.kid).toBe(KID)
    expect(outcome.claims.aud).toBe(AUDIENCE)
    expect(outcome.claims.consumer).toBe(CONSUMER)
    expect(outcome.claims.capability).toBe(CAPABILITY)
    expect(outcome.claims.account).toBe(ACCOUNT)
    expect(outcome.claims.act).toBe(ACT)
    expect(outcome.claims.manifest).toBe(MANIFEST)
    expect(outcome.claims.scope).toEqual({ label: ["IMPORTANT", "INBOX"] })
    expect(outcome.claims.cfm).toBe(true)
  })

  test("accepts a base64url thumbprint key id with a hyphen and an underscore", async () => {
    const thumbprint = "NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs"
    expect(thumbprint).toContain("-")
    expect(thumbprint).toContain("_")
    const grant = signed({ kid: thumbprint })
    const { outcome } = await attempt({ grant, keys: { keys: { [thumbprint]: HOST.publicKey } } })
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.kid).toBe(thumbprint)
    expect(outcome.claims.act).toBe(ACT)
  })

  test("accepts a crypto.randomUUID() jti", async () => {
    const jti = randomUUID()
    expect(jti).toContain("-")
    const { outcome, calls } = await attempt({ grant: signed({ jti }) })
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.claims.jti).toBe(jti)
    expect(calls.map((claims) => claims.jti)).toEqual([jti])
  })

  test("accepts a scope in any key or value order, and returns it canonical", async () => {
    const grant = signed({ scope: { label: ["IMPORTANT", "INBOX", "INBOX"] } })
    const { outcome } = await attempt({ grant, scope: { label: ["INBOX", "IMPORTANT"] } })
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.claims.scope).toEqual({ label: ["IMPORTANT", "INBOX"] })
  })

  test("verifies an input whose keys are in another order: the digest is canonical", async () => {
    const grant = signed({ input: { a: 1, b: { c: 2, d: 3 } } })
    const { outcome } = await attempt({ grant, input: { b: { d: 3, c: 2 }, a: 1 } })
    expect(outcome.ok).toBe(true)
  })

  test("verifies a whole-source grant with an empty scope", async () => {
    const grant = signed({ scope: {} })
    const { outcome } = await attempt({ grant, scope: {} })
    expect(outcome.ok).toBe(true)
    const omitted = await attempt({ grant, scope: undefined as never })
    expect(omitted.outcome.ok).toBe(true)
  })

  test("takes a KeyObject, a PEM string or SPKI DER as the trusted key", async () => {
    const grant = signed()
    for (const material of [HOST.publicKey, PEM, DER] as GrantKeyMaterial[]) {
      const outcome = await verifyGrant(makeRequest({ grant, keys: { keys: { [KID]: material } } }, newLedger()))
      expect(outcome.ok).toBe(true)
    }
  })
})

describe("verifyGrant: keys, rotation and signatures", () => {
  test("rotates keys: the new kid verifies while the old one stays trusted", async () => {
    const grant = signed({ key: OTHER.privateKey, kid: NEW_KID })
    const { outcome } = await attempt({ grant, keys: { keys: { [KID]: HOST.publicKey, [NEW_KID]: OTHER.publicKey } } })
    expect(outcome.ok).toBe(true)
  })

  test("refuses a revoked kid before checking its signature", async () => {
    await refuses("GRANT_KEY_UNKNOWN", { grant: signed({ key: OTHER.privateKey }), keys: { keys: { [KID]: HOST.publicKey }, revoked: [KID] } })
    await refuses("GRANT_KEY_UNKNOWN", { keys: { keys: { [KID]: HOST.publicKey }, revoked: [KID] } })
  })

  test("refuses a kid no trusted key names", async () => {
    await refuses("GRANT_KEY_UNKNOWN", { grant: signed({ kid: "host_unknown" }) })
  })

  test("refuses a grant signed by another key under a trusted kid", async () => {
    await refuses("GRANT_SIGNATURE_INVALID", { keys: { keys: { [KID]: OTHER.publicKey } } })
  })

  test("refuses a tampered or truncated signature", async () => {
    const token = signed()
    const [header, claims] = token.split(".")
    await refuses("GRANT_SIGNATURE_INVALID", { grant: `${header}.${claims}.${Buffer.alloc(64).toString("base64url")}` })
    await refuses("GRANT_SIGNATURE_INVALID", { grant: `${header}.${claims}.${Buffer.alloc(10).toString("base64url")}` })
  })

  test("refuses a trusted key that is not an Ed25519 public key", async () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" })
    await refuses("GRANT_REQUEST_INVALID", { keys: { keys: { [KID]: ec.publicKey } } })
    await refuses("GRANT_REQUEST_INVALID", { keys: { keys: { [KID]: "not a key" } } })
  })

  test("refuses private key material as a trusted key on every path", async () => {
    const privatePem = HOST.privateKey.export({ type: "pkcs8", format: "pem" }) as string
    const encryptedPem = HOST.privateKey.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: "fixture-passphrase" }) as string
    const privateDer = HOST.privateKey.export({ type: "pkcs8", format: "der" })
    for (const material of [HOST.privateKey, privatePem, encryptedPem, privateDer] as GrantKeyMaterial[]) {
      await refuses("GRANT_REQUEST_INVALID", { keys: { keys: { [KID]: material } } })
    }
  })
})

describe("verifyGrant: malformed tokens, headers and claims", () => {
  test("refuses a token that is not three canonical base64url segments", async () => {
    const token = signed()
    for (const grant of ["", "a", "a.b", "a.b.c.d", `${token}=`, `${token.split(".")[0]}.${token.split(".")[1]}.`, "a.b.c!", `${"a".repeat(MAX_GRANT_LENGTH + 1)}.b.c`, 42 as unknown as string]) {
      await refuses("GRANT_MALFORMED", { grant })
    }
  })

  test("refuses a header that is not exactly alg, kid and typ, or not UTF-8 JSON", async () => {
    for (const header of [
      { ...HEADER, crit: true },
      { alg: GRANT_ALG, kid: KID },
      { ...HEADER, typ: "JWT" },
      { ...HEADER, kid: "bad kid" },
      { ...HEADER, kid: "host/2026" },
      [{ ...HEADER }],
    ]) {
      await refuses("GRANT_MALFORMED", { grant: raw(header as Record<string, unknown>, CLAIMS) })
    }
    const signature = Buffer.alloc(64).toString("base64url")
    await refuses("GRANT_MALFORMED", { grant: `${Buffer.from([0xff]).toString("base64url")}.${encode(CLAIMS)}.${signature}` })
    await refuses("GRANT_MALFORMED", { grant: `${encode(HEADER)}.${Buffer.from([0xff]).toString("base64url")}.${signature}` })
  })

  test("refuses a duplicate key at any depth in the header or the claims", async () => {
    const headerText = JSON.stringify(HEADER)
    const duplicatedKid = headerText.replace(`"kid":${JSON.stringify(KID)}`, `"kid":"first","kid":${JSON.stringify(KID)}`)
    await refuses("GRANT_MALFORMED", { grant: rawText(duplicatedKid, JSON.stringify({ ...CLAIMS, cfm: true })) })

    const claimsText = JSON.stringify({ ...CLAIMS, cfm: true })
    const duplicatedAud = claimsText.replace(/^\{/, '{"aud":"other",')
    await refuses("GRANT_CLAIMS_INVALID", { grant: rawText(headerText, duplicatedAud) })
    const duplicatedScope = claimsText.replace(/"scope":\{[^}]*\}/, '"scope":{"label":["INBOX"],"label":["IMPORTANT"]}')
    await refuses("GRANT_CLAIMS_INVALID", { grant: rawText(headerText, duplicatedScope) })
  })

  test("refuses an algorithm other than Ed25519, never downgrading", async () => {
    for (const alg of ["none", "HS256", "ES256", "EdDSA", ""]) {
      await refuses("GRANT_UNSUPPORTED_ALGORITHM", { grant: raw({ ...HEADER, alg }, CLAIMS) })
    }
  })

  test("refuses claims that are not a JSON object with the published shape", async () => {
    await refuses("GRANT_CLAIMS_INVALID", { grant: rawPayload("not json") })
    await refuses("GRANT_CLAIMS_INVALID", { grant: rawPayload("[]") })
    await refuses("GRANT_CLAIMS_INVALID", { grant: rawPayload("null") })
    await refuses("GRANT_CLAIMS_INVALID", { grant: raw(HEADER, { ...CLAIMS, extra: 1 }) })
    for (const key of ["aud", "consumer", "capability", "account", "scope", "act", "digest", "manifest", "iat", "exp", "jti"]) {
      const claims: Record<string, unknown> = { ...CLAIMS }
      delete claims[key]
      await refuses("GRANT_CLAIMS_INVALID", { grant: raw(HEADER, claims) })
    }
    for (const claims of [
      { ...CLAIMS, aud: 1 },
      { ...CLAIMS, account: "Work" },
      { ...CLAIMS, act: "" },
      { ...CLAIMS, digest: "sha256:xyz" },
      { ...CLAIMS, manifest: `sha256:${"A".repeat(64)}` },
      { ...CLAIMS, iat: "1800000000" },
      { ...CLAIMS, iat: 1.5 },
      { ...CLAIMS, exp: -1 },
      { ...CLAIMS, jti: "bad jti" },
      { ...CLAIMS, scope: { a: 1 } },
      { ...CLAIMS, scope: { a: [] } },
    ]) {
      await refuses("GRANT_CLAIMS_INVALID", { grant: raw(HEADER, claims) })
    }
  })
})

describe("verifyGrant: bindings", () => {
  test("refuses another audience", async () => {
    await refuses("GRANT_AUDIENCE_MISMATCH", { grant: signed({ audience: "app:other" }) })
  })

  test("refuses another consumer", async () => {
    await refuses("GRANT_CONSUMER_MISMATCH", { grant: signed({ consumer: "consumer:other" }) })
  })

  test("refuses another capability", async () => {
    await refuses("GRANT_CAPABILITY_MISMATCH", { grant: signed({ capability: "demo.mail.other" }) })
  })

  test("refuses another account", async () => {
    await refuses("GRANT_ACCOUNT_MISMATCH", { grant: signed({ account: "personal" }) })
  })

  test("refuses another scope, including a string where the action takes a list", async () => {
    await refuses("GRANT_SCOPE_MISMATCH", { grant: signed({ scope: { label: ["INBOX"] } }) })
    await refuses("GRANT_SCOPE_MISMATCH", { grant: signed({ scope: { label: "INBOX" } }) })
  })

  test("refuses another manifest: a changed manifest asks the person again", async () => {
    await refuses("GRANT_MANIFEST_MISMATCH", { grant: signed({ manifest: OTHER_MANIFEST }) })
  })

  test("refuses another action", async () => {
    await refuses("GRANT_ACTION_MISMATCH", { act: PREVIEW, actions: { [ACT]: "required", [PREVIEW]: "required" } })
  })

  test("refuses an action the verifier does not accept, before any cryptography", async () => {
    await refuses("GRANT_ACTION_DISALLOWED", { act: "demo.mail.delete" })
  })
})

describe("verifyGrant: time window", () => {
  test("refuses an expired grant, and one that expires exactly now", async () => {
    await refuses("GRANT_EXPIRED", { grant: signed({ iat: NOW - 100, exp: NOW - 40 }) })
    await refuses("GRANT_EXPIRED", { grant: signed({ iat: NOW - 60, exp: NOW }) })
  })

  test("refuses a grant that is not valid yet, beyond the 5 second clock skew", async () => {
    await refuses("GRANT_NOT_YET_VALID", { grant: signed({ iat: NOW + 100, exp: NOW + 160 }) })
    await refuses("GRANT_NOT_YET_VALID", { grant: signed({ iat: NOW + 6, exp: NOW + 66 }) })
  })

  test("accepts a grant inside the clock skew and at the last valid second", async () => {
    const early = await attempt({ grant: signed({ iat: NOW + 3, exp: NOW + 63 }) })
    expect(early.outcome.ok).toBe(true)
    const boundary = await attempt({ grant: signed({ iat: NOW + 5, exp: NOW + 65 }) })
    expect(boundary.outcome.ok).toBe(true)
    const last = await attempt({ grant: signed({ iat: NOW - 59, exp: NOW + 1 }) })
    expect(last.outcome.ok).toBe(true)
  })

  test("refuses a lifetime over the maximum, a zero lifetime and a negative one", async () => {
    await refuses("GRANT_LIFETIME_INVALID", { grant: signed({ iat: NOW - 5, exp: NOW + 400 }) })
    await refuses("GRANT_LIFETIME_INVALID", { grant: raw(HEADER, { ...CLAIMS, iat: NOW, exp: NOW, cfm: true }) })
    await refuses("GRANT_LIFETIME_INVALID", { grant: raw(HEADER, { ...CLAIMS, iat: NOW, exp: NOW - 1, cfm: true }) })
  })

  test("caps the maximum lifetime at 300 seconds and the clock skew at 30", async () => {
    const long = signed({ iat: NOW - 100, exp: NOW + 100 }) // 200 seconds
    await refuses("GRANT_LIFETIME_INVALID", { grant: long })
    const accepted = await attempt({ grant: long, maxLifetimeSec: 300 })
    expect(accepted.outcome.ok).toBe(true)
    await refuses("GRANT_REQUEST_INVALID", { grant: long, maxLifetimeSec: 301 })
    await refuses("GRANT_REQUEST_INVALID", { grant: long, maxLifetimeSec: 600 })
    const wide = await attempt({ grant: signed({ iat: NOW + 30, exp: NOW + 90 }), clockSkewSec: 30 })
    expect(wide.outcome.ok).toBe(true)
    await refuses("GRANT_REQUEST_INVALID", { clockSkewSec: 31 })
  })
})

describe("verifyGrant: input digest", () => {
  test("refuses a different input without spending the grant", async () => {
    const ledger = newLedger()
    await refuses("GRANT_DIGEST_MISMATCH", { input: { ...INPUT, body: "changed" } }, ledger)
    const { outcome } = await attempt({}, ledger)
    expect(outcome.ok).toBe(true)
  })

  test("refuses an input outside the canonical rules, rather than digesting it", async () => {
    const nest = (depth: number) => {
      let value: unknown = 1
      for (let index = 0; index < depth; index++) value = [value]
      return value
    }
    for (const input of [1.5, Number.NaN, 2 ** 53, "\uD800", nest(17), "x".repeat(MAX_INPUT_BYTES), { a: undefined }, new Date(0)]) {
      await refuses("GRANT_INPUT_INVALID", { input })
    }
  })
})

describe("verifyGrant: confirmation", () => {
  test("requires cfm when the action's rule requires it", async () => {
    await refuses("GRANT_CONFIRMATION_REQUIRED", { grant: signed({}, false) })
    const { outcome } = await attempt({ grant: signed({}, true) })
    expect(outcome.ok).toBe(true)
  })

  test("refuses a confirmation that is not true, under either rule", async () => {
    for (const cfm of [false, "always", 1, null]) {
      await refuses("GRANT_CONFIRMATION_INVALID", { grant: raw(HEADER, { ...CLAIMS, cfm }) })
      await refuses("GRANT_CONFIRMATION_INVALID", { grant: raw(HEADER, { ...CLAIMS, cfm }), actions: { [ACT]: "optional" } })
    }
  })

  test("accepts an absent confirmation when the action's rule is optional", async () => {
    const absent = await attempt({ grant: signed({}, false), actions: { [ACT]: "optional" } })
    expect(absent.outcome.ok).toBe(true)
    const present = await attempt({ grant: signed({}, true), actions: { [ACT]: "optional" } })
    expect(present.outcome.ok).toBe(true)
  })
})

describe("verifyGrant: single use and the store", () => {
  test("spends a grant once: the second call is a replay", async () => {
    const ledger = newLedger()
    const grant = signed()
    const first = await attempt({ grant }, ledger)
    expect(first.outcome.ok).toBe(true)
    await refuses("GRANT_REPLAYED", { grant }, ledger)
    expect(ledger.calls.map((claims) => claims.jti)).toEqual(["grant_0001", "grant_0001"])
  })

  test("passes the full verified claims to the store, including exp and cfm", async () => {
    const ledger = newLedger()
    const { outcome } = await attempt({ grant: signed() }, ledger)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(ledger.calls).toHaveLength(1)
    expect(ledger.calls[0]).toEqual(outcome.claims)
    expect(ledger.calls[0]!.exp).toBe(NOW + 55)
    expect(ledger.calls[0]!.cfm).toBe(true)
  })

  test("two concurrent verifications of one grant spend it once", async () => {
    const ledger = newLedger()
    const grant = signed()
    const outcomes = await Promise.all([verifyGrant(makeRequest({ grant }, ledger)), verifyGrant(makeRequest({ grant }, ledger))])
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
    const refused = outcomes.find((outcome) => !outcome.ok)
    if (refused === undefined || refused.ok) throw new Error("both verifications succeeded")
    expect(refused.code).toBe("GRANT_REPLAYED")
    expect(ledger.calls).toHaveLength(2)
  })

  test("a fresh verifier over the same durable store still refuses a spent grant", async () => {
    // A restart keeps the ledger and loses everything else; the verifier is stateless, so a new request is a restart.
    const ledger = newLedger()
    const grant = signed()
    const first = await attempt({ grant }, ledger)
    expect(first.outcome.ok).toBe(true)
    const afterRestart = await verifyGrant(makeRequest({ grant }, ledger))
    expect(afterRestart.ok).toBe(false)
    if (afterRestart.ok) return
    expect(afterRestart.code).toBe("GRANT_REPLAYED")
  })

  test("a store that throws is a refusal, never a crash", async () => {
    const store: GrantStore = {
      async consume() {
        throw new Error("the database is down")
      },
    }
    await refuses("GRANT_STORE_UNAVAILABLE", { store })
  })

  test("a store that answers something other than true or false is a refusal", async () => {
    const store = { consume: async () => 1 } as unknown as GrantStore
    await refuses("GRANT_STORE_UNAVAILABLE", { store })
    const nothing = { consume: async () => undefined } as unknown as GrantStore
    await refuses("GRANT_STORE_UNAVAILABLE", { store: nothing })
  })
})

describe("verifyGrant: the request is the plugin's own", () => {
  test("refuses a request that is not a map or an action with no rule", async () => {
    await refuses("GRANT_REQUEST_INVALID", { actions: undefined as unknown as Record<string, "required"> })
    await refuses("GRANT_REQUEST_INVALID", { actions: { [ACT]: "sometimes" as "required" } })
    await refuses("GRANT_REQUEST_INVALID", { keys: {} as never })
    await refuses("GRANT_REQUEST_INVALID", { keys: { keys: { [KID]: HOST.publicKey }, revoked: "all" as never } })
    await refuses("GRANT_REQUEST_INVALID", { manifest: "not-a-hash" })
    await refuses("GRANT_REQUEST_INVALID", { account: "Work" })
    await refuses("GRANT_REQUEST_INVALID", { scope: { label: [1] } as never })
    await refuses("GRANT_REQUEST_INVALID", { now: Number.NaN })
    await refuses("GRANT_REQUEST_INVALID", { clockSkewSec: -1 })
    await refuses("GRANT_REQUEST_INVALID", { maxLifetimeSec: 0 })
    await refuses("GRANT_REQUEST_INVALID", { store: {} as GrantStore })
  })

  test("never throws for a bad grant: every value comes back as a refusal", async () => {
    for (const grant of [undefined, null, 0, {}, "", "x", "a.b.c", `${"a".repeat(MAX_GRANT_LENGTH + 1)}.b.c`]) {
      const outcome = await verifyGrant(makeRequest({ grant: grant as string }, newLedger()))
      expect(outcome.ok).toBe(false)
    }
  })
})
