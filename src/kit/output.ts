/**
 * The kit's output: one line per finding, then a summary. `--json` prints one object instead, and findings never go to
 * stdout in that mode.
 */
import type { CommandContext, Finding } from "./types.ts"
import { hasError, sortFindings } from "./types.ts"

/** One finding, in the form a CI log reads. */
export function printFinding(context: CommandContext, finding: Finding): void {
  const where = finding.path === undefined ? "" : ` ${finding.path}`
  context.io.stderr(`${finding.level.toUpperCase()} ${finding.id}${where}: ${finding.message}${finding.fix === undefined ? "" : ` ${finding.fix}`}\n`)
}

/** Print findings, then a summary line. JSON mode prints one object instead. */
export function print(context: CommandContext, findings: readonly Finding[], summary: string): void {
  if (context.json) {
    context.io.stdout(`${JSON.stringify({ findings: sortFindings(findings), ok: !hasError(findings) }, null, 2)}\n`)
    return
  }
  for (const finding of sortFindings(findings)) printFinding(context, finding)
  const errors = findings.filter((finding) => finding.level === "error").length
  const warnings = findings.filter((finding) => finding.level === "warning").length
  context.io.stdout(`${summary}${findings.length === 0 ? "" : ` (${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"})`}\n`)
}
