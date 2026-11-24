/**
 * `conformance`: the kit's checks, as one report (contract §16; roadmap 1.11).
 *
 * The package's `conformance` entry exports the whole gate. `plugin-kit` calls these three functions and never
 * re-implements a check:
 *
 *   const report = await runConformance("/path/to/plugin")       // T0, the declaration, recordings, T1
 *   const findings = await t0("/path/to/plugin")                 // static only: files, manifest, docs
 *   const findings = await t1("/path/to/plugin", "2.4.1")        // one host: load, doors, permissions, LD-5
 *
 * A plugin is read from the installed package on disk: its `capabilities` manifest is validated and hashed by
 * `readInstalledManifest`, and its own tests record what it answers under `fixtures/conformance.json`. The report's
 * `ok` is false when any finding is an error; a warning names something the kit could not prove, and `record: true`
 * turns a missing recording into a warning while a plugin is being recorded.
 *
 * The checks are the contract's own, in the order a maintainer reads them: T0 (`static.ts`), the declaration
 * (`declaration.ts`), options (`declaration.ts`), the recorded sources (`internal/events-conformance.ts`), accounts
 * (`accounts.ts`), actions (`actions.ts`), bus events and status (`status.ts`), grants and the RPC confirmation
 * (`grants.ts`), and T1 (`host.ts`). Generated docs are rendered by `docs.ts`; `renderGeneratedDocs` is exported so
 * `plugin-kit docs` writes exactly what T0 compares.
 */
import { resolve } from "node:path"
import { readInstalledManifest } from "./manifest.ts"
import { accountFindings } from "./internal/conformance/accounts.ts"
import { actionFindings } from "./internal/conformance/actions.ts"
import { declarationFindings, optionsFindings } from "./internal/conformance/declaration.ts"
import { readFixture } from "./internal/conformance/fixture.ts"
import { grantFindings, rpcConfirmationFindings } from "./internal/conformance/grants.ts"
import { hostFindings, inspectHost, namespaceOf, UNSUPPORTED_HOST } from "./internal/conformance/host.ts"
import { error, isOk, warning, type ConformanceReport, type Finding } from "./internal/conformance/report.ts"
import { staticFindings } from "./internal/conformance/static.ts"
import { busFindings, statusFindings } from "./internal/conformance/status.ts"
import { detailFindings, eventsFindings, probeFindings, snapshotFindings, suggestFindings } from "./internal/events-conformance.ts"

export type { ConformanceReport, Finding } from "./internal/conformance/report.ts"
export { renderGeneratedDocs } from "./internal/conformance/docs.ts"

/** What `runConformance` checks that the caller chooses. */
export interface ConformanceOptions {
  /** The OpenCode releases to load the plugin on. Default: the manifest's `plugin.host.tested`. */
  readonly hosts?: readonly string[] | undefined
  /** While recording: a missing recording is a warning, not an error. */
  readonly record?: boolean | undefined
}

/**
 * T0, the static gate: the namespace line, each skill description, every tool a text names, a pinned method's
 * evidence, and the generated doc sections. No model, no network, no host.
 */
export async function t0(pluginDir: string): Promise<Finding[]> {
  const directory = resolve(pluginDir)
  const installed = readInstalledManifest(directory)
  if (!installed.ok) return installed.problems.map((problem) => error("T0.manifest", problem, { path: "package.json", fix: "Fix capabilities in package.json, then run T0 again." }))
  const namespace = await namespaceOf(directory, installed.value.manifest)
  return staticFindings(directory, installed.value.manifest, { ...(namespace === undefined ? {} : { namespace }) })
}

/**
 * T1, the host gate: the plugin loads on `host`, every method is a tool and an RPC method with permission
 * `<name>.<method>`, the access levels hold, and a non-read method over RPC without an answered ask is refused. An
 * unsupported `host` is expected to refuse cleanly with `HOST_UNTESTED`.
 */
export async function t1(pluginDir: string, host: string): Promise<Finding[]> {
  const directory = resolve(pluginDir)
  const installed = readInstalledManifest(directory)
  if (!installed.ok) return installed.problems.map((problem) => error("T1.manifest", problem, { path: "package.json", fix: "Fix capabilities in package.json, then run T1 again." }))
  const read = readFixture(directory).fixture
  return hostFindings(directory, installed.value.manifest, host, {
    ...(read?.accounts?.aliases === undefined ? {} : { accounts: read.accounts.aliases }),
    ...(read?.accounts?.real === true ? { realAccounts: true } : {}),
    ...(typeof read?.accounts?.required?.method === "string" ? { accountMethod: read.accounts.required.method } : {}),
    ...(read?.rpc?.inputs === undefined ? {} : { inputs: read.rpc.inputs }),
  })
}

/**
 * Everything `plugin-kit conformance` runs: T0, the manifest's own declaration and options, every recorded source and
 * account, the bus and status, actions, grants and the RPC confirmation, then T1 on every host the manifest tested and
 * on the first unsupported one.
 */
