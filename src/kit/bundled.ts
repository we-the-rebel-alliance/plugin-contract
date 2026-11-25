/**
 * `KIT_BUNDLED`: a plugin's runtime build must not contain the development kit.
 *
 * `plugin-kit` is a devDependency. Its commands and host harness import conformance, Node's child-process API and the
 * plugin's own package; none of that belongs in `dist/index.js` or a split runtime chunk. The check reads the server
 * entry the package.json names, and every JavaScript file beside it in `dist/`, for the kit's import specifier or its
 * bundle marker. It never reads `node_modules`.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { isTextFile, relativePath, walkFiles } from "./files.ts"
import type { Finding } from "./types.ts"

/** A marker the kit's host harness carries, so a bundle that inlines it can be named. */
export const KIT_BUNDLE_MARKER = "plugin-kit:dev-only"

/** The import specifiers a runtime bundle must not carry. */
const KIT_IMPORTS = ["@we-the-rebel-alliance/plugin-contract/kit", "plugin-contract/kit"]

/** The files a package's runtime build is likely to use, from its exports and conventional entries. */
function runtimeFiles(directory: string): string[] {
  const found = new Set<string>()
  let pkg: Record<string, unknown> = {}
  try {
    pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as Record<string, unknown>
  } catch {
    // The conformance gate names a broken package.json; this check simply has nothing to add.
  }
  const consider = (value: unknown): void => {
    if (typeof value === "string") {
      const path = join(directory, value)
      if (existsSync(path) && statSync(path).isFile()) found.add(path)
      return
    }
    if (value === null || typeof value !== "object") return
    const record = value as Record<string, unknown>
    for (const key of ["default", "node", "module", "require", "types", "browser"]) consider(record[key])
  }
  const exportsValue = pkg["exports"]
  if (typeof exportsValue === "object" && exportsValue !== null) {
    const map = exportsValue as Record<string, unknown>
    consider(map["./server"])
    consider(map["."])
    consider(map["./tui"])
  } else consider(exportsValue)
  for (const key of ["module", "main"]) consider(pkg[key])
  const dist = join(directory, "dist")
  if (existsSync(dist) && statSync(dist).isDirectory()) {
    for (const path of walkFiles(dist, { skip: [] })) if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) found.add(path)
  }
  for (const name of ["index.js", "index.mjs", "index.cjs"]) {
    const path = join(directory, name)
    if (existsSync(path) && statSync(path).isFile()) found.add(path)
  }
  return [...found]
}

/** Every runtime file that carries the kit, as one `KIT_BUNDLED` error per file. */
export function bundledFindings(directory: string): Finding[] {
  const findings: Finding[] = []
  for (const path of runtimeFiles(directory)) {
    if (!isTextFile(path)) continue
    const text = readFileSync(path, "utf8")
    const specifier = KIT_IMPORTS.find((entry) => text.includes(entry))
    if (specifier === undefined && !text.includes(KIT_BUNDLE_MARKER)) continue
    findings.push({
      id: "KIT_BUNDLED",
      level: "error",
      path: relativePath(directory, path),
      message: `the runtime build includes plugin-kit (${specifier ?? KIT_BUNDLE_MARKER}); the kit is a devDependency and is never bundled into a plugin`,
      fix: "Remove the kit from the server entry and runtime imports; use it only from scripts, tests and CI.",
    })
  }
  return findings
}

/** The runtime files the check reads, for a test and for docs. */
export function runtimeFileList(directory: string): string[] {
  return runtimeFiles(directory).map((path) => relativePath(directory, path))
}
