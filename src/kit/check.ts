/**
 * `plugin-kit check`: everything a pull request needs from the kit.
 *
 * T0 and T1 come from the conformance module, which owns every check (contract §16). The kit adds the two concerns that
 * are about a repository rather than a plugin's runtime: the generated docs are current, and no committed file carries
 * an app name, a `main` link or a secret. Typecheck, build, unit tests and pack stay the plugin's own commands, because
 * they are its build, not the contract's.
 */
import { docsFindings } from "./docs.ts"
import { forbiddenFindings } from "./forbidden.ts"
import { hostsOf, readPlugin } from "./plugin.ts"
import { print } from "./output.ts"
import type { CommandContext, Finding } from "./types.ts"
import { hasError, sortFindings } from "./types.ts"

/** Run T0, T1 for each host, the docs check and the forbidden scan; return every finding. */
export async function checkPlugin(context: CommandContext, options: { readonly hosts?: readonly string[] | undefined } = {}): Promise<Finding[]> {
  const plugin = readPlugin(context.dir)
  const hosts = options.hosts === undefined || options.hosts.length === 0 ? hostsOf(plugin) : [...options.hosts]
  const runner = await context.conformance()
  const findings: Finding[] = []
  findings.push(...(await attempt("T0", () => runner.t0(context.dir))))
  for (const host of hosts) findings.push(...(await attempt(`T1 ${host}`, () => runner.t1(context.dir, host))))
  findings.push(...docsFindings(context.dir, plugin.manifest))
  findings.push(...forbiddenFindings(context.dir))
  return sortFindings(findings)
}

/** One conformance call, as a finding when it throws: a missing host is a failure, not a skipped gate. */
async function attempt(gate: string, call: () => Promise<readonly Finding[]>): Promise<Finding[]> {
  try {
    return [...(await call())]
  } catch (error) {
    return [
      {
        id: "KIT_CONFORMANCE",
        level: "error",
        message: `${gate} did not run: ${error instanceof Error ? error.message : String(error)}`,
        fix: "fix the plugin or the installed plugin-contract, then run plugin-kit check again",
      },
    ]
  }
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
