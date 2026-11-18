import * as z from "zod"
/**
 * The conformance kit: one report per source, from a declaration and the plugin's own answers.
 *
 * The kit runs the plugin's reads itself, through a recording permission whose rules are the grants the declaration
 * derives. So a read that asserts more than the declaration holds is refused where the host would refuse it, and a
 * grant no read asserts is reported at the end: declared equals asserted. There are two such sessions, and they never
 * mix: the **running** session holds the source's own action and `permission.operations`, and the **bind** session holds
 * only `scope.suggest`'s tool and operations, because a bind-time read never enters a running grant.
 *
 * The kit takes page results, cursors and permission contexts as inputs. It defines no page, cursor or permission of its
 * own: those are the `events`, `cursor` and `permission` modules' work.
 *
 * The calls it makes, which a plugin's test adapts to its own tools:
 *
 *   list({ ...input }, context)                 → the page result of events_list
 *   probe({ source, account? }, context)        → { account, owner, scopes? }
 *   details[id]({ account, scope, fields })     → the page result of one detail read
 *   suggest({ source, account }, context)       → { options: [{ id, label? }] }, in the bind session
 *   snapshot({ params? }, context)              → the snapshot result, recorded for its grants only
 *
 * `context.permission.assert` is that session's permission: a read asserts the actions and operations it uses.
 */
import type { Detail, SourceItem } from "../schema/types.ts"
import { declarationProblems, type ToolDeclaration } from "./rules.ts"
import {
  assertionMatches,
  bindGrantsFor,
  grantsFor,
  probeIdentityGrants,
  recordingPermission,
  unusedGrants,
  type Assertion,
  type Grant,
  type SessionContext,
} from "./permission.ts"
import { removalProblems } from "../events.ts"
import { hintProblems, routineProblems } from "../../hints.ts"
import { sessionRules } from "../../permission.ts"
import { toolsRpcIdProblems } from "../../tools-rpc.ts"
import { pageChecks, type PageOptions } from "./page.ts"
import { probeProblems, probeSourceName } from "./probe.ts"
import { detailInput, detailInputProblems, scopeProblems, type DetailCallInput } from "./details.ts"
import { suggestProblems } from "./suggest.ts"

/** A case the source refuses, with the code or words its error carries. */
export interface Refusal {
  readonly refuses: string
}

/** What a case expects: a page, an empty page, an expired cursor, or a refusal. */
export type CaseExpectation = "page" | "empty" | "expired" | Refusal

/** One `events_list` call and what it must answer. */
export interface PageCase {
  /** The case's name, as a person reads it. */
  readonly name: string
  /** The call's input. */
  readonly input: Readonly<Record<string, unknown>>
  /** What the answer must be. `page` when absent. */
  readonly expect?: CaseExpectation | undefined
}

/** One detail read: the event it names, the scope it is pinned to, and what it must answer. */
export interface DetailCase {
  /** The detail's id, as the source declares it. */
  readonly id: string
  /** The confirmed scope the read is pinned to: a person's channels, calendars, labels. */
  readonly scope?: Readonly<Record<string, readonly string[]>> | undefined
  /** The event's values for the fields the detail names. Default: the kit's synthetic event. */
  readonly event?: Readonly<Record<string, unknown>> | undefined
  /** What the call must answer. Absent: an in-scope call, which must answer a page. A refusal: an event outside the scope. */
  readonly expect?: Refusal | undefined
}

/** The plugin's reads, as the kit calls them. */
export interface ConformanceCalls {
  readonly list?: ((input: Readonly<Record<string, unknown>>, context: SessionContext) => Promise<unknown>) | undefined
  readonly probe: (input: Readonly<Record<string, unknown>>, context: SessionContext) => Promise<unknown>
  readonly details?: Readonly<Record<string, (input: DetailCallInput, context: SessionContext) => Promise<unknown>>> | undefined
  readonly suggest?: ((input: Readonly<Record<string, unknown>>, context: SessionContext) => Promise<unknown>) | undefined
  /** A snapshot read: recorded for the grants it asserts. Its result's shape is not this kit's to check. */
  readonly snapshot?: ((input: Readonly<Record<string, unknown>>, context: SessionContext) => Promise<unknown>) | undefined
}

