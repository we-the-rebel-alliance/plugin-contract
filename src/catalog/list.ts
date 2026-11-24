/**
 * The installed plugins, from the host's own plugin list and from disk (contract §4, §14).
 *
 * Remote apps cannot read the disk, and nothing said over RPC is trusted as a manifest. The catalog is the one trusted
 * door: it asks the host which plugins are installed (`ctx.plugin.list()`), finds each package's directory, and reads
 * and hashes the manifest with `readInstalledManifest`. A package that is missing or whose manifest does not validate
 * is reported beside the ones that did, never dropped.
 *
 *   const listing = await listInstalledPlugins(ctx)
 *   listing.plugins[0].manifest.sources   // the package's sources
 *   listing.plugins[0].hash               // the manifest hash a grant stores
 *   listing.problems                      // packages that could not be read
 *
 * A local plugin names its directory. A package target is a package name; the directories whose `node_modules` hold
 * the host's installed packages are passed as `roots` (the host's location is the default), or the host resolves each
 * target itself with `resolve`.
 */
import { isAbsolute } from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode/plugin"
import { findInstalledPackage, readInstalledManifest, type InstalledManifest } from "../manifest.ts"

/**
 * One plugin as the host lists it: the part of `ctx.plugin.list()` the catalog reads. A package names its target; a
 * local plugin names its directory; a builtin or SDK plugin has no package manifest.
 */
export interface HostPlugin {
  readonly id?: string
  readonly source:
    | { readonly type: "package"; readonly target: string; readonly version?: string }
    | { readonly type: "local"; readonly path: string }
    | { readonly type: "builtin" }
    | { readonly type: "sdk" }
}

/**
 * The part of OpenCode's plugin context the catalog uses, written structurally so the package needs no
 * `@opencode/plugin`. A plugin passes its own `ctx`.
 */
export interface CatalogHost {
  readonly plugin: {
    list(input?: { readonly location?: { readonly directory?: string } }): Promise<{ readonly data: readonly HostPlugin[] }>
  }
  readonly location?: { readonly directory: string }
}

/** Where to look for package targets. The host's own directory is the default root. */
export interface CatalogOptions {
  /** Directories whose `node_modules` hold installed packages, searched in order. Default: the host's directory. */
  readonly roots?: readonly string[]
  /** The directory a target resolved to, when the host knows it: a package cache, a checkout, a linked package. */
  readonly resolve?: (target: string) => string | undefined
}

/** One installed plugin whose manifest validated, and the host target it came from. */
export interface CatalogPlugin extends InstalledManifest {
  /** The host's package target, or a local plugin's path. */
  readonly target: string
}

/** One plugin whose package or manifest could not be read. */
export interface CatalogProblem {
  /** The host's package target, or a local plugin's path. */
  readonly target: string
  readonly problems: readonly string[]
}

/** What the catalog found: the manifests, and every plugin that did not yield one. */
export interface CatalogListing {
  readonly plugins: readonly CatalogPlugin[]
  readonly problems: readonly CatalogProblem[]
}

/**
 * OpenCode's plugin context is assignable to this module's: checked at compile time, so a plugin passes `ctx` as it is.
 * The `@opencode/plugin` types stay out of the published declarations (`npm run check:dist`).
 */
const hostContextIsCatalogHost = (context: Pick<Plugin.Context, "plugin" | "location">): CatalogHost => context
void hostContextIsCatalogHost

/** A package name, or a scoped package name: what `findInstalledPackage` can look up. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** The package name a target names, also when a version is still attached: `@scope/name@1.2.3`. */
function packageName(target: string): string | undefined {
  if (PACKAGE_NAME.test(target)) return target
  const at = target.lastIndexOf("@")
  if (at <= 0) return undefined
  const name = target.slice(0, at)
  return PACKAGE_NAME.test(name) ? name : undefined
}

/** The directory a package target names, or undefined when the catalog cannot find it. */
function directoryOf(target: string, roots: readonly string[], resolve: ((target: string) => string | undefined) | undefined): string | undefined {
  const resolved = resolve?.(target)
  if (resolved !== undefined) return resolved
  if (target.startsWith("file:")) {
    try {
      return fileURLToPath(target)
    } catch {
      return undefined
    }
  }
  if (isAbsolute(target)) return target
  const name = packageName(target)
  if (name === undefined) return undefined
  for (const root of roots) {
    const found = findInstalledPackage(name, root)
    if (found !== undefined) return found
  }
  return undefined
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The manifests of the host's installed plugins. Each package on disk is read with `readInstalledManifest`, so there
 * is one parser, one validator and one hash. A missing package, a version the install does not match, or an invalid
 * manifest is reported and the rest of the list is still read. The function never throws for a plugin's own package.
 */
export async function listInstalledPlugins(host: CatalogHost, options: CatalogOptions = {}): Promise<CatalogListing> {
  let listed: readonly HostPlugin[]
  try {
    listed = (await host.plugin.list()).data
  } catch (error) {
    return { plugins: [], problems: [{ target: "", problems: [`the plugin list could not be read: ${message(error)}`] }] }
  }
  const roots = options.roots ?? (host.location === undefined ? [] : [host.location.directory])
  const plugins: CatalogPlugin[] = []
  const problems: CatalogProblem[] = []
  const seen = new Set<string>()
  for (const plugin of listed) {
    const source = plugin.source
    if (source.type === "builtin" || source.type === "sdk") continue
    const target = source.type === "local" ? source.path : source.target
    const directory = source.type === "local" ? source.path : directoryOf(source.target, roots, options.resolve)
    if (directory === undefined) {
      problems.push({ target, problems: [`no installed package for ${target}: pass its directory with catalog roots or a resolve function`] })
      continue
    }
    // A plugin can be listed twice, as a package and as a local link; its directory is the same manifest.
    if (seen.has(directory)) continue
    seen.add(directory)
    // A registry target names the package's own version, so the install must match it. A Git target names a commit
    // revision instead, which is not the package's version and cannot be checked here.
    const registry = source.type === "package" && packageName(source.target) !== undefined
    const installed = readInstalledManifest(directory, registry && source.version !== undefined ? { version: source.version } : {})
    if (installed.ok) plugins.push({ target, ...installed.value })
    else problems.push({ target, problems: installed.problems })
  }
  return { plugins, problems }
}
