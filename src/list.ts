/**
 * Lists the declarations of installed packages, from disk, never over RPC.
 *
 * A consumer passes a directory of packages (each child, and each package under an `@scope` child) or a list of
 * package directories. A directory that itself holds a `package.json` is one package. Each package is read with
 * `readInstalledDescriptor`, so there is one parser. A missing or invalid descriptor is reported; it is not dropped.
 *
 *   const listed = listInstalledDeclarations("/path/to/node_modules")
 *   listed.declarations[0].sources   // the package's sources
 *   listed.declarations[0].acts       // its acts, empty when it declares none
 *   listed.problems                   // packages that could not be read
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { readInstalledDescriptor, type InstalledDescriptor } from "./descriptor.ts"
import type { ActItem } from "./internal/schema/types.ts"

/** One installed package whose descriptor validated. */
export interface ListedDeclaration {
  readonly directory: string
  readonly package: string
  readonly version: string
  readonly sources: InstalledDescriptor["sources"]
  /** The package's acts. Empty when the descriptor declares none. */
  readonly acts: readonly ActItem[]
  /** The descriptor hash, covering sources and acts. A grant stores it. */
  readonly hash: string
}

/** A package that has no descriptor, or one this package refuses. */
export interface ListedProblem {
  readonly directory: string
  readonly problems: readonly string[]
}

/** What a listing found: the declarations, and every package that did not yield one. */
export interface ListedDeclarations {
  readonly declarations: readonly ListedDeclaration[]
  readonly problems: readonly ListedProblem[]
}

const listed = (installed: InstalledDescriptor): ListedDeclaration => ({
  directory: installed.directory,
  package: installed.package,
  version: installed.version,
  sources: installed.sources,
  acts: installed.sources.acts ?? [],
  hash: installed.hash,
})

/** Package directories under `root`: each child, and each package under an `@scope` child. Dot names are skipped. */
function childPackages(root: string): string[] {
  let entries: { name: string; isDirectory(): boolean }[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw Object.assign(new Error(code === "ENOTDIR" ? "not a directory" : "could not be read"), { code })
  }
  const found: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith(".") || !entry.isDirectory()) continue
    const path = join(root, entry.name)
    if (!entry.name.startsWith("@")) {
      found.push(path)
      continue
    }
    let scoped: { name: string; isDirectory(): boolean }[]
    try {
      scoped = readdirSync(path, { withFileTypes: true })
    } catch {
      found.push(path)
      continue
    }
    for (const child of scoped) {
      if (child.name.startsWith(".") || !child.isDirectory()) continue
      found.push(join(path, child.name))
    }
  }
  return found.sort()
}

/** The package directories `input` names, or the problems of reading that input. */
function targets(input: string | readonly string[]): { readonly directories: readonly string[]; readonly problems: readonly ListedProblem[] } {
  if (typeof input !== "string") {
    return { directories: [...input].sort(), problems: [] }
  }
  if (input.length === 0) return { directories: [], problems: [{ directory: input, problems: ["no directory to list"] }] }
  if (!existsSync(input)) return { directories: [], problems: [{ directory: input, problems: [`no directory at ${input}`] }] }
  // A package directory is one package. A directory of packages is walked. A listed path is never walked into, so a
  // package's own node_modules is not a second catalogue.
  if (existsSync(join(input, "package.json"))) return { directories: [input], problems: [] }
  try {
    const children = childPackages(input)
    if (children.length === 0) return { directories: [], problems: [{ directory: input, problems: [`no packages at ${input}`] }] }
    return { directories: children, problems: [] }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "could not be read"
    return { directories: [], problems: [{ directory: input, problems: [`${input} ${reason}`] }] }
  }
}

/**
 * The declarations of the installed packages at `input`: a directory of packages, or a list of package directories.
 * Uses `readInstalledDescriptor` for each, and reports a missing or invalid descriptor instead of dropping it.
 */
export function listInstalledDeclarations(input: string | readonly string[]): ListedDeclarations {
  const { directories, problems } = targets(input)
  const declarations: ListedDeclaration[] = []
  const found: ListedProblem[] = [...problems]
  for (const directory of directories) {
    const installed = readInstalledDescriptor(directory)
    if (installed.ok) declarations.push(listed(installed.value))
    else found.push({ directory, problems: installed.problems })
  }
  return { declarations, problems: found }
}