/** What `sourceConformance` checks. */
export interface SourceConformanceOptions {
  /** The plugin's package name, which every result names. */
  readonly plugin: string
  /** The source item, as the schema parsed it. */
  readonly source: SourceItem
  /** The plugin's declared tools, so every tool the source names can be checked. */
  readonly tools: readonly ToolDeclaration[]
  /** The plugin's reads. */
  readonly calls: ConformanceCalls
  /** The `events_list` calls and their expected answers. */
  readonly cases?: readonly PageCase[] | undefined
  /** The detail reads to run: at least one in scope, and one outside it when the source confirms scope keys. */
  readonly detailCases?: readonly DetailCase[] | undefined
  /** The `snapshot_read` calls, whose grants are recorded. */
  readonly snapshotCases?: readonly Readonly<Record<string, unknown>>[] | undefined
  /** The operations the probe may assert, beyond the source's own action. §2.2 does not name them, so the kit asks. */
  readonly identityOperations?: readonly string[] | undefined
  /** The account the kit hands a read; a display value, never a grant. */
  readonly account?: string | undefined
  /** The grants to run under. Default: the app's `permission.sessionRules`, so there is one derivation. */
  readonly grants?: readonly Grant[] | undefined
  /** The declaration's plugin-level keys: `sources.rpc` and `sources.probe.action` (#4, #8). */
  readonly sources?: { readonly rpc?: string | undefined; readonly probe?: { readonly action: string } | undefined } | undefined
  /** The plugin's `describe` answer, for the tools-RPC id diagnostic. */
  readonly describe?: { readonly id?: unknown } | undefined
  /**
   * Set when a page is fetched atomically: one provider call answers the whole page, so no single item can fail on its
   * own and `failed[]` can never be produced (Calendar's `events.list` is one). The `failed-holds-cursor` check is then
   * not applicable, and the reason is shown in the report. The reason must be non-empty; an empty one is ignored.
   */
  readonly atomicPages?: { readonly reason: string } | undefined
  /**
   * Set when the source's cursors never expire, so it cannot produce an expired one (X's ids never expire). The
   * `gap-and-cursor-expired` check is then not applicable, and the reason is shown in the report, as `atomicPages` does
   * for `failed-holds-cursor`. The reason must be non-empty; an empty one is ignored.
   */
  readonly noExpiry?: { readonly reason: string } | undefined
  /**
   * The actors the plugin knows are an agent, a bot or a service (#45 §1): each must carry a `kind` of one of those on
   * every page that lists it. The kit cannot tell a person from a bot itself, so the fixture says; without it the
   * `actor-kind` check does not apply.
   */
  readonly machineActors?: readonly string[] | undefined
  /**
   * A hint or routine file's text, from the plugin's own package, by the path its descriptor declares (#45 §4, §5):
   * `(path) => readFileSync(join(here, path), "utf8")`. Undefined when the package holds no such file. Without it, the
   * `hints` and `routines` checks cannot run, and a source that declares a file is not ok.
   */
  readonly files?: ((path: string) => string | undefined) | undefined
  /**
   * Every source id the plugin declares, for the own-source rule of a hint and a routine (#45 §4, §5). Default: the
   * source under test.
   */
  readonly ownSources?: readonly string[] | undefined
}

/** One named check: whether it ran, whether it applies at all, and what it found. */
export interface ConformanceCheck {
  readonly name: string
  readonly ran: boolean
  /** True when the check does not apply to this source, such as a page check on a snapshot. */
  readonly notApplicable: boolean
  /** Why the check does not apply, when the source states it: an atomic page's reason, for instance. */
  readonly reason?: string | undefined
  readonly problems: readonly string[]
}

/**
 * A source's report. `ok` is true only when every check ran or does not apply, and none found a problem.
 */
export interface ConformanceReport {
  readonly source: string
  readonly plugin: string
  /** The identity operations the kit was told a probe may assert, so a reader sees them. */
  readonly identityOperations: readonly string[]
  /** The plugin's probe action, when the declaration names one. */
  readonly probeAction?: string | undefined
  readonly checks: readonly ConformanceCheck[]
  readonly problems: readonly string[]
  readonly ok: boolean
  /** True when a check applies and did not run: the report says nothing about it, so it is not ok. */
  readonly incomplete: boolean
}

/** The code §2.3's table gives a read that reaches past what the person confirmed. */
const OUT_OF_SCOPE_CODE = "PERMISSION_DENIED"

/** Where a source restarts when it reports an expired cursor without a hint of its own. */
const RECOVERY_SINCE = "2026-01-01T00:00:00.000Z"

const CHECKS = [
  "declaration",
  "hints",
  "routines",
  "page-result",
  "failed-holds-cursor",
  "gap-and-cursor-expired",
  "gap-once-per-read",
  "refused-is-final",
  "removals-are-final",
  "actor-kind",
  "facts",
  "commitment-key",
  "parts-stable",
  "billed-cost",
  "identity-grants",
  "probe",
  "details",
  "suggest",
  "output-schema",
  "unused-grants",
] as const

/**
 * Run every conformance check for one source.
 *
 * `ok` requires every check to have run, or not to apply: a check that applies and did not run leaves the report
 * `incomplete` and not ok, so a source can never pass by having nothing to check.
 */
