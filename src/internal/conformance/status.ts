/**
 * The bus events, `status` and `probe` (contract §10, §11, §16).
 *
 * A manifest declares the bus events the plugin emits; the fixture records which ones it emitted, so a declared event
 * nothing emits and an emitted event nothing declares are both findings. The status answer is checked for its shape,
 * its host range against the manifest, one entry per alias, and no secret in any reason. A probe is checked per source
 * by the source checks; status is one answer per plugin.
 */
import { ACCOUNT_STATES, REASON_MAX } from "../../accounts.ts"
import { BUS_EVENTS, OPENCODE_RANGE, ownerProblems, type Manifest } from "../../manifest.ts"
import { secretKinds } from "../events.ts"
import { error, warning, type Finding } from "./report.ts"

/** What a plugin records about its bus and status. */
export interface RecordedEvents {
  readonly emitted?: readonly unknown[] | undefined
  readonly status?: unknown
}

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The bus events: emitted is declared, declared is emitted, and every name is one §10 defines. */
export function busFindings(manifest: Manifest, recorded: RecordedEvents | undefined, options: { readonly record?: boolean | undefined } = {}): Finding[] {
  const findings: Finding[] = []
  const declared = Object.keys(manifest.events)
  const emitted = (recorded?.emitted ?? []).filter((event): event is string => typeof event === "string")
  if (recorded?.emitted === undefined) {
    if (declared.length > 0) {
      findings.push(
        options.record === true
          ? warning("events.recorded", `${manifest.plugin.name} declares ${declared.join(", ")} and records none`, { path: "fixtures/conformance.json" })
          : error("events.recorded", `${manifest.plugin.name} declares ${declared.join(", ")} and records none: a declared event is one the plugin emits`, {
              path: "fixtures/conformance.json",
              fix: "Emit each declared event in a test and record it, or remove the declaration.",
            }),
      )
    }
    return findings
  }
  for (const event of emitted) {
    if (!(BUS_EVENTS as readonly unknown[]).includes(event)) findings.push(error("events.declared", `the fixture records the bus event ${event}, which §10 does not define`, { path: "fixtures/conformance.json" }))
    else if (!declared.includes(event)) findings.push(error("events.declared", `the plugin emits ${event}, and capabilities.events does not declare it`, { path: `capabilities.events.${event}`, fix: `Add "${event}": {} to capabilities.events.` }))
  }
  for (const event of declared) {
    if (!emitted.includes(event)) findings.push(error("events.emitted", `${manifest.plugin.name} declares ${event} and no recorded test emitted it`, { path: `capabilities.events.${event}`, fix: "Emit it where the contract says it belongs, and record it, or remove the declaration." }))
  }
  return findings
}

/** The status answer's keys. */
const STATUS_KEYS: readonly string[] = ["name", "version", "host", "state", "accounts", "unguardedAgents", "nextStep"]
const ACCOUNT_KEYS: readonly string[] = ["alias", "state", "owner", "reason"]
const HOST_KEYS: readonly string[] = ["version", "range", "tested"]

