/**
 * The one place the kit reaches the conformance module.
 *
 * The import is lazy and structural: the kit compiles and its own tests run with a fake runner, and a module that does
 * not publish `runConformance`, `t0` and `t1` is one clear error rather than a missing gate. The kit never re-implements
 * a check and never imports a check's internals.
 */
import { KitError, type CommandContext, type ConformanceRunner } from "./types.ts"
import { printFinding } from "./output.ts"

/** The functions `src/conformance.ts` publishes. */
const REQUIRED = ["runConformance", "t0", "t1"] as const

/** Load the conformance module, or explain which function the installed plugin-contract lacks. */
export async function loadConformance(importModule: () => Promise<unknown> = () => import("../conformance.ts")): Promise<ConformanceRunner> {
  const module = await importModule()
  const runner = (typeof module === "object" && module !== null ? module : {}) as Record<string, unknown>
  const missing = REQUIRED.filter((name) => typeof runner[name] !== "function")
  if (missing.length > 0) {
    throw new KitError(
      "KIT_CONFORMANCE",
      `the installed plugin-contract publishes no ${missing.join(", ")} in its conformance module`,
      "install the plugin-contract version this plugin declares (v0.0.0 or later), which publishes runConformance, t0 and t1",
    )
  }
  return module as ConformanceRunner
}

/** `plugin-kit conformance`: run every check the conformance module has, and print its report. */
export async function runConformance(
  context: CommandContext,
  options: { readonly hosts?: string[] | undefined; readonly record?: boolean | undefined } = {},
): Promise<number> {
  const runner = await context.conformance()
  const report = await runner.runConformance(context.dir, {
    ...(options.hosts === undefined || options.hosts.length === 0 ? {} : { hosts: options.hosts }),
    ...(options.record === true ? { record: true } : {}),
  })
  if (context.json) {
    context.io.stdout(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    for (const finding of report.findings) printFinding(context, finding)
    context.io.stdout(`conformance: ${report.ok ? "ok" : "failed"} (${report.findings.length} finding${report.findings.length === 1 ? "" : "s"})\n`)
  }
  return report.ok ? 0 : 1
}