export async function sourceConformance(options: SourceConformanceOptions): Promise<ConformanceReport> {
  const { plugin, source, tools, calls } = options
  const cases = options.cases ?? []
  const account = options.account ?? "conformance"
  // Declared must equal asserted overall: an identity operation is one of the source's operations, so the running
  // session already holds it, and no content read may assert it unless the source declares permission.readsIdentity.
  const declaredIdentity = source.permission.identity
  const probeAction = options.sources?.probe?.action
  const identityOperations = declaredIdentity ?? options.identityOperations ?? []
  const declaredProbe = options.sources?.probe?.action
  const runningGrants = options.grants ?? [
    ...grantsFor(source, account),
    ...(declaredProbe === undefined ? [] : [{ action: declaredProbe, resource: "*" }]),
  ]
  const running = recordingPermission(runningGrants)
  const identityGrants = probeIdentityGrants(source, identityOperations, account)
  const identity: string[] = []
  const bind = recordingPermission(bindGrantsFor(source, account))
  const context: SessionContext = { account, permission: running.permission }
  const bindContext: SessionContext = { account, permission: bind.permission }
  const checks: ConformanceCheck[] = []
  const add = (name: string, problems: readonly string[], ran = true, notApplicable = false, reason?: string): void => {
    checks.push({ name, ran, notApplicable, ...(reason === undefined ? {} : { reason }), problems })
  }
  const isEvents = source.kind === "events"

  add("declaration", declarationProblems({ contractVersion: 1, items: [source] }, { tools }))

  // A hint and a routine are files the package ships beside the source (#45 §4, §5): each is read, checked and named
  // in the report. Without a reader, or without the file, the declaration names something nothing can prove.
  const ownSources = options.ownSources ?? [source.id]
  const readFile = options.files
  const fileCheck = (paths: readonly string[], kind: "hints" | "routines"): string[] => {
    const problems: string[] = []
    for (const path of paths) {
      const where = `${kind}("${path}")`
      if (readFile === undefined) {
        problems.push(`${where} is declared and the kit has no file reader: pass files, (path) => the file's text`)
        continue
      }
      const text = readFile(path)
      if (text === undefined) {
        problems.push(`${where} is declared and the package holds no such file`)
        continue
      }
      const found = kind === "hints" ? hintProblems(text, { sources: ownSources }) : routineProblems(text, { sources: ownSources })
      problems.push(...found.map((problem) => `${where}: ${problem}`))
    }
    return problems
  }
  const declaredHints = source.hints ?? []
  const declaredRoutines = source.routines ?? []
  add("hints", fileCheck(declaredHints, "hints"), declaredHints.length > 0, declaredHints.length === 0)
  add("routines", fileCheck(declaredRoutines, "routines"), declaredRoutines.length > 0, declaredRoutines.length === 0)

  const shape: string[] = []
  const cursor: string[] = []
  const gap: string[] = []
  const refused: string[] = []
  const cost: string[] = []
  let sawFailed = false
  let sawRefused = false
  const removals: string[] = []
  let sawRemovals = false
  let sawGap = false
  const gapOnce: string[] = []
  let sawAnyGap = false
  // The v0.3 additions (#45 §1, §3): what a fixture names, and what it holds across pages.
  const version = versionState(source, options.machineActors)
  const actorKind: string[] = []
  const facts: string[] = []
  const commitmentKey: string[] = []
  const partsStable: string[] = []

  if (cases.length > 0 && calls.list === undefined) shape.push("events_list cases are declared and the kit has no list call")

  for (const item of cases) {
    const where = `events_list(${item.name})`
    const expect = item.expect ?? "page"
    const assertedBeforePage = running.assertions.length
    let answer: unknown
    try {
      answer = await calls.list?.(item.input, context)
    } catch (error) {
      if (isRefusal(expect)) {
        if (!messageOf(error).includes(expect.refuses)) shape.push(`${where}: refused with "${messageOf(error)}", not the expected ${expect.refuses}`)
        continue
      }
      if (expect === "expired") {
        sawGap = true
        gap.push(...(await expiredByError(where, error, { source, plugin, calls, context, input: item.input })))
        continue
      }
      shape.push(`${where}: failed: ${messageOf(error)}`)
      continue
    }
    if (isRefusal(expect)) {
      shape.push(`${where}: it must be refused with ${expect.refuses}, and it answered`)
      continue
    }
    if (expect === "expired") {
      sawGap = true
      gap.push(...(await expiredByGap(where, answer, { source, plugin, calls, context, input: item.input })))
      if (hasGap(answer)) {
        sawAnyGap = true
        gapOnce.push(...(await gapAnsweredOnce(where, answer, { calls, context, input: item.input })))
      }
      continue
    }
    const page: PageOptions = { source, plugin, input: item.input }
    const result = pageChecks(answer, page)
    shape.push(...result.shape)
    cursor.push(...result.cursor)
    gap.push(...result.gap)
    refused.push(...result.refused)
    cost.push(...result.cost)
    identity.push(...identityOverlap(running.assertions.slice(assertedBeforePage), identityGrants, where, source.permission.readsIdentity === true))
    if (hasGap(answer)) {
      sawAnyGap = true
      gapOnce.push(...(await gapAnsweredOnce(where, answer, { calls, context, input: item.input })))
    }
    if (plain(answer) && answer["removals"] !== undefined) {
      sawRemovals = true
      removals.push(...removalProblems(answer).map((problem) => `${where}: ${problem}`))
    }
    // The v0.3 additions (#45): an actor's kind, a fact's declared type, a commitment's key and a part's text.
    const versionFound = versionProblems(answer, where, version)
    actorKind.push(...versionFound.actorKind)
    facts.push(...versionFound.facts)
    commitmentKey.push(...versionFound.commitmentKey)
    partsStable.push(...versionFound.partsStable)
    sawFailed ||= hasEntries(answer, "failed")
    sawRefused ||= hasEntries(answer, "refused")
    if (expect === "empty" && plain(answer) && Array.isArray(answer["events"]) && (answer["events"] as unknown[]).length > 0) {
      shape.push(`${where}: it must list nothing`)
    }
  }
  add("page-result", shape, isEvents && cases.length > 0, !isEvents)
  // A page fetched in one call can never have a per-item failure, so the source may say so; an empty reason is no
  // reason at all, and the check applies as it does by default.
  const atomicReason = options.atomicPages?.reason.trim() ?? ""
  const atomic = isEvents && atomicReason !== ""
  add("failed-holds-cursor", cursor, atomic ? false : isEvents && sawFailed, !isEvents || atomic, atomic ? atomicReason : undefined)
  // A source whose cursors never expire cannot produce one, so the check does not apply; an empty reason is no reason.
  const noExpiryReason = options.noExpiry?.reason.trim() ?? ""
  const noExpiry = isEvents && noExpiryReason !== ""
  add("gap-and-cursor-expired", gap, noExpiry ? false : isEvents && sawGap, !isEvents || noExpiry, noExpiry ? noExpiryReason : undefined)
  // A gap is answered once, on the page where the source restarts (#28): applies whenever an answer carries one.
  add("gap-once-per-read", gapOnce, isEvents && sawAnyGap, !isEvents || !sawAnyGap)
  add("refused-is-final", refused, isEvents && sawRefused, !isEvents)
  // A removal is final (#27): checked whenever an answer carries removals[]; a source that never removes has none.
  add("removals-are-final", removals, isEvents && sawRemovals, !isEvents || !sawRemovals)
  // (#45 §8) An actor the plugin knows is a machine carries its kind; a fact's type is declared; a commitment keeps one
  // key and a part one text across pages. Each applies only where there is something to check.
  for (const id of version.machine) {
    if (!version.seenMachine.has(id)) actorKind.push(`the fixture names ${id} as an agent, a bot or a service, and no page lists it`)
  }
  add("actor-kind", actorKind, isEvents && version.machine.size > 0, !isEvents || version.machine.size === 0)
  add("facts", facts, isEvents && version.sawFacts, !isEvents || !version.sawFacts)
  add("commitment-key", commitmentKey, isEvents && version.sawCommitment, !isEvents || !version.sawCommitment)
  add("parts-stable", partsStable, isEvents && version.sawParts, !isEvents || !version.sawParts)
  add("billed-cost", cost, source.cost.class === "billed" && isEvents, source.cost.class !== "billed")

  for (const operation of identityOperations) {
    if (!(source.permission.operations ?? []).includes(operation)) {
      identity.push(`${operation} is declared an identity operation and is not among permission.operations: a source's operations are everything its reads assert, identity included`)
    }
  }
  const probe: string[] = []
  const assertedBeforeProbe = running.assertions.length
  try {
    const answer = await calls.probe({ source: probeSourceName(source) ?? source.id, account }, context)
    probe.push(...probeProblems(answer, source, { account }))
  } catch (error) {
    probe.push(`probe(${source.id}) failed: ${messageOf(error)}`)
  }
  const probeAssertions = running.assertions.slice(assertedBeforeProbe)
  if (probeAssertions.length === 0) probe.push(`probe(${source.id}) asserted nothing: it reads the identity under its own grant`)
  const declared = probeAction !== undefined
  probe.push(...identityProblems(probeAssertions, source, identityGrants, declared ? probeAction : undefined))
  add("probe", probe)

  const details: string[] = []
  const declaredDetails = isEvents ? (source.details ?? []) : []
  const detailCases: readonly DetailCase[] = options.detailCases ?? declaredDetails.flatMap((detail) => (isEvents ? [{ id: detail.id }] : []))
  const scopeKeys = source.scope?.keys ?? []
  for (const detail of declaredDetails) {
    const read = calls.details?.[detail.id]
    if (read === undefined) {
      details.push(`details(${detail.id}) is declared and the kit has no call for it`)
      continue
    }
    const own = detailCases.filter((entry) => entry.id === detail.id)
    const inside = own.filter((entry) => entry.expect === undefined)
    const outside = own.filter((entry) => entry.expect !== undefined)
    for (const entry of own) await assertDetail(entry, detail, source, read, context, running, runningGrants, identityOperations, plugin, details)
    if (inside.length === 0) details.push(`details(${detail.id}) has no case inside the confirmed scope`)
    if (scopeKeys.length > 0 && outside.length === 0) {
      details.push(`details(${detail.id}) has no case outside the confirmed scope: a read pinned to a scope must refuse one that is not`)
    }
  }
  for (const entry of detailCases) {
    if (!declaredDetails.some((detail) => detail.id === entry.id)) details.push(`details(${entry.id}) is not declared by the source`)
  }
  add("details", details, declaredDetails.length > 0, declaredDetails.length === 0)

  const suggest: string[] = []
  const suggested = source.scope?.suggest
  if (suggested !== undefined) {
    const assertedBeforeSuggest = bind.assertions.length
    if (calls.suggest === undefined) suggest.push(`scope.suggest names "${suggested.tool}" and the kit has no call for it`)
    else {
      try {
        const answer = await calls.suggest({ source: source.id, account }, bindContext)
        suggest.push(...suggestProblems(answer, `scope.suggest(${suggested.tool})`))
      } catch (error) {
        suggest.push(`scope.suggest(${suggested.tool}) failed: ${messageOf(error)}`)
      }
      const suggestAssertions = bind.assertions.slice(assertedBeforeSuggest)
      if (suggestAssertions.length === 0) suggest.push(`scope.suggest(${suggested.tool}) asserted nothing: even at bind it reads under the grant`)
      suggest.push(...outsideGrants(suggestAssertions, bindGrantsFor(source, account), `scope.suggest(${suggested.tool})`))
      for (const grant of unusedGrants(bindGrantsFor(source, account), bind.assertions)) {
        suggest.push(`the bind declaration grants ${grant.action} on ${grant.resource}, which no bind-time read asserts: a suggest operation is exactly what it asserts`)
      }
    }
  }
  add("suggest", suggest, suggested !== undefined, suggested === undefined)

  const snapshot: string[] = []
  const outputSchema: string[] = []
  const extensionOutput = !isEvents && /^x-/.test(source.output)
  if (!isEvents) {
    const snapshotCases = options.snapshotCases ?? []
    if (calls.snapshot === undefined) snapshot.push("the source is a snapshot and the kit has no snapshot call, so its grants cannot be checked")
    else {
      for (const input of snapshotCases) {
        const assertedBeforeSnapshot = running.assertions.length
        try {
          const answer = await calls.snapshot(input, context)
          identity.push(...identityOverlap(running.assertions.slice(assertedBeforeSnapshot), identityGrants, `snapshot_read(${JSON.stringify(input)})`, source.permission.readsIdentity === true))
          if (extensionOutput) outputSchema.push(...snapshotDataProblems(answer, source))
        } catch (error) {
          snapshot.push(`snapshot_read(${JSON.stringify(input)}) failed: ${messageOf(error)}`)
        }
      }
      if (snapshotCases.length === 0) snapshot.push("the source is a snapshot and no snapshot case ran")
    }
  }

  add("identity-grants", identity)
  // An x- output has no registry schema: its inline outputSchema is what a snapshot's data must satisfy.
  add("output-schema", outputSchema, extensionOutput && snapshot.length === 0, !extensionOutput)
  const rpc = options.sources?.rpc
  add(
    "rpc-id",
    rpc === undefined ? [] : [...toolsRpcIdProblems(rpc, options.describe)],
    rpc !== undefined,
    rpc === undefined,
  )

  const unused = unusedGrants(runningGrants, running.assertions).map(
    (grant) => `the declaration grants ${grant.action} on ${grant.resource}, which no read asserts: a source's grants are exactly what it asserts`,
  )
  const unusedRan = isEvents ? cases.length > 0 : snapshot.length === 0
  add("unused-grants", [...unused, ...snapshot], unusedRan, false)

  if (running.undeclared.length > 0 || bind.undeclared.length > 0) {
    checks.push({
      name: "undeclared-grants",
      ran: true,
      notApplicable: false,
      problems: [...running.undeclared, ...bind.undeclared].map((action) => `${action} was asserted and is not among the grants the declaration derives`),
    })
  }

  const problems = checks.flatMap((check) => check.problems)
  const incomplete = checks.some((check) => !check.ran && !check.notApplicable)
  return {
    source: source.id,
    plugin,
    identityOperations,
    ...(probeAction === undefined ? {} : { probeAction }),
    checks,
    problems,
    ok: problems.length === 0 && !incomplete,
    incomplete,
  }
}

