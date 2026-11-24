/**
 * The installed plugins, from the host's own plugin list and from OpenCode 2.4.1's npm cache (contract §4, §14).
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
 * OpenCode 2.4.1 installs packages under `<XDG_CACHE_HOME or ~/.cache>/opencode/npm/`. Each target gets one directory
 * named by `key()`; each install is a numeric generation, and the package sits at
 * `<generation>/node_modules/<name>`. This module mirrors that layout from `@opencode/util@2.4.1`
 * (`dist/npm.js`: `key` :75, `gitSlug` :82, `directory` :112, `generations` :113, `current` :118, `installedName` :125;
 * `dist/global-roots.js`: `cache` :5, `roots` :9): the same key for registry and Git targets, the newest generation
 * whose sibling `<generation>.rejected` is absent, and the name from the generation's dependencies for a Git target.
 *
 * A local plugin names its directory. A host that installs elsewhere, such as a linked checkout, passes `resolve`.
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode/plugin"
import { readInstalledManifest, type InstalledManifest } from "../manifest.ts"

/**
 * One plugin as the host lists it: the part of `ctx.plugin.list()` the catalog reads. A package names its target; a
 * local plugin names its directory; a builtin or SDK plugin has no package manifest. A failed plugin is still listed,
 * because its failure belongs in the catalog's report.
 */
export interface HostPlugin {
  readonly id?: string
  readonly state: HostPluginState
  readonly source:
    | { readonly type: "package"; readonly target: string; readonly version?: string }
    | { readonly type: "local"; readonly path: string }
    | { readonly type: "builtin" }
    | { readonly type: "sdk" }
}

/** The host's plugin state: loaded, or failed with the message and reference its status show. */
export type HostPluginState =
  | { readonly status: "active" }
  | { readonly status: "failed"; readonly error: string; readonly ref?: string }

/**
 * The part of OpenCode's plugin context the catalog uses, written structurally so the package needs no
 * `@opencode/plugin`. A plugin passes its own `ctx`.
 */
export interface CatalogHost {
  readonly plugin: {
    list(input?: { readonly location?: { readonly directory?: string } }): Promise<{ readonly data: readonly HostPlugin[] }>
  }
}

/** Where the OpenCode cache is, and a host's own resolution of a target it installed elsewhere. */
export interface CatalogOptions {
  /** The OpenCode cache directory, the one holding `npm/`. Default: `<XDG_CACHE_HOME or ~/.cache>/opencode`. */
  readonly cacheDirectory?: string
  /** The directory a target resolved to, when the host knows better than the cache: a checkout, a linked package. */
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
const hostContextIsCatalogHost = (context: Pick<Plugin.Context, "plugin">): CatalogHost => context
void hostContextIsCatalogHost

/** A package name, or a scoped package name: what a registry target names. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
/** Git shorthands npm accepts: `owner/repo`, and the hosted and URL forms. */
const GIT_SHORTHAND = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const GIT_PROTOCOL = /^(?:git\+[a-z0-9.+-]+:|git:\/\/|git@|ssh:\/\/|https?:\/\/)/i
const GIT_HOSTED = /^(?:github|gitlab|bitbucket|gist):/i

/** One install as OpenCode's `parse()` reads it: a registry name and spec, or a Git slug. */
type InstallTarget =
  | { readonly kind: "registry"; readonly name: string; readonly spec?: string }
  | { readonly kind: "git"; readonly slug: string }

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The cache base, exactly as `global-roots` reads it: `XDG_CACHE_HOME`, or `~/.cache`. */
function defaultCacheDirectory(): string {
  const cache = process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache")
  return join(cache, "opencode")
}

/** Windows-illegal characters become `_`; elsewhere the key is the target itself (`npm.js` `sanitize`, :30). */
const ILLEGAL = process.platform === "win32" ? new Set(["<", ">", ":", '"', "|", "?", "*"]) : undefined

function sanitize(value: string): string {
  if (ILLEGAL === undefined) return value
  return Array.from(value, (character) => (ILLEGAL.has(character) || character.charCodeAt(0) < 32 ? "_" : character)).join("")
}

/** The slug in a Git cache key: the last path segment, cleaned (`npm.js` `gitSlug`, :82). */
function gitSlug(target: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(target.split("#")[0]!)
    } catch {
      return target.split("#")[0]!
    }
  })()
  return (
    decoded
      .replace(/\.git$/i, "")
      .split(/[/:\\]/)
      .at(-1)
      ?.replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "repository"
  )
}

/** A registry target's name and the spec the host left on it: `@scope/name@1.2.3`, or a bare `name`. */
function registryTarget(target: string): { readonly name: string; readonly spec?: string } | undefined {
  const slash = target.startsWith("@") ? target.indexOf("/") : -1
  if (target.startsWith("@") && slash <= 0) return undefined
  const at = target.indexOf("@", slash + 1)
  const name = at <= 0 ? target : target.slice(0, at)
  if (!PACKAGE_NAME.test(name)) return undefined
  if (at <= 0) return { name }
  const spec = target.slice(at + 1)
  return spec === "" ? undefined : { name, spec }
}

