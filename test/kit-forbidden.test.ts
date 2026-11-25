import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, test } from "node:test"
import { forbiddenFindings } from "../src/kit.ts"
import { ALLOW_FILE } from "../src/kit/forbidden.ts"
import { FORBIDDEN_APPS } from "../src/kit/forbidden-apps.ts"

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const temp = (): { dir: string; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), "plugin-kit-forbidden-"))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe("plugin-kit forbidden", () => {
  test("finds an app name, with its line, unless it is an x-<app> key", () => {
    const local = temp()
    try {
      const app = FORBIDDEN_APPS[0]!.name
      write(join(local.dir, "docs", "bad.md"), `# Guide\n\n${app} reads this.\n`)
      write(join(local.dir, "docs", "good.md"), `# Guide\n\n\`x-${app.toLowerCase()}\` is a hint.\n`)
      const findings = forbiddenFindings(local.dir)
      assert.equal(findings.filter((finding) => finding.id === "FORBIDDEN.app-name").length, 1)
      const [found] = findings
      assert.equal(found?.path, "docs/bad.md")
      assert.match(found?.message ?? "", /line 3 names the /)
    } finally {
      local.cleanup()
    }
  })

  test("finds every main-branch link form under the package's owner, and leaves a third-party link alone", () => {
    const local = temp()
    try {
      write(join(local.dir, "package.json"), JSON.stringify({ repository: "https://github.com/acme/acme-plugin" }))
      write(
        join(local.dir, "README.md"),
        [
          "https://github.com/acme/acme-plugin/blob/main/docs/guide.md",
          "https://raw.githubusercontent.com/acme/acme-plugin/main/README.md",
          "github.com/acme/acme-plugin/tree/main/src",
          "https://github.com/other/repo/blob/main/x.js",
          "https://github.com/acme/acme-plugin/blob/master/docs/guide.md",
        ].join("\n"),
      )
      const findings = forbiddenFindings(local.dir).filter((finding) => finding.id === "FORBIDDEN.main-branch")
      assert.equal(findings.length, 3)
      assert.ok(findings.every((finding) => finding.path === "README.md"))
    } finally {
      local.cleanup()
    }
  })

  test("reads the owner from a git+https repository object, and compares it case-insensitively", () => {
    const local = temp()
    try {
      write(join(local.dir, "package.json"), JSON.stringify({ repository: { url: "git+https://github.com/AcMe/acme-plugin.git" } }))
      write(join(local.dir, "README.md"), "https://github.com/acme/acme-plugin/blob/main/docs/guide.md\n")
      const findings = forbiddenFindings(local.dir).filter((finding) => finding.id === "FORBIDDEN.main-branch")
      assert.equal(findings.length, 1)
    } finally {
      local.cleanup()
    }
  })

  test("reads the owner from the github:owner/repo shorthand", () => {
    const local = temp()
    try {
      write(join(local.dir, "package.json"), JSON.stringify({ repository: "github:acme/acme-plugin" }))
      write(join(local.dir, "README.md"), "github.com/acme/acme-plugin/tree/main/src\n")
      const findings = forbiddenFindings(local.dir).filter((finding) => finding.id === "FORBIDDEN.main-branch")
      assert.equal(findings.length, 1)
    } finally {
      local.cleanup()
    }
  })

  test("a package with no repository has no owner, so a main link is not a finding", () => {
    const local = temp()
    try {
      write(join(local.dir, "package.json"), JSON.stringify({ name: "acme-plugin" }))
      write(join(local.dir, "README.md"), "https://github.com/acme/acme-plugin/blob/main/docs/guide.md\n")
      assert.deepEqual(forbiddenFindings(local.dir).filter((finding) => finding.id === "FORBIDDEN.main-branch"), [])
    } finally {
      local.cleanup()
    }
  })

  test("this repository's docs/catalog.md third-party main link is not a finding", () => {
    const findings = forbiddenFindings(process.cwd()).filter((finding) => finding.id === "FORBIDDEN.main-branch")
    assert.equal(findings.some((finding) => finding.path === "docs/catalog.md"), false)
  })

  test("ordinary words are not app identifiers, and the real identifiers are", () => {
    const local = temp()
    try {
      write(join(local.dir, "notes.md"), "Memory is a browser concern; artifacts are build output.\nhey-jelly and toqan are products.\n")
      const findings = forbiddenFindings(local.dir).filter((finding) => finding.id === "FORBIDDEN.app-name")
      assert.equal(findings.length, 2)
      assert.ok(findings.every((finding) => finding.path === "notes.md"))
    } finally {
      local.cleanup()
    }
  })

  test("an allowance with a reason suppresses a match and is reported; an empty reason does not", () => {
    const local = temp()
    try {
      write(join(local.dir, "docs", "quoted.md"), `# Quoted\n\n${FORBIDDEN_APPS[0]!.name} is the product this page documents.\n`)
      write(join(local.dir, ALLOW_FILE), "docs/quoted.md:app-name This page is about the product itself.\n")
      const findings = forbiddenFindings(local.dir)
      assert.equal(findings.filter((finding) => finding.id === "FORBIDDEN.app-name").length, 0)
      const suppressed = findings.find((finding) => finding.id === "FORBIDDEN.suppressed")
      assert.equal(suppressed?.level, "warning")
      assert.match(suppressed?.message ?? "", /This page is about the product itself\./)
      write(join(local.dir, ALLOW_FILE), "docs/quoted.md:app-name \n")
      assert.equal(forbiddenFindings(local.dir).filter((finding) => finding.id === "FORBIDDEN.app-name").length, 1)
    } finally {
      local.cleanup()
    }
  })

  test("only a signed test grant is exempt; an unverified token and another grant field are secrets", () => {
    const local = temp()
    try {
      const source = JSON.parse(readFileSync(join(process.cwd(), "test", "fixtures", "fixture-plugin", "fixtures", "conformance.json"), "utf8")) as Record<string, any>
      const file = join(local.dir, "fixtures", "conformance.json")
      write(file, JSON.stringify(source, null, 2))
      assert.equal(forbiddenFindings(local.dir).filter((finding) => finding.id === "FORBIDDEN.secret").length, 0)
      const bad = `gh${"p_"}${"A1b2C3d4E5f6G7h8"}`
      source.grants.cases[1].token = bad
      source.grants.cases[1].request.password = bad
      write(file, JSON.stringify(source, null, 2))
      const findings = forbiddenFindings(local.dir).filter((finding) => finding.id === "FORBIDDEN.secret")
      assert.ok(findings.length >= 2)
    } finally {
      local.cleanup()
    }
  })

  test("a secret inside a signed grant claim is found even though the raw token text is exempt", () => {
    const local = temp()
    try {
      const base64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
      // A generated test key signs the token, so the raw token text is exempt and only the decoded claim is new.
      const { publicKey, privateKey } = generateKeyPairSync("ed25519")
      const header = base64({ alg: "Ed25519", kid: "test" })
      const payload = base64({ to: "person@example.test", api_key: `sk-${"A1b2C3d4E5f6G7h8I9j0"}` })
      const token = `${header}.${payload}.${sign(null, Buffer.from(`${header}.${payload}`), privateKey).toString("base64url")}`
      const pem = publicKey.export({ type: "spki", format: "pem" }).toString()
      write(
        join(local.dir, "fixtures", "conformance.json"),
        JSON.stringify({ grants: { publicKey: pem, cases: [{ name: "leak", token, input: { to: "person@example.test" }, request: {}, expect: { ok: true } }] } }, null, 2),
      )
      const findings = forbiddenFindings(local.dir).filter((finding) => finding.id === "FORBIDDEN.secret" && /signed grant claim/.test(finding.message))
      assert.equal(findings.length, 1)
      assert.equal(findings[0]?.path, "fixtures/conformance.json")
      assert.match(findings[0]?.message ?? "", /signed grant claim in leak holds a credential \(api key\)/)
    } finally {
      local.cleanup()
    }
  })

  test("a verified grant case's email must be on example.test or example.com; a negative case is not scanned", () => {
    const local = temp()
    try {
      const base64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
      const token = (claims: unknown) => `${base64({ alg: "Ed25519" })}.${base64(claims)}.c2lnbmF0dXJl`
      write(
        join(local.dir, "fixtures", "conformance.json"),
        JSON.stringify(
          {
            grants: {
              publicKey: "not-a-key",
              cases: [
                { name: "real", token: token({ to: "person@real.example" }), input: { to: "person@real.example" }, request: { consumer: "person@real.example" }, expect: { ok: true } },
                { name: "allowed", token: token({ to: "person@example.test" }), input: { to: "person@example.com" }, request: {}, expect: { ok: true } },
                { name: "refused", token: token({ to: "person@real.example" }), input: { to: "person@real.example" }, request: {}, expect: { ok: false, code: "GRANT_EXPIRED" } },
              ],
            },
          },
          null,
          2,
        ),
      )
      const findings = forbiddenFindings(local.dir).filter((finding) => finding.id === "FORBIDDEN.grant-email")
      assert.equal(findings.length, 1, "only the verified case with a real address is reported")
      assert.equal(findings[0]?.path, "fixtures/conformance.json")
      assert.match(findings[0]?.message ?? "", /verified grant case real carries an address outside/)
      assert.equal((findings[0]?.message ?? "").includes("person@real.example"), false, "the address itself is personal data")
      assert.equal((findings[0]?.message ?? "").includes("real.example"), false, "even the domain is not printed")
    } finally {
      local.cleanup()
    }
  })

  test("a doc's type annotation and member-access comment are not secrets, but a quoted credential is", () => {
    const local = temp()
    try {
      write(
        join(local.dir, "docs", "guide.md"),
        [
          "# Guide",
          "",
          "* The action grant's token: `header.payload.signature` in base64url",
          'token: "lin_api_abcdefghijklmnopqrstuvwxyz0123456789"',
          "",
        ].join("\n"),
      )
      const findings = forbiddenFindings(local.dir).filter((finding) => finding.id === "FORBIDDEN.secret")
      assert.equal(findings.length, 1)
      assert.equal(findings[0]?.path, "docs/guide.md")
      assert.match(findings[0]?.message ?? "", /line 4 holds what looks like a token/)
    } finally {
      local.cleanup()
    }
  })

  test("finds a credential in a line, and does not scan a lockfile or a binary", () => {
    const local = temp()
    try {
      const token = `gh${"p_"}${"A1b2C3d4E5f6G7h8I9j0"}`
      write(join(local.dir, "docs", "leak.md"), `Set GH_TOKEN=${token}\n`)
      write(join(local.dir, "package-lock.json"), JSON.stringify({ token }))
      writeFileSync(join(local.dir, "logo.png"), `\x89PNG\r\n\x1a\n${token}`)
      const findings = forbiddenFindings(local.dir)
      assert.deepEqual(findings.filter((finding) => finding.id === "FORBIDDEN.secret").map((finding) => finding.path), ["docs/leak.md"])
    } finally {
      local.cleanup()
    }
  })

  test("a search reads no node_modules, dist or .git", () => {
    const local = temp()
    try {
      const app = FORBIDDEN_APPS[0]!.name
      for (const directory of ["node_modules/pkg", "dist", ".git"]) write(join(local.dir, directory, "file.md"), `${app}\n`)
      assert.deepEqual(forbiddenFindings(local.dir), [])
    } finally {
      local.cleanup()
    }
  })

  test("a caller can pass its own app list, so the scanner is testable without naming a product", () => {
    const local = temp()
    try {
      write(join(local.dir, "notes.md"), "This mentions acmeapp.\n")
      const findings = forbiddenFindings(local.dir, { apps: [{ name: "Acmeapp", pattern: /\bacmeapp\b/gi }] })
      assert.deepEqual(findings.map((finding) => finding.id), ["FORBIDDEN.app-name"])
    } finally {
      local.cleanup()
    }
  })

  test("an ordinary use of the word main is not a branch link", () => {
    const local = temp()
    try {
      write(join(local.dir, "notes.md"), "The main reason is the main thread; see README.md for the rest.\n")
      assert.deepEqual(forbiddenFindings(local.dir), [])
    } finally {
      local.cleanup()
    }
  })
})
