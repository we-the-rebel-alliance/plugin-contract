/**
 * Two-account behaviour, from recorded synthetic provider fixtures (contract §5, §16).
 *
 * Every plugin that signs in serves several named accounts at once. The kit cannot sign in, so the plugin records what
 * its own tests proved against two aliases: the alias list, the `ACCOUNT_REQUIRED` and `ACCOUNT_UNKNOWN` refusals, and
 * one cursor that another account may not use. This module checks that the recording names valid aliases and the
 * contract's codes, and that the manifest agrees with it.
 */
import { aliasProblem, isAlias } from "../../accounts.ts"
import { serverOf } from "../../access.ts"
import { methodAccounts, type Manifest } from "../../manifest.ts"
import { error, warning, type Finding } from "./report.ts"

/** What a plugin records about its accounts. */
export interface RecordedAccounts {
  /** Run the two-account cases against the real host in T1, not only against the recording. */
  readonly real?: boolean | undefined
  readonly aliases?: readonly string[] | undefined
  readonly required?: { readonly method?: unknown; readonly code?: unknown } | undefined
  readonly unknown?: { readonly method?: unknown; readonly account?: unknown; readonly code?: unknown } | undefined
  readonly cursors?: readonly { readonly method?: unknown; readonly account?: unknown; readonly other?: unknown; readonly code?: unknown }[] | undefined
}

/** The codes a cursor crossing accounts or scopes may answer. */
const CURSOR_CODES = ["CURSOR_INVALID", "ACCOUNT_MISMATCH"] as const