/** A Git target, in the forms npm's `parse()` accepts (`npm.js` `parse`, :44). */
function gitTarget(target: string): { readonly slug: string } | undefined {
  const hosted = GIT_HOSTED.test(target)
  const protocol = GIT_PROTOCOL.test(target)
  const url = protocol && (/\.git(?:#.*)?$/i.test(target) || target.includes("#") || /^(?:git\+|git@|git:\/\/|ssh:\/\/)/i.test(target))
  const shorthand = GIT_SHORTHAND.test(target)
  if (!hosted && !url && !shorthand) return undefined
  return { slug: gitSlug(target) }
}

function parseTarget(target: string): InstallTarget | undefined {
  const registry = registryTarget(target)
  if (registry !== undefined) return { kind: "registry", ...registry }
  const git = gitTarget(target)
  return git === undefined ? undefined : { kind: "git", ...git }
}

/** The cache directory's name for a target (`npm.js` `key`, :75). A registry target with no spec is `@latest`. */
function cacheKey(target: string, parsed: InstallTarget | undefined): string {
  if (parsed?.kind === "git") return `git-${parsed.slug}-${createHash("sha256").update(target).digest("hex").slice(0, 12)}`
  if (parsed?.kind === "registry") return sanitize(`${parsed.name}@${parsed.spec ?? "latest"}`)
  return sanitize(target)
}

/** The install generations that are finished and not rejected, oldest first (`npm.js` `generations`, :113). */
function generations(directory: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch {
    return []
  }
  return entries
    .filter((entry) => /^\d+$/.test(entry) && !entries.includes(`${entry}.rejected`))
    .sort((left, right) => Number(left) - Number(right))
}

/** The newest generation, which is the installed one (`npm.js` `current`, :118). */
function currentGeneration(directory: string): string | undefined {
  const newest = generations(directory).at(-1)
  return newest === undefined ? undefined : join(directory, newest)
}

/**
 * The installed package's name inside a generation: the generation root's first dependency, else the target's own name
 * (`npm.js` `installedName`, :125).
 */
function installedName(parsed: InstallTarget, generation: string): string {
  if (parsed.kind === "registry") return parsed.name
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(generation, "package.json"), "utf8"))
    if (plain(manifest)) {
      const dependencies = manifest["dependencies"]
      if (plain(dependencies)) {
        const name = Object.keys(dependencies)[0]
        if (name !== undefined) return name
      }
    }
  } catch {
    // A generation without a readable root package.json still has its package directory; the target's own name is
    // the best fallback, and the manifest read reports the rest.
  }
  return parsed.slug
}

/** The installed package directory for one cache key, when its newest generation holds it. */
function packageAt(cacheDirectory: string, key: string, parsed: InstallTarget): string | undefined {
  const generation = currentGeneration(join(cacheDirectory, "npm", key))
  if (generation === undefined) return undefined
  const directory = join(generation, "node_modules", installedName(parsed, generation))
  return existsSync(directory) ? directory : undefined
}

/** The version in a package directory's package.json, for choosing the entry a host's version names. */
function packageVersion(directory: string): string | undefined {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))
    return plain(manifest) && typeof manifest["version"] === "string" ? manifest["version"] : undefined
  } catch {
    return undefined
  }
}

/** Every cache key that names a registry target, scoped names included. */
function registryKeys(cacheDirectory: string, name: string): string[] {
  const base = join(cacheDirectory, "npm")
  const prefix = sanitize(`${name}@`)
  const slash = name.startsWith("@") ? name.indexOf("/") : -1
  let entries: string[]
  try {
    entries = slash > 0 ? readdirSync(join(base, name.slice(0, slash))).map((entry) => `${name.slice(0, slash)}/${entry}`) : readdirSync(base)
  } catch {
    return []
  }
  return entries.filter((entry) => entry.startsWith(prefix)).sort().reverse()
}

/**
 * A registry target's installed package. The host reports the package name and version, not the spec in the original
 * config, so try the spec the target still carries, then the version, then `@latest`, then every entry for that name
 * (a range or tag names its own entry) and prefer the version the host names.
 */
function registryInstall(cacheDirectory: string, parsed: { readonly name: string; readonly spec?: string }, version: string | undefined): string | undefined {
  const keys = new Set<string>()
  if (parsed.spec !== undefined) keys.add(sanitize(`${parsed.name}@${parsed.spec}`))
  if (version !== undefined) keys.add(sanitize(`${parsed.name}@${version}`))
  keys.add(sanitize(`${parsed.name}@latest`))
  const found: string[] = []
  const matches = (directory: string) => version === undefined || packageVersion(directory) === version
  for (const key of keys) {
    const directory = packageAt(cacheDirectory, key, { kind: "registry", name: parsed.name })
    if (directory === undefined) continue
    if (matches(directory)) return directory
    found.push(directory)
  }
  // A range or tag names its own cache entry, which the host does not report. Find every entry for the same package
  // and take the one whose installed version is the host's; otherwise keep the first, so the manifest read reports the
  // version it found.
  for (const key of registryKeys(cacheDirectory, parsed.name)) {
    const directory = packageAt(cacheDirectory, key, { kind: "registry", name: parsed.name })
    if (directory === undefined) continue
    if (matches(directory)) return directory
    found.push(directory)
  }
  return found[0]
}

