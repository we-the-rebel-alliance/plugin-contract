/**
 * `plugin-kit supported`: the `SUPPORTED.md` row for this plugin.
 *
 * The matrix lives in plugin-contract, not in the plugin, so the kit prints the row a maintainer pastes there. Every
 * cell but `Wave` and `Status` comes from the manifest: the repository, the account mechanism, the sources with their
 * kind and read or output, the write classes, the signals and the suggested cadence. The two that are a programme's
 * decision rather than the plugin's are flags, with `—` and `supported` as their defaults.
 */
import type { Manifest } from "../manifest.ts"
import { cadence, list } from "./format.ts"
import { readPlugin, requireManifest } from "./plugin.ts"
import type { CommandContext } from "./types.ts"

/** The write classes a SUPPORTED.md row names, in the contract's order. */
export function writeClasses(manifest: Manifest): string[] {
  const order = ["write", "send", "share", "delete", "export", "admin"]
  const found = new Set<string>(Object.values(manifest.methods).map((method) => method.class))
  return order.filter((value) => found.has(value))
}

/** The columns of the data-source table in SUPPORTED.md, in its order. */
export const SUPPORTED_HEADERS: readonly string[] = ["Plugin", "Repository", "Accounts (today → target)", "Sources (kind: reads/output)", "Write classes", "Signals", "Suggested cadence", "Wave", "Status"]

/** The row's cells, for a test and for the JSON answer. */
export function supportedCells(manifest: Manifest, repository: string, options: { readonly wave?: string | undefined; readonly status?: string | undefined } = {}): string[] {
  const accounts = accountsCell(manifest)
  const sources =
    manifest.sources.length === 0
      ? "—"
      : manifest.sources
          .map((source) => `${source.id} (${source.kind}: ${source.kind === "events" ? source.reads : source.output})`)
          .join(", ")
  const signals = [...new Set(manifest.sources.flatMap((source) => source.signals ?? []))].sort()
  const minutes = manifest.sources
    .map((source) => source.cadence?.suggestMinutes)
    .filter((value): value is number => value !== undefined)
  const cadenceCell = minutes.length === 0 ? "—" : cadence(Math.min(...minutes))
  return [manifest.plugin.name, `\`${repository}\``, accounts, sources, list(writeClasses(manifest), String), list(signals, String), cadenceCell, options.wave ?? "—", options.status ?? "supported"]
}

/** The accounts column, read from the manifest: the mechanism, and whether it profiles each alias. */
export function accountsCell(manifest: Manifest): string {
  const info = manifest.accounts
  if (info === undefined) return "—"
  return info.profile === undefined ? info.via : `${info.via} (profile per alias)`
}

/** The row as SUPPORTED.md writes it. */
export function supportedRow(manifest: Manifest, repository: string, options: { readonly wave?: string | undefined; readonly status?: string | undefined } = {}): string {
  return `| ${supportedCells(manifest, repository, options).join(" | ")} |`
}

/** `plugin-kit supported`: print the row. */
export async function runSupported(context: CommandContext, options: { readonly wave?: string | undefined; readonly status?: string | undefined } = {}): Promise<number> {
  const plugin = readPlugin(context.dir)
  const manifest = requireManifest(plugin)
  const cells = supportedCells(manifest, plugin.repository, options)
  if (context.json) {
    context.io.stdout(`${JSON.stringify({ headers: SUPPORTED_HEADERS, cells, row: supportedRow(manifest, plugin.repository, options) }, null, 2)}\n`)
  } else {
    context.io.stdout(`${supportedRow(manifest, plugin.repository, options)}\n`)
  }
  return 0
}