/** `sourceConformance`, for a test or a check: throws one error naming every problem. */
export function assertConformance(report: ConformanceReport): void {
  if (report.ok) return
  const failed = report.checks.filter((check) => check.problems.length > 0).length
  const missing = report.checks.filter((check) => !check.ran && !check.notApplicable).map((check) => check.name)
  const why = [
    ...(failed > 0 ? [`${failed} checks failed`] : []),
    ...(missing.length > 0 ? [`${missing.join(", ")} did not run`] : []),
  ].join(", and ")
  throw new Error(`CONFORMANCE_FAILED: the source ${report.source} of ${report.plugin} is not conformant: ${why}. Next step: fix each problem listed.\n- ${report.problems.join("\n- ")}`)
}

/**
 * One detail read. Inside the confirmed scope it must answer a page and assert only the source's grants; outside the
 * scope, which is the event the fixture names, it must be refused: a read pinned to what a person confirmed never reads
 * past it.
 */
async function assertDetail(
  entry: DetailCase,
  detail: Detail,
  source: SourceItem,
  read: (input: DetailCallInput, context: SessionContext) => Promise<unknown>,
  context: SessionContext,
  running: ReturnType<typeof recordingPermission>,
  runningGrants: readonly Grant[],
  identityOperations: readonly string[],
  plugin: string,
  problems: string[],
): Promise<void> {
  const where = `details(${detail.id})`
  const scope = entry.scope ?? {}
  problems.push(...scopeProblems(scope, source.scope, where))
  const input = detailInput(detail, source, {
    account: context.account,
    scope,
    ...(entry.event === undefined ? {} : { event: entry.event }),
  })
  if (entry.expect !== undefined) {
    // §2.3's table has one code for a read the person's grant does not cover: PERMISSION_DENIED.
    if (entry.expect.refuses !== OUT_OF_SCOPE_CODE) {
      problems.push(`${where} expects ${entry.expect.refuses} for an out-of-scope read, and §2.3's table names ${OUT_OF_SCOPE_CODE}`)
    }
    try {
      await read(input, context)
      problems.push(`${where} answered a call outside the confirmed scope: it must be refused with ${OUT_OF_SCOPE_CODE}: … Next step: …`)
    } catch (error) {
      const message = messageOf(error)
      if (!message.startsWith(`${OUT_OF_SCOPE_CODE}: `) || !message.includes("Next step: ")) {
        problems.push(`${where} refused an out-of-scope call with "${message}", not ${OUT_OF_SCOPE_CODE}: … Next step: …`)
      }
    }
    return
  }
  problems.push(...detailInputProblems(detail, input))
  const assertedBefore = running.assertions.length
  try {
    const answer = await read(input, context)
    const result = pageChecks(answer, { source, plugin, input: {}, detail: true })
    problems.push(...result.shape, ...result.cursor, ...result.gap, ...result.refused, ...result.cost)
  } catch (error) {
    problems.push(`${where} failed inside the confirmed scope: ${messageOf(error)}`)
  }
  problems.push(...outsideGrants(running.assertions.slice(assertedBefore), runningGrants, where))
  problems.push(...identityOverlap(running.assertions.slice(assertedBefore), probeIdentityGrants(source, identityOperations, context.account), where, source.permission.readsIdentity === true))
}

