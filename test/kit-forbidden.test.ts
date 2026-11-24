import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

  test("finds every main-branch link form, and leaves a master link alone", () => {
    const local = temp()
    try {
      write(
        join(local.dir, "README.md"),
        [
          "https://github.com/acme/acme-plugin/blob/main/docs/guide.md",
          "https://raw.githubusercontent.com/acme/acme-plugin/main/README.md",
          "github.com/acme/acme-plugin/tree/main/src",
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