export async function runConformance(pluginDir: string, options: ConformanceOptions = {}): Promise<ConformanceReport> {
  const directory = resolve(pluginDir)
  const installed = readInstalledManifest(directory)
  if (!installed.ok) {
    return { ok: false, findings: installed.problems.map((problem) => error("manifest.invalid", problem, { path: "package.json", fix: "Fix capabilities in package.json." })) }
  }
  const { manifest, package: packageName, version } = installed.value
  const findings: Finding[] = []
  const record = options.record === true

  findings.push(...declarationFindings(installed.value))
  findings.push(...optionsFindings(manifest))

  const read = readFixture(directory)
  const fixture = read.fixture
  if (read.problem !== undefined) {
    findings.push(error("fixture.read", read.problem, { path: "fixtures/conformance.json", fix: "Fix the JSON, then run conformance again." }))
  } else if (fixture?.plugin !== undefined && fixture.plugin !== packageName) {
    findings.push(error("fixture.plugin", `the fixture was recorded for ${fixture.plugin}, not ${packageName}`, { path: "fixtures/conformance.json" }))
  }
  const aliases = fixture?.accounts?.aliases ?? []
  const account = aliases[0] ?? "default"

  for (const source of manifest.sources) {
    const recorded = fixture?.sources?.[source.id]
    if (recorded === undefined) {
      findings.push(
        record
          ? warning("sources.recorded", `${source.id} records no answer yet`, { path: "fixtures/conformance.json" })
          : error("sources.recorded", `${source.id} records no answer, so nothing shows what its read returns`, {
              path: "fixtures/conformance.json",
              fix: "Record it with plugin-kit record.",
            }),
      )
      continue
    }
    if (source.kind === "events") {
      findings.push(...eventsFindings({ plugin: packageName, source, recorded, record }))
      if (source.details !== undefined && source.details.length > 0) {
        if (recorded.details === undefined || recorded.details.length === 0) {
          findings.push(record ? warning("details.recorded", `${source.id} declares detail reads and records none`, { path: "fixtures/conformance.json" }) : error("details.recorded", `${source.id} declares detail reads and records none`, { path: "fixtures/conformance.json", fix: "Record one read inside the scope, and one outside it." }))
        } else {
          findings.push(...detailFindings(source, recorded.details, account))
        }
      }
      if (source.scope?.suggest !== undefined) {
        if (recorded.suggest?.answer === undefined) {
          findings.push(record ? warning("suggest.recorded", `${source.id} declares a suggest read and records no answer`, { path: "fixtures/conformance.json" }) : error("suggest.recorded", `${source.id} declares a suggest read and records no answer`, { path: "fixtures/conformance.json" }))
        } else {
          findings.push(...suggestFindings(source, recorded.suggest.answer))
        }
      }
    } else {
      if (recorded.snapshot?.answer === undefined) {
        findings.push(record ? warning("snapshot.recorded", `${source.id} records no snapshot answer`, { path: "fixtures/conformance.json" }) : error("snapshot.recorded", `${source.id} records no snapshot answer`, { path: "fixtures/conformance.json", fix: "Record one snapshot with plugin-kit record." }))
      } else {
        findings.push(...snapshotFindings(source, recorded.snapshot.answer, account))
      }
    }
    if (recorded.probe?.answer !== undefined) findings.push(...probeFindings(source, recorded.probe.answer, undefined))
  }

  if (manifest.accounts !== undefined) {
    const missing = manifest.sources.filter((source) => fixture?.sources?.[source.id]?.probe?.answer === undefined)
    if (missing.length > 0) {
      findings.push(
        record
          ? warning("probe.recorded", `${missing.map((source) => source.id).join(", ")} record no probe answer`, { path: "fixtures/conformance.json" })
          : error("probe.recorded", `${missing.map((source) => source.id).join(", ")} record no probe answer, and a plugin with accounts declares probe`, {
              path: "fixtures/conformance.json",
              fix: "Record probe for each account alias.",
            }),
      )
    }
  }

  findings.push(...accountFindings(manifest, fixture?.accounts, { record }))
  findings.push(...busFindings(manifest, fixture?.events, { record }))
  if (fixture?.events?.status === undefined) {
    findings.push(record ? warning("status.recorded", `${packageName} records no status answer`, { path: "fixtures/conformance.json" }) : error("status.recorded", `${packageName} records no status answer`, { path: "fixtures/conformance.json", fix: "Record status from one account." }))
  } else {
    findings.push(...statusFindings(manifest, version, fixture.events.status, aliases))
  }
  findings.push(...actionFindings(manifest, fixture?.actions, { record }))
  findings.push(...(await grantFindings(manifest, fixture?.grants, { record })))
  findings.push(...rpcConfirmationFindings(manifest, fixture?.rpc, { record }))

  const hosts = options.hosts ?? manifest.plugin.host.tested
  if (hosts.length === 0) {
    findings.push(warning("T1.unchecked", "no host was run, so the doors, permissions and LD-5 were not proven", { fix: "Pass hosts: [\"2.4.1\"], or run plugin-kit hosts." }))
  }
  let namespace: string | undefined
  for (const host of hosts) {
    const inspection = await inspectHost(directory, manifest, host, {
      ...(aliases.length === 0 ? {} : { accounts: aliases }),
      ...(fixture?.accounts?.real === true ? { realAccounts: true } : {}),
      ...(typeof fixture?.accounts?.required?.method === "string" ? { accountMethod: fixture.accounts.required.method } : {}),
      ...(fixture?.rpc?.inputs === undefined ? {} : { inputs: fixture.rpc.inputs }),
    })
    findings.push(...inspection.findings)
    if (namespace === undefined && inspection.run?.namespace !== undefined) namespace = inspection.run.namespace.description
  }
  if (hosts.length > 0 && !hosts.includes(UNSUPPORTED_HOST)) findings.push(...(await hostFindings(directory, manifest, UNSUPPORTED_HOST, aliases.length === 0 ? {} : { accounts: aliases })))
  findings.unshift(...staticFindings(directory, manifest, { ...(namespace === undefined ? {} : { namespace }), record }))

  return { ok: isOk(findings), findings }
}
