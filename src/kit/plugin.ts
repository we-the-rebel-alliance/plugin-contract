/**
 * The plugin a command runs on: its `package.json`, its validated `capabilities` manifest, and the hosts its CI claims.
 *
 * The manifest is read from disk, never over RPC (contract §4). A command that needs the manifest and cannot validate it
 * reports the manifest module's own problems, with their paths, and does nothing else.
 */
import { basename, join } from "node:path"
import { checkManifest, TESTED_OPENCODE, type Manifest } from "../manifest.ts"
import { readJson } from "./files.ts"
import { KitError } from "./types.ts"

/** The subset of a package.json the kit reads. Everything else stays as it was written. */
export interface PackageJson {
  readonly name?: string | undefined
  readonly version?: string | undefined
  readonly private?: boolean | undefined
  readonly repository?: string | { readonly url?: string | undefined } | undefined
  readonly capabilities?: unknown
  readonly [key: string]: unknown
}

/** One plugin directory, as a command sees it. */
export interface Plugin {
  /** The absolute directory. */
  readonly dir: string
  /** The absolute `package.json` path. */
  readonly packageFile: string
  /** The package.json's own keys. */
  readonly package: PackageJson
  /** The validated manifest, or undefined when it does not validate. */
  readonly manifest?: Manifest | undefined
  /** The manifest module's problems, one sentence each; empty when the manifest validates. */
  readonly problems: readonly string[]
  /** The plugin's one name: the manifest's, then the package name's last segment, then the directory's name. */
  readonly name: string
  /** The repository's name, such as `slack-plugin`; the manifest's name when the package names no repository. */
  readonly repository: string
}

/** Read a plugin directory. Throws `KIT_NOT_A_PLUGIN` when there is no readable package.json. */
export function readPlugin(dir: string): Plugin {
  const packageFile = join(dir, "package.json")
  const raw = readJson(packageFile)
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new KitError("KIT_NOT_A_PLUGIN", `${dir} has no readable package.json`, "run plugin-kit from a plugin's root directory, or pass --dir <plugin>")
  }
  const pkg = raw as PackageJson
  const checked = checkManifest(pkg.capabilities)
  const manifest = checked.ok ? checked.value : undefined
  const packageName = typeof pkg.name === "string" ? pkg.name.split("/").at(-1) : undefined
  return {
    dir,
    packageFile,
    package: pkg,
    ...(manifest === undefined ? {} : { manifest }),
    problems: checked.ok ? [] : checked.problems,
    name: manifest?.plugin.name ?? packageName ?? basename(dir),
    repository: repositoryName(pkg.repository) ?? (`${manifest?.plugin.name ?? packageName ?? basename(dir)}-plugin`),
  }
}

/** The repository's name from a package.json `repository`, in either form npm allows. */
export function repositoryName(repository: PackageJson["repository"]): string | undefined {
  const url = typeof repository === "string" ? repository : repository?.url
  if (typeof url !== "string") return undefined
  const trimmed = url.replace(/\.git$/, "").replace(/\/+$/, "")
  const segment = trimmed.slice(trimmed.lastIndexOf("/") + 1)
  return segment === "" ? undefined : segment
}

/** The hosts a plugin's CI must run T1 on. Absent manifest: the release this contract is tested on. */
export function hostsOf(plugin: Plugin): string[] {
  return [...(plugin.manifest?.plugin.host.tested ?? [TESTED_OPENCODE])]
}

/** The plugin's manifest, or a `KIT_MANIFEST` error naming every problem. */
export function requireManifest(plugin: Plugin): Manifest {
  if (plugin.manifest !== undefined) return plugin.manifest
  throw new KitError(
    "KIT_MANIFEST",
    `${plugin.name}'s capabilities manifest does not validate:\n- ${plugin.problems.join("\n- ")}`,
    "fix capabilities in package.json; docs/contract.md §4 is the shape",
  )
}