/** The word or code an error carries, for a refusal case. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

const isRefusal = (expect: CaseExpectation): expect is Refusal => typeof expect === "object" && expect !== null && "refuses" in expect
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const hasEntries = (answer: unknown, key: string): boolean => plain(answer) && Array.isArray(answer[key]) && (answer[key] as unknown[]).length > 0

const hasGap = (answer: unknown): answer is Record<string, unknown> => plain(answer) && answer["gap"] !== undefined

/**
 * A gap is answered once (#28): when a page carries `gap` and says `more: true`, the page its cursor names belongs to
 * the same read and must carry no `gap` at all, at either reason, since a consumer counts one resync per gap. A gap
 * page with `more: false` has no later page, so it passes. The next page must be recorded: without it the rule cannot
 * be shown to hold.
 */
async function gapAnsweredOnce(
  where: string,
  answer: Record<string, unknown>,
  options: { readonly calls: ConformanceCalls; readonly context: SessionContext; readonly input: Readonly<Record<string, unknown>> },
): Promise<string[]> {
  if (answer["more"] !== true) return []
  const cursor = answer["cursor"]
  if (typeof cursor !== "string" || cursor.length === 0) return [`${where}: the page carries gap and more: true, and no cursor to read the rest of the read with`]
  let next: unknown
  try {
    next = await options.calls.list?.({ ...options.input, cursor }, options.context)
  } catch (error) {
    return [`${where}: the page carries gap and more: true, so the page its cursor names must be recorded to show the gap is not repeated (${messageOf(error)})`]
  }
  if (hasGap(next)) return [`${where}: the read's second page repeats the gap, which a consumer counts as a second resync`]
  return []
}

