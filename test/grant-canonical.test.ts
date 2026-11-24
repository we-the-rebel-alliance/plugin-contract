// Canonical-JSON digest vectors: the exact bytes an action grant's input digest binds.
import { readFileSync, readdirSync } from "node:fs"
import { describe, test } from "node:test"
import { expect } from "./support/expect.ts"
import { digestInput } from "../src/grant.ts"

const DIR = new URL("./fixtures/grant/canonical/", import.meta.url)
const REQUIRED = ["key-order-a.json", "key-order-b.json", "nested.json", "unicode.json", "numbers.json", "arrays.json", "arrays-reordered.json"]

interface Vector {
  readonly name: string
  readonly input: unknown
  readonly digest: string
}

const files = () => readdirSync(DIR).filter((name) => name.endsWith(".json")).sort()
const load = (file: string) => JSON.parse(readFileSync(new URL(file, DIR), "utf8")) as Vector

describe("canonical JSON vectors", () => {
  test("has every required vector", () => {
    const names = files()
    for (const name of REQUIRED) expect(names).toContain(name)
  })

  for (const file of files()) {
    const vector = load(file)
    test(`${vector.name}: digestInput matches`, () => {
      expect(vector.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(digestInput(vector.input)).toBe(vector.digest)
    })
  }

  test("object key order does not change the digest", () => {
    const first = load("key-order-a.json")
    const second = load("key-order-b.json")
    expect(first.digest).toBe(second.digest)
    expect(Object.keys(first.input as Record<string, unknown>)).not.toEqual(Object.keys(second.input as Record<string, unknown>))
  })

  test("array order changes the digest", () => {
    const ordered = load("arrays.json")
    const reordered = load("arrays-reordered.json")
    expect(ordered.digest).not.toBe(reordered.digest)
  })
})
