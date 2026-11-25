/**
 * What conformance says, and how it says it.
 *
 * Every finding has a stable id (`T0.namespace-length`, `T1.doors`, `manifest.class`), a level, one sentence, the path
 * it is about and a next step. A report is ok when no finding is an error; a warning names something the kit could
 * not prove, and `record: true` turns a missing recording into a warning while the fixture is being written.
 */

/** One thing conformance found. */
export interface Finding {
  /** A stable id: `T0.namespace-length`, `T1.permissions`, `manifest.class`. */
  readonly id: string
  readonly level: "error" | "warning"
  /** One sentence: what is wrong, in plain English. */
  readonly message: string
  /** The file or manifest path the finding is about. */
  readonly path?: string
  /** What to do next. */
  readonly fix?: string
}

/** The result of `runConformance`. */
export interface ConformanceReport {
  readonly ok: boolean
  readonly findings: Finding[]
}

/** One finding, with the optional fields left out when they are not given. */
export function finding(id: string, level: Finding["level"], message: string, options: { readonly path?: string | undefined; readonly fix?: string | undefined } = {}): Finding {
  return {
    id,
    level,
    message,
    ...(options.path === undefined ? {} : { path: options.path }),
    ...(options.fix === undefined ? {} : { fix: options.fix }),
  }
}

/** An error finding: the plugin does not conform. */
export const error = (id: string, message: string, options: { readonly path?: string | undefined; readonly fix?: string | undefined } = {}): Finding => finding(id, "error", message, options)

/** A warning: something the kit could not prove. */
export const warning = (id: string, message: string, options: { readonly path?: string | undefined; readonly fix?: string | undefined } = {}): Finding => finding(id, "warning", message, options)

/** A report is ok when no finding is an error. */
export function isOk(findings: readonly Finding[]): boolean {
  return findings.every((entry) => entry.level !== "error")
}