/** A Git target's installed package, from its generation root's dependencies. */
function gitInstall(cacheDirectory: string, target: string, parsed: { readonly slug: string }): string | undefined {
  const generation = currentGeneration(join(cacheDirectory, "npm", cacheKey(target, { kind: "git", slug: parsed.slug })))
  if (generation === undefined) return undefined
  const directory = join(generation, "node_modules", installedName({ kind: "git", slug: parsed.slug }, generation))
  return existsSync(directory) ? directory : undefined
}

/** A package target's installed directory, and whether it is a registry target (the only kind with a version check). */
function locate(cacheDirectory: string, target: string, version: string | undefined): { readonly directory: string; readonly registry: boolean } | undefined {
  const parsed = parseTarget(target)
  if (parsed === undefined) return undefined
  if (parsed.kind === "registry") {
    const directory = registryInstall(cacheDirectory, parsed, version)
    return directory === undefined ? undefined : { directory, registry: true }
  }
  const directory = gitInstall(cacheDirectory, target, parsed)
  return directory === undefined ? undefined : { directory, registry: false }
}

/** A file URL or an absolute path, which a host may still put in `source.target`; a local source uses `path`. */
function directDirectory(target: string): string | undefined {
  if (target.startsWith("file:")) {
    try {
      return fileURLToPath(target)
    } catch {
      return undefined
    }
  }
  return isAbsolute(target) ? target : undefined
}

/** A local source that is a file, not a directory: OpenCode 2.4.1 loads those too, and they carry no manifest. */
function singleFileProblem(path: string): string | undefined {
  try {
    return statSync(path).isDirectory() ? undefined : `a single-file local plugin has no package.json manifest: ${path}`
  } catch {
    return undefined
  }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The manifests of the host's installed plugins. Each package on disk is read with `readInstalledManifest`, so there
 * is one parser, one validator and one hash. A failed plugin, a missing package, a registry version the install does
 * not match, or an invalid manifest is reported and the rest of the list is still read. The function never throws for
 * a plugin's own package.
 */
export async function listInstalledPlugins(host: CatalogHost, options: CatalogOptions = {}): Promise<CatalogListing> {
  let listed: readonly HostPlugin[]
  try {
    listed = (await host.plugin.list()).data
  } catch (error) {
    return { plugins: [], problems: [{ target: "", problems: [`the plugin list could not be read: ${message(error)}`] }] }
  }
  const cacheDirectory = options.cacheDirectory ?? defaultCacheDirectory()
  const plugins: CatalogPlugin[] = []
  const problems: CatalogProblem[] = []
  const seen = new Set<string>()
  for (const plugin of listed) {
    const source = plugin.source
    if (source.type === "builtin" || source.type === "sdk") continue
    const target = source.type === "local" ? source.path : source.target
    if (plugin.state?.status === "failed") {
      const ref = plugin.state.ref === undefined ? "" : ` (${plugin.state.ref})`
      problems.push({ target, problems: [`the host reports this plugin failed to load: ${plugin.state.error}${ref}`] })
      continue
    }
    if (source.type === "local") {
      const problem = singleFileProblem(source.path)
      if (problem !== undefined) {
        problems.push({ target, problems: [problem] })
        continue
      }
      // A local plugin has no registry entry and no version to check: its package.json is the only source of truth.
      const installed = readInstalledManifest(source.path)
      if (installed.ok) {
        if (seen.has(installed.value.directory)) continue
        seen.add(installed.value.directory)
        plugins.push({ target, ...installed.value })
      } else problems.push({ target, problems: installed.problems })
      continue
    }
    const parsed = parseTarget(source.target)
    const direct = options.resolve?.(source.target) ?? directDirectory(source.target)
    const located = direct === undefined ? locate(cacheDirectory, source.target, source.version) : { directory: direct, registry: parsed?.kind === "registry" }
    if (located === undefined) {
      const why =
        parsed === undefined
          ? `${source.target} is not an npm or Git package target the catalog can locate`
          : `no installed package for ${source.target} under ${join(cacheDirectory, "npm")}`
      problems.push({ target, problems: [why] })
      continue
    }
    // A registry target names the package's own version, so the install must match it. A Git target's version is a
    // commit revision, not the package's version, so it is never checked here.
    const version = located.registry ? source.version : undefined
    const installed = readInstalledManifest(located.directory, version === undefined ? {} : { version })
    if (installed.ok) {
      if (seen.has(installed.value.directory)) continue
      seen.add(installed.value.directory)
      plugins.push({ target, ...installed.value })
    } else problems.push({ target, problems: installed.problems })
  }
  return { plugins, problems }
}