/** An expired cursor answered with `gap`: the fresh cursor must read on, without another expiry. */
async function expiredByGap(
  where: string,
  answer: unknown,
  options: { readonly source: SourceItem; readonly plugin: string; readonly calls: ConformanceCalls; readonly context: SessionContext; readonly input: Readonly<Record<string, unknown>> },
): Promise<string[]> {
  if (!plain(answer) || !plain(answer["gap"]) || answer["gap"]["reason"] !== "expired") {
    return [`${where}: an expired cursor must answer gap.reason "expired", or throw CURSOR_EXPIRED`]
  }
  const cursor = answer["cursor"]
  if (typeof cursor !== "string" || cursor.length === 0) return [`${where}: an expired cursor must answer a cursor a consumer can restart from`]
  let next: unknown
  try {
    next = await options.calls.list?.({ ...options.input, cursor }, options.context)
  } catch (error) {
    return [`${where} after the restart: failed with ${messageOf(error)}`]
  }
  const checks = pageChecks(next, { source: options.source, plugin: options.plugin, input: { ...options.input, cursor } })
  const problems = [...checks.shape, ...checks.cursor]
  if (plain(next) && plain(next["gap"]) && next["gap"]["reason"] === "expired") {
    problems.push(`${where}: the cursor the expired page answered expired again, so the round trip does not restart`)
  }
  return problems.map((problem) => `${where} after the restart: ${problem}`)
}

