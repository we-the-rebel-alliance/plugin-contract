/**
 * A stand-in for `src/conformance.ts`: the kit must work against the shared interface before the real module lands, and
 * must never re-implement a check. A case records what the kit asked for and answers with findings it chose.
 */
import type { ConformanceOptions, ConformanceReport, ConformanceRunner, Finding } from "../../src/kit/types.ts"

export interface FakeConformance extends ConformanceRunner {
  readonly calls: { readonly run: { dir: string; options: ConformanceOptions | undefined }[]; readonly t0: string[]; readonly t1: { dir: string; host: string }[] }
  reports: ConformanceReport
}

/** A runner with the given calls and findings. */
export function fakeConformance(options: { readonly report?: ConformanceReport; readonly t0?: readonly Finding[]; readonly t1?: (host: string) => readonly Finding[] } = {}): FakeConformance {
  const calls = { run: [] as { dir: string; options: ConformanceOptions | undefined }[], t0: [] as string[], t1: [] as { dir: string; host: string }[] }
  const fake: FakeConformance = {
    calls,
    reports: options.report ?? { ok: true, findings: [] },
    async runConformance(dir, callOptions) {
      calls.run.push({ dir, options: callOptions })
      return fake.reports
    },
    async t0(dir) {
      calls.t0.push(dir)
      return [...(options.t0 ?? [])]
    },
    async t1(dir, host) {
      calls.t1.push({ dir, host })
      return [...(options.t1?.(host) ?? [])]
    },
  }
  return fake
}

/** A finding, with its defaults filled in. */
export function finding(over: Partial<Finding> & Pick<Finding, "id">): Finding {
  return { level: "error", message: "a finding", ...over }
}
