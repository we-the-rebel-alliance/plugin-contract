/**
 * Names derived for an account (contract §3 and §5).
 *
 * One rule for every mechanism: the plugin's `<name>` for the `default` account, and `<name>-<alias>` for any other.
 * The same name is the OpenCode integration id (`integration`) or the MCP server name (`mcp`), so a person signs in
 * and a tool is permitted under one name.
 */
import { DEFAULT_ALIAS, isAlias } from "./alias.ts"

/** The integration or MCP server name of `alias`: `<plugin>` for `default`, `<plugin>-<alias>` otherwise. */
export function accountName(plugin: string, alias: string): string {
  if (!isAlias(alias)) throw new Error(`accounts: "${alias}" is not an account alias`)
  return alias === DEFAULT_ALIAS ? plugin : `${plugin}-${alias}`
}

/** The OpenCode integration id of `alias` (contract §3). */
export const integrationName = accountName

/** The MCP server name of `alias` (contract §3). */
export const serverName = accountName

/** The label a person sees next to a name: the plugin's title, and the alias when it has one. */
export function accountLabel(title: string, alias: string): string {
  return alias === DEFAULT_ALIAS ? title : `${title} (${alias})`
}