/** An expired cursor answered with an error: it must be CURSOR_EXPIRED, and its backfill hint must read on. */
async function expiredByError(
  where: string,
  error: unknown,
  options: { readonly source: SourceItem; readonly plugin: string; readonly calls: ConformanceCalls; readonly context: SessionContext; readonly input: Readonly<Record<string, unknown>> },
): Promise<string[]> {
  const message = messageOf(error)
  if (!/^CURSOR_EXPIRED: /.test(message)) return [`${where}: failed with "${message}", not CURSOR_EXPIRED or a gap`]
  const since = String((error as { since?: unknown }).since ?? "")
  const hint = /(?:Z|[+-]\d{2}:\d{2})$/.test(since) && !Number.isNaN(Date.parse(since)) ? since : RECOVERY_SINCE
  let next: unknown
  try {
    next = await options.calls.list?.({ ...options.input, since: hint }, options.context)
  } catch (failed) {
    return [`${where} after the restart: failed with ${messageOf(failed)}`]
  }
  const checks = pageChecks(next, { source: options.source, plugin: options.plugin, input: { ...options.input, since: hint } })
  return [...checks.shape, ...checks.cursor].map((problem) => `${where} after the restart: ${problem}`)
}

/** Every assertion a read made that its own session does not grant. */
function outsideGrants(assertions: readonly Assertion[], grants: readonly Grant[], where: string): string[] {
  const problems: string[] = []
  for (const assertion of assertions) {
    const resources = assertion.resources.length > 0 ? assertion.resources : ["*"]
    for (const resource of resources) {
      const held = grants.some((grant) => assertionMatches([{ action: assertion.action, resources: [resource] }], grant))
      if (!held) problems.push(`${where} asserts ${assertion.action} on ${resource}, which the source does not grant: a read asserts only its own grant`)
    }
  }
  return problems
}

/**
 * A snapshot's `data` against the inline `outputSchema` of an `x-` output. The registry's names are checked by the app's
 * `registry`, so this runs only for an extension.
 */
function snapshotDataProblems(answer: unknown, source: SourceItem): string[] {
  if (source.kind !== "snapshot" || source.outputSchema === undefined) return ["the source is an x- output and states no outputSchema"]
  if (!plain(answer)) return ["snapshot_read answered nothing: an object with data and asOf"]
  const checked = z.fromJSONSchema(source.outputSchema as never).safeParse(answer["data"])
  if (checked.success) return []
  return checked.error.issues.map((issue) => `snapshot_read data at ${issue.path.length === 0 ? "the value" : issue.path.map(String).join(".")}: ${issue.message}`)
}

/** A content read may not assert an identity operation: those belong to the probe. A source may declare `readsIdentity`, and then its content reads may. */
function identityOverlap(assertions: readonly Assertion[], identityGrants: readonly Grant[], where: string, readsIdentity = false): string[] {
  if (readsIdentity) return []
  const problems: string[] = []
  for (const assertion of assertions) {
    const resources = assertion.resources.length > 0 ? assertion.resources : ["*"]
    for (const resource of resources) {
      if (identityGrants.some((grant) => assertionMatches([{ action: assertion.action, resources: [resource] }], grant))) {
        problems.push(`${where}: a content read asserts ${assertion.action} on ${resource}, which is an identity operation: identity reads belong to probe`)
      }
    }
  }
  return problems
}

/** A probe may assert the source's own action and its identity operations, and nothing else. */
function identityProblems(
  assertions: readonly Assertion[],
  source: SourceItem,
  identityGrants: readonly Grant[],
  probeAction?: string,
): string[] {
  const action = probeAction ?? (source.kind === "events" ? source.permission.events : source.permission.tool)
  // The identity grants: a rules source's identityRules verbatim, or its identity operations derived for the run's account (probeIdentityGrants).
  const allowed: Grant[] = [{ action, resource: "*" }, ...identityGrants]
  const problems: string[] = []
  for (const assertion of assertions) {
    const resources = assertion.resources.length > 0 ? assertion.resources : ["*"]
    for (const resource of resources) {
      if (!allowed.some((grant) => assertionMatches([{ action: assertion.action, resources: [resource] }], grant))) {
        problems.push(`probe(${source.id}) asserts ${assertion.action} on ${resource}, which is not an identity operation: a probe reads the account, never content`)
      }
    }
  }
  // Declared means exact: every grant the declaration names must be asserted, not only "nothing outside".
  for (const grant of allowed) {
    if (probeAction !== undefined && !assertionMatches(assertions, grant)) {
      problems.push(`probe(${source.id}) does not assert ${grant.action} on ${grant.resource}, which the declaration names`)
    }
  }
  return problems
}

