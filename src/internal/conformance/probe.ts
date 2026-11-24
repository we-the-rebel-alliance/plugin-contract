/**
 * `probe` (§2.3): the owner and the granted scopes, per source, so a Calendar-only sign-in works. It reads no content,
 * and it asserts only its own grant.
 *
 * One check, not three (#8, D230): this, `read.probe` and `events.probeResultProblems` all judge an answer by
 * `probeResultProblems`, so a probe passes in conformance only if a consumer's `read.probe` accepts it. The answer is
 * `{ source, account, owner: { id, label }, scopes?, cost?, trust: "untrusted" }` (D8). There is no `owner: null`: a
 * source that is not signed in refuses the probe with `NEEDS_SIGN_IN` and a `next`, and a local source names a
 * synthetic owner (history: `os-user:<user>@<host>`).
 */
import { probeResultProblems } from "../events.ts"
import type { SourceItem } from "../schema/types.ts"

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The name a plugin knows a source by in `probe`'s input and answer: the descriptor's `input.source`, when it has one. */
export function probeSourceName(source: Pick<SourceItem, "input">): string | undefined {
  const name = source.input?.["source"]
  return typeof name === "string" ? name : undefined
}

/** Every problem with a probe answer, one sentence each; `expected.account` is the account the probe was asked about. */
export function probeProblems(answer: unknown, source: SourceItem, expected: { readonly account?: string } = {}): string[] {
  const where = `probe(${source.id})`
  if (!plain(answer)) return [`${where} answered nothing: an object with source, account, owner and trust`]
  const name = probeSourceName(source)
  const problems = probeResultProblems(answer, { ...(name === undefined ? {} : { source: name }), ...(expected.account === undefined ? {} : { account: expected.account }) }).map((problem) => `${where}: ${problem}`)
  if (answer["owner"] === null) problems.push(`${where} must not answer owner: null: a source that is not signed in refuses with NEEDS_SIGN_IN and a next step, and a local source names a synthetic owner (os-user:<user>@<host>)`)
  return problems
}
