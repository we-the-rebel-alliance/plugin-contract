/**
 * File access for the kit: one walk, one text test, and writes that only touch a file when its content changes.
 *
 * Paths in a finding are relative to the plugin directory and use `/`, on every platform, because they appear in a CI
 * log and in a review comment.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"

/** Directories the kit never scans: generated, installed or a tool's own state. */
export const SKIP_DIRECTORIES: readonly string[] = [".git", ".hg", ".svn", "node_modules", "dist", "coverage", "release", "vendor", ".opencode", ".cache"]

/** Files that are data, not text: a scan reads none of them. */
const BINARY = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".avif",
  ".pdf",
  ".zip",
  ".gz",
  ".tgz",
  ".tar",
  ".wasm",
  ".node",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
  ".ogg",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".jar",
  ".class",
  ".pyc",
])

/** Files whose content is text, but whose name carries no extension. */
const TEXT_NAMES = new Set(["AGENTS.md", "LICENSE", "LICENCE", "CODEOWNERS", "Dockerfile", "Makefile", "Procfile", "VERSION"])

/** Extensions the kit reads as text. */
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".json",
  ".jsonc",
  ".md",
  ".mdx",
  ".txt",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".svg",
  ".xml",
  ".env",
  ".example",
  ".lock",
])

/** Whether the kit reads this file as text. */
export function isTextFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf(sep) + 1)
  if (TEXT_NAMES.has(name)) return true
  if (name.startsWith(".env")) return true
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return false
  const extension = name.slice(dot).toLowerCase()
  return TEXT_EXTENSIONS.has(extension) && !BINARY.has(extension)
}

/** Every file under `root`, absolute and sorted, without the directories the kit never scans. */
export function walkFiles(root: string, options: { readonly skip?: readonly string[] | undefined; readonly maxBytes?: number | undefined } = {}): string[] {
  const skip = new Set(options.skip ?? SKIP_DIRECTORIES)
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024
  const found: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile()) continue
      try {
        if (statSync(path).size > maxBytes) continue
      } catch {
        continue
      }
      found.push(path)
    }
  }
  visit(root)
  return found.sort()
}

/** A path as a finding shows it: relative to the plugin directory, with forward slashes. */
export function relativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/")
}

/** A text file's content, or undefined when it is not text or cannot be read. */
export function readText(path: string, maxBytes = 8 * 1024 * 1024): string | undefined {
  try {
    if (statSync(path).size > maxBytes) return undefined
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

/** Write a text file only when its content differs. True when the file changed. */
export function writeTextIfChanged(path: string, text: string): boolean {
  try {
    if (readFileSync(path, "utf8") === text) return false
  } catch {
    // A file that does not exist is written.
  }
  writeFileSync(path, text)
  return true
}

/** A JSON file parsed, or undefined when it is missing or malformed. */
export function readJson(path: string): unknown {
  const text = readText(path)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Write JSON with two spaces and a final newline; true when the file changed. */
export function writeJsonIfChanged(path: string, value: unknown): boolean {
  return writeTextIfChanged(path, `${JSON.stringify(value, null, 2)}\n`)
}