/** What the v0.3 checks hold between pages (#45 §8): a commitment's key and a part's text are stable across pages. */
interface VersionState {
  /** The actor ids the fixture knows are an agent, a bot or a service. */
  readonly machine: ReadonlySet<string>
  /** Those of them a page has listed. */
  readonly seenMachine: Set<string>
  /** The fact types the descriptor declares. */
  readonly declaredFacts: ReadonlySet<string>
  /** A commitment key, and the title and owner it names. */
  readonly keys: Map<string, string>
  /** An event and a commitment's title and owner, and the key it was listed under. */
  readonly items: Map<string, string>
  /** An event and a part id, and the text and actor it was listed with. */
  readonly parts: Map<string, string>
  sawFacts: boolean
  sawCommitment: boolean
  sawParts: boolean
}

/** The state the v0.3 checks start from, for one source. */
function versionState(source: SourceItem, machineActors: readonly string[] | undefined): VersionState {
  return {
    machine: new Set(machineActors ?? []),
    seenMachine: new Set(),
    declaredFacts: new Set(source.kind === "events" ? (source.facts ?? []) : []),
    keys: new Map(),
    items: new Map(),
    parts: new Map(),
    sawFacts: false,
    sawCommitment: false,
    sawParts: false,
  }
}

/**
 * One page's v0.3 problems ({#45} §1, §3, §8), by concern: an actor the plugin knows is a machine carries its kind; a
 * fact's type is declared by the source; a commitment keeps one key, and the same item one key; a part's id keeps its
 * text. Each is remembered in `state`, so a later page is held to what an earlier one said.
 */
function versionProblems(answer: unknown, where: string, state: VersionState): { actorKind: string[]; facts: string[]; commitmentKey: string[]; partsStable: string[] } {
  const actorKind: string[] = []
  const facts: string[] = []
  const commitmentKey: string[] = []
  const partsStable: string[] = []
  if (!plain(answer) || !Array.isArray(answer["events"])) return { actorKind, facts, commitmentKey, partsStable }
  for (const event of answer["events"] as unknown[]) {
    if (!plain(event)) continue
    const id = typeof event["external_id"] === "string" ? event["external_id"] : ""
    if (Array.isArray(event["actors"])) {
      for (const actor of event["actors"]) {
        if (!plain(actor) || typeof actor["id"] !== "string" || !state.machine.has(actor["id"])) continue
        state.seenMachine.add(actor["id"])
        if (!MACHINE_KINDS.includes(String(actor["kind"]))) {
          actorKind.push(`${where}: the actor ${actor["id"]} is an agent, a bot or a service, and says no kind: an agent, a bot and a service each carry one`)
        }
      }
    }
    if (Array.isArray(event["facts"])) {
      for (const fact of event["facts"]) {
        if (!plain(fact)) continue
        state.sawFacts = true
        const type = String(fact["type"])
        if (!state.declaredFacts.has(type)) facts.push(`${where}: the event ${id} carries a ${type} fact, and the descriptor does not declare that type`)
        if (type !== "commitment") continue
        state.sawCommitment = true
        const key = fact["key"]
        const title = fact["title"]
        const owner = fact["owner"]
        if (typeof key !== "string" || typeof title !== "string" || typeof owner !== "string") continue
        const identity = `${title}\u0000${owner}`
        const named = state.keys.get(key)
        if (named !== undefined && named !== identity) commitmentKey.push(`${where}: the commitment key ${key} names another commitment (another title and owner) than on an earlier page`)
        else state.keys.set(key, identity)
        const item = `${id}\u0000${identity}`
        const before = state.items.get(item)
        if (before !== undefined && before !== key) commitmentKey.push(`${where}: the event ${id} lists one commitment (title ${title}, owner ${owner}) under two keys: a key is stable for one item`)
        else state.items.set(item, key)
      }
    }
    if (Array.isArray(event["parts"])) {
      for (const part of event["parts"]) {
        if (!plain(part) || typeof part["id"] !== "string" || typeof part["text"] !== "string") continue
        state.sawParts = true
        const at = `${id}\u0000${part["id"]}`
        const text = `${part["text"]}\u0000${typeof part["actor"] === "string" ? part["actor"] : ""}`
        const before = state.parts.get(at)
        if (before !== undefined && before !== text) partsStable.push(`${where}: the event ${id} re-lists the part ${part["id"]} with another text: a part's id and text never change once listed`)
        else state.parts.set(at, text)
      }
    }
  }
  return { actorKind, facts, commitmentKey, partsStable }
}

/** The actor kinds that make an actor an agent, a bot or a service (#45 §1). */
const MACHINE_KINDS: readonly string[] = ["agent", "bot", "service"]