/** The status answer: its shape, its host and aliases, and no secret. */
export function statusFindings(manifest: Manifest, version: string, answer: unknown, aliases: readonly string[]): Finding[] {
  if (!plain(answer)) return [error("status.shape", "the fixture records no status answer", { path: "fixtures/conformance.json" })]
  const findings: Finding[] = []
  for (const key of Object.keys(answer)) if (!STATUS_KEYS.includes(key)) findings.push(error("status.shape", `status carries ${key}, which contract §11 does not define`, { path: "fixtures/conformance.json" }))
  if (answer["name"] !== manifest.plugin.name) findings.push(error("status.name", `status names ${JSON.stringify(answer["name"])}, not ${manifest.plugin.name}`, { path: "fixtures/conformance.json" }))
  if (answer["version"] !== version) findings.push(error("status.version", `status names version ${JSON.stringify(answer["version"])}, not the installed ${version}`, { path: "fixtures/conformance.json" }))
  if (!["ready", "needs_sign_in", "error"].includes(String(answer["state"]))) findings.push(error("status.state", `status is ${JSON.stringify(answer["state"])}, not ready, needs_sign_in or error`, { path: "fixtures/conformance.json" }))
  if (!Array.isArray(answer["unguardedAgents"]) || answer["unguardedAgents"].some((agent) => typeof agent !== "string" || agent.length === 0 || agent.length > 64)) {
    findings.push(error("status.shape", "status.unguardedAgents must be a list of agent names", { path: "fixtures/conformance.json" }))
  }
  if (answer["nextStep"] !== null && answer["nextStep"] !== undefined && (typeof answer["nextStep"] !== "string" || answer["nextStep"].length > 200)) {
    findings.push(error("status.shape", "status.nextStep must be one line of at most 200 characters, or null", { path: "fixtures/conformance.json" }))
  }
  const host = answer["host"]
  if (!plain(host)) findings.push(error("status.host", "status.host must be { version, range, tested }", { path: "fixtures/conformance.json" }))
  else {
    for (const key of Object.keys(host)) if (!HOST_KEYS.includes(key)) findings.push(error("status.host", `status.host carries ${key}, which contract §11 does not define`, { path: "fixtures/conformance.json" }))
    if (typeof host["version"] !== "string" || host["version"].length === 0) findings.push(error("status.host", "status.host.version must name the OpenCode release it ran on", { path: "fixtures/conformance.json" }))
    if (host["range"] !== OPENCODE_RANGE) findings.push(error("status.host", `status.host.range is ${JSON.stringify(host["range"])}, and the manifest's is ${OPENCODE_RANGE}`, { path: "fixtures/conformance.json" }))
    if (!Array.isArray(host["tested"]) || host["tested"].length === 0 || host["tested"].some((tested) => typeof tested !== "string")) findings.push(error("status.host", "status.host.tested must list the releases CI ran", { path: "fixtures/conformance.json" }))
  }
  const accounts = answer["accounts"]
  if (!Array.isArray(accounts)) findings.push(error("status.accounts", "status.accounts must be a list, one entry per alias", { path: "fixtures/conformance.json" }))
  else {
    const seen = new Set<string>()
    for (const [index, entry] of accounts.entries()) {
      if (!plain(entry)) {
        findings.push(error("status.accounts", `status.accounts[${index}] must be { alias, state, owner?, reason? }`, { path: "fixtures/conformance.json" }))
        continue
      }
      for (const key of Object.keys(entry)) if (!ACCOUNT_KEYS.includes(key)) findings.push(error("status.accounts", `status.accounts[${index}] carries ${key}, which contract §11 does not define`, { path: "fixtures/conformance.json" }))
      const alias = entry["alias"]
      if (typeof alias !== "string" || !(aliases.length === 0 || aliases.includes(alias))) findings.push(error("status.accounts", `status.accounts[${index}] names ${JSON.stringify(alias)}, which the fixture does not record as an alias`, { path: "fixtures/conformance.json" }))
      else if (seen.has(alias)) findings.push(error("status.accounts", `status lists ${alias} twice`, { path: "fixtures/conformance.json" }))
      else seen.add(alias)
      if (!(ACCOUNT_STATES as readonly unknown[]).includes(entry["state"])) findings.push(error("status.accounts", `status.accounts[${index}].state is ${JSON.stringify(entry["state"])}, not ${ACCOUNT_STATES.join(", ")}`, { path: "fixtures/conformance.json" }))
      if (entry["reason"] !== undefined && (typeof entry["reason"] !== "string" || entry["reason"].length > REASON_MAX)) {
        findings.push(error("status.accounts", `status.accounts[${index}].reason must be one string of at most ${REASON_MAX} characters`, { path: "fixtures/conformance.json" }))
      }
      if (entry["owner"] !== undefined) findings.push(...ownerProblems(entry["owner"], `status.accounts[${index}].owner`).map((problem) => error("status.accounts", problem, { path: "fixtures/conformance.json" })))
    }
    for (const alias of aliases) if (!seen.has(alias)) findings.push(error("status.accounts", `status lists no account ${alias}, and the fixture records it`, { path: "fixtures/conformance.json" }))
  }
  const secrets = secretKinds(JSON.stringify(answer))
  if (secrets.length > 0) findings.push(error("status.secret", `status carries a secret (${secrets.join(", ")}): status and logs never carry credentials`, { path: "fixtures/conformance.json" }))
  return findings
}
