/**
 * `plugin-kit check`: everything a pull request needs from the kit.
 *
 * The conformance gate is one `runConformance` call: T0, the declaration and options, the recorded sources and
 * accounts, the bus and status, actions, grants, the RPC confirmation, and T1 on every tested host plus the first
 * unsupported one (contract §16). Calling `t0` and `t1` separately would prove only part of it. The kit adds the
 * repository concerns: the required doc files exist, no committed file carries an app name, a `main` link or a secret,
 * and the kit is not in a runtime build.
 */
import { bundledFindings } from "./bundled.ts"
import { missingDocFiles } from "./docs.ts"
import { forbiddenFindings } from "./forbidden.ts"
import { readPlugin } from "./plugin.ts"
import { print } from "./output.ts"
import type { CommandContext, Finding } from "./types.ts"
import { hasError, sortFindings } from "./types.ts"

/** Run the conformance gate, the docs file set, the forbidden scan and the bundled-kit check. */
export async function checkPlugin(context: CommandContext, options: { readonly hosts?: readonly string[] | undefined } = {}): Promise<Finding[]> {
  const plugin = readPlugin(context.dir)
  const hosts = options.hosts === undefined || options.hosts.length === 0 ? [] : [...options.hosts]
  const findings: Finding[] = []
  try {
    const runner = await context.conformance()
    const report = await runner.runConformance(context.dir, hosts.length === 0 ? {} : { hosts })
    findings.push(...report.findings)
  } catch (error) {
    findings.push({
      id: "KIT_CONFORMANCE",
      level: "error",
      message: `conformance did not run: ${error instanceof Error ? error.message : String(error)}`,
      fix: "fix the plugin or the installed plugin-contract, then run plugin-kit check again",
    })
  }
  if (plugin.manifest !== undefined) findings.push(...missingDocFiles(context.dir))
  findings.push(...forbiddenFindings(context.dir))
  findings.push(...bundledFindings(context.dir))
  return sortFindings(findings)
}

/** `plugin-kit check`: run the gates and print one report. */
export async function runCheck(context: CommandContext, options: { readonly hosts?: readonly string[] | undefined } = {}): Promise<number> {
  const findings = await checkPlugin(context, options)
  if (context.json) {
    context.io.stdout(`${JSON.stringify({ command: "check", ok: !hasError(findings), findings }, null, 2)}\n`)
    return hasError(findings) ? 1 : 0
  }
  print(context, findings, hasError(findings) ? "check: failed" : "check: ok")
  return hasError(findings) ? 1 : 0
}