/** Every account finding: the aliases, the two refusals, and a cursor that another account may not use. */
export function accountFindings(manifest: Manifest, recorded: RecordedAccounts | undefined, options: { readonly record?: boolean | undefined } = {}): Finding[] {
  const findings: Finding[] = []
  const name = manifest.plugin.name
  const aliases = recorded?.aliases ?? []

  if (manifest.accounts === undefined) {
    if (aliases.length > 0) {
      findings.push(error("accounts.undeclared", `the fixture records the accounts ${aliases.join(", ")}, and capabilities declares no accounts`, { path: "capabilities.accounts", fix: "Remove the accounts block, or declare how they are held." }))
    }
    for (const [method, item] of Object.entries(manifest.methods)) {
      if (methodAccounts(item) !== "optional") continue
      findings.push(warning("accounts.undeclared", `${method} takes an account, and the plugin declares no accounts`, { path: `capabilities.methods.${method}.accounts`, fix: "Declare accounts, or set the method's accounts to none." }))
    }
    return findings
  }

  if (recorded === undefined) {
    findings.push(
      options.record === true
        ? warning("accounts.recorded", `${name} declares accounts and records no two-account behaviour yet`, { path: "fixtures/conformance.json" })
        : error("accounts.recorded", `${name} declares accounts and records no two-account behaviour`, {
            path: "fixtures/conformance.json",
            fix: "Record two aliases with ACCOUNT_REQUIRED, ACCOUNT_UNKNOWN and a cursor that another account may not use.",
          }),
    )
    return findings
  }

  if (aliases.length < 2) {
    findings.push(error("accounts.aliases", `${name} declares accounts and the fixture records ${aliases.length === 0 ? "none" : `one alias (${aliases[0]})`}: several accounts are the contract's promise`, { path: "fixtures/conformance.json", fix: "Record at least two aliases, such as work and personal." }))
  }
  const seen = new Set<string>()
  for (const alias of aliases) {
    const problem = aliasProblem(alias, `the alias "${String(alias)}"`)
    if (problem !== undefined) findings.push(error("accounts.aliases", problem, { path: "fixtures/conformance.json" }))
    if (seen.has(alias)) findings.push(error("accounts.aliases", `the fixture records the alias ${alias} twice`, { path: "fixtures/conformance.json" }))
    seen.add(alias)
    // The integration or MCP server a person signs in to: the derivation must accept the alias, which it does only for
    // a valid one. This also proves the plugin's names come from its one name.
    const server = serverOf(name, alias, aliases)
    if (!server.ok) findings.push(error("accounts.names", `${alias} derives no integration or MCP server name: ${server.problems.join("; ")}`, { path: "fixtures/conformance.json" }))
  }
  if (manifest.accounts.via === "local" && aliases.length > 1) {
    findings.push(error("accounts.local", `${name} holds accounts as the machine's identity, and the fixture records ${aliases.length} aliases: a local plugin has one account`, { path: "capabilities.accounts.via" }))
  }

  const required = recorded.required
  if (required === undefined) {
    findings.push(error("accounts.required", "the fixture records no ACCOUNT_REQUIRED case: with two aliases and no account, a call is refused", { path: "fixtures/conformance.json" }))
  } else {
    if (required.code !== "ACCOUNT_REQUIRED") findings.push(error("accounts.required", `the required-account case answers ${String(required.code)}, not ACCOUNT_REQUIRED`, { path: "fixtures/conformance.json" }))
    const method = typeof required.method === "string" ? required.method : ""
    if (method === "" || manifest.methods[method] === undefined) findings.push(error("accounts.required", `the required-account case names ${String(required.method)}, which is not a declared method`, { path: "fixtures/conformance.json" }))
    else if (methodAccounts(manifest.methods[method]!) !== "optional") findings.push(error("accounts.required", `${method} does not take an account, so it cannot ask for one`, { path: `capabilities.methods.${method}.accounts` }))
  }

  const unknown = recorded.unknown
  if (unknown === undefined) {
    findings.push(error("accounts.unknown", "the fixture records no ACCOUNT_UNKNOWN case: an alias the plugin does not serve is refused", { path: "fixtures/conformance.json" }))
  } else {
    if (unknown.code !== "ACCOUNT_UNKNOWN") findings.push(error("accounts.unknown", `the unknown-account case answers ${String(unknown.code)}, not ACCOUNT_UNKNOWN`, { path: "fixtures/conformance.json" }))
    if (typeof unknown.account !== "string" || isAlias(unknown.account) === false) findings.push(error("accounts.unknown", `the unknown-account case names ${String(unknown.account)}, which is not an alias`, { path: "fixtures/conformance.json" }))
    else if (aliases.includes(unknown.account)) findings.push(error("accounts.unknown", `the unknown-account case names ${unknown.account}, and the fixture records it as an alias`, { path: "fixtures/conformance.json" }))
    const method = typeof unknown.method === "string" ? unknown.method : ""
    if (method === "" || manifest.methods[method] === undefined) findings.push(error("accounts.unknown", `the unknown-account case names ${String(unknown.method)}, which is not a declared method`, { path: "fixtures/conformance.json" }))
  }

  const cursors = recorded.cursors ?? []
  if (cursors.length === 0) {
    findings.push(error("accounts.cursors", "the fixture records no cursor another account may not use: a cursor is bound to its account", { path: "fixtures/conformance.json" }))
  }
  for (const [index, cursor] of cursors.entries()) {
    const at = `cursors[${index}]`
    if (typeof cursor.account !== "string" || !aliases.includes(cursor.account)) findings.push(error("accounts.cursors", `${at} names ${String(cursor.account)}, which is not a recorded alias`, { path: "fixtures/conformance.json" }))
    if (typeof cursor.other !== "string" || !aliases.includes(cursor.other)) findings.push(error("accounts.cursors", `${at} reads under ${String(cursor.other)}, which is not a recorded alias`, { path: "fixtures/conformance.json" }))
    if (cursor.account === cursor.other) findings.push(error("accounts.cursors", `${at} reads under the same account that issued the cursor`, { path: "fixtures/conformance.json" }))
    if (!(CURSOR_CODES as readonly unknown[]).includes(cursor.code)) findings.push(error("accounts.cursors", `${at} answers ${String(cursor.code)}, not ${CURSOR_CODES.join(" or ")}`, { path: "fixtures/conformance.json" }))
    const method = typeof cursor.method === "string" ? cursor.method : ""
    if (method === "" || manifest.methods[method] === undefined) findings.push(error("accounts.cursors", `${at} names ${String(cursor.method)}, which is not a declared method`, { path: "fixtures/conformance.json" }))
  }
  return findings
}
