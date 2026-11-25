/**
 * The one test-grant exemption the kit allows: a compact grant token that the fixture's own public key verifies.
 *
 * A conformance fixture records public test grants so the grant verifier has cases to replay. The token is safe to
 * commit only when its signature verifies with the public key beside it; anything else in a grant field is ordinary
 * data and follows the normal secret rules.
 */
import { createPublicKey, verify } from "node:crypto"

/** Whether a value is an Ed25519 public key the verifier can use. */
export function isEd25519PublicKey(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    return createPublicKey(value).asymmetricKeyType === "ed25519"
  } catch {
    return false
  }
}

/** One compact grant token's signature, checked against an Ed25519 public key. */
export function verifiesGrantToken(token: unknown, publicKey: unknown): boolean {
  if (typeof token !== "string" || typeof publicKey !== "string") return false
  const parts = token.split(".")
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return false
  try {
    const key = createPublicKey(publicKey)
    const signature = Buffer.from(parts[2]!, "base64url")
    return verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"), key, signature)
  } catch {
    return false
  }
}

/** The tokens in one fixture's `grants.cases` that verify with its `grants.publicKey`. */
export function verifiedGrantTokens(value: unknown): ReadonlySet<string> {
  const grants = typeof value === "object" && value !== null ? (value as Record<string, unknown>)["grants"] : undefined
  if (typeof grants !== "object" || grants === null) return new Set()
  const record = grants as Record<string, unknown>
  const publicKey = record["publicKey"]
  const cases = record["cases"]
  if (!isEd25519PublicKey(publicKey) || !Array.isArray(cases)) return new Set()
  const verified = new Set<string>()
  for (const entry of cases) {
    if (typeof entry !== "object" || entry === null) continue
    const token = (entry as Record<string, unknown>)["token"]
    if (typeof token === "string" && verifiesGrantToken(token, publicKey)) verified.add(token)
  }
  return verified
}

/** The public key a fixture's grants record, or undefined. */
export function fixturePublicKey(value: unknown): string | undefined {
  const grants = typeof value === "object" && value !== null ? (value as Record<string, unknown>)["grants"] : undefined
  if (typeof grants !== "object" || grants === null) return undefined
  const key = (grants as Record<string, unknown>)["publicKey"]
  return isEd25519PublicKey(key) ? key : undefined
}
