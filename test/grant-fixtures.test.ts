// The six static action-grant vectors: signed once with a throwaway key, never regenerated. No private key is here.
import { readFileSync, readdirSync } from "node:fs"
import { describe, test } from "node:test"
import { expect } from "./support/expect.ts"
import { verifyGrant, type GrantClaims, type GrantRequest, type GrantStore } from "../src/grant.ts"

const DIR = new URL("./fixtures/grant/", import.meta.url)
const KID = "host_2026_11"
const REQUIRED = ["valid", "expired", "replayed", "digest-mismatch", "wrong-aud", "bad-signature"] as const

interface VectorRequest {
  readonly act: string
  readonly actions: Readonly<Record<string, "required" | "optional">>
  readonly audience: string
  readonly consumer: string
  readonly capability: string
  readonly account: string
  readonly scope: Readonly<Record<string, string | readonly string[]>>
  readonly manifest: string
  readonly now: number
}

type VectorExpectation = { readonly ok: true; readonly kid: string; readonly claims: GrantClaims } | { readonly ok: false; readonly code: string }

interface Vector {
  readonly name: string
  readonly token: string
  readonly input: unknown
  readonly request: VectorRequest
  readonly store: { readonly used: readonly string[] }
  readonly expect: VectorExpectation
}

const files = () => readdirSync(DIR).filter((name) => name.endsWith(".json")).sort()
const load = (name: string) => JSON.parse(readFileSync(new URL(name, DIR), "utf8")) as Vector

describe("action-grant fixtures", () => {
  const publicKey = readFileSync(new URL("public-key.pem", DIR), "utf8")

  test("has the six canonical vectors", () => {
    const names = files()
    for (const name of REQUIRED) expect(names).toContain(`${name}.json`)
  })

  for (const file of files()) {
    const vector = load(file)
    test(`${vector.name}: ${vector.expect.ok ? "verifies" : vector.expect.code}`, async () => {
      const used = new Set(vector.store.used)
      const calls: GrantClaims[] = []
      const store: GrantStore = {
        async consume(claims) {
          calls.push(claims)
          if (used.has(claims.jti)) return false
          used.add(claims.jti)
          return true
        },
      }
      const request: GrantRequest = {
        grant: vector.token,
        input: vector.input,
        ...vector.request,
        keys: { keys: { [KID]: publicKey } },
        store,
      }
      const outcome = await verifyGrant(request)
      if (vector.expect.ok) {
        if (!outcome.ok) throw new Error(`expected a valid grant, got ${outcome.code}: ${outcome.reason}`)
        expect(outcome.kid).toBe(vector.expect.kid)
        expect(outcome.claims).toEqual(vector.expect.claims)
        expect(calls).toHaveLength(1)
        return
      }
      if (outcome.ok) throw new Error(`expected ${vector.expect.code}, the grant verified`)
      expect(outcome.code).toBe(vector.expect.code)
      expect(outcome.contractCode).toBe("GRANT_INVALID")
      expect(calls.length).toBe(vector.store.used.length > 0 ? 1 : 0)
    })
  }
})
