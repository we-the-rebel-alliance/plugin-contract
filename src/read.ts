/**
 * `read`: the consumer-side call (design §3). Every project reads a source the same way, with no host required:
 *
 * 1. the manifest comes from the installed package (`readInstalledManifest`), and the grant must be for the same
 *    manifest hash, consumer source, account and scope;
 * 2. `since` and `pick` are resolved and checked before anything is called;
 * 3. the call runs in a session fenced by exactly the grant's rules (`sessionRules`), opened and closed by the host;
 * 4. the answer is checked: its account, `trust: "untrusted"`, its size against `maxBytes`, and a snapshot's `data`
 *    against its output schema; then `pick` keeps only the picked paths.
 *
 * The host is two calls: open a session with given rules, and call a plugin's tools-RPC method in it. Each app
 * implements them over its own OpenCode server. An app keeps its own cursor: `read` returns the page and never stores
 * anything.
 */
import { findMethod, findSource, maxBytesOf, type InstalledManifest, type OwnerOrg, type SourceItem } from "./manifest.ts"
import { canonicalScope } from "./cursor.ts"
import type { Checked } from "./internal/checked.ts"
import { PAGE, probeResultProblems, resultProblems } from "./internal/events.ts"
import { failure, failureFromError, type ReadFailure } from "./internal/failure.ts"
import { resolveSince, type ParamsContext } from "./params.ts"
import { detailRules, grantCovers, namespaceOf, probeRules, sessionRules, type Grant, type PermissionRule } from "./permission.ts"
import { pick, pickProblemsForOutput } from "./pick.ts"
import { checkOutput, isOutputName } from "./outputs.ts"

export type { FailureCode, ReadFailure } from "./internal/failure.ts"

/** What a project's host does for `read`. */
export interface ReadHost {
  /** Opens a session whose rules are exactly `rules`, for one read; `close` ends it. */
  openSession(request: { readonly rules: readonly PermissionRule[]; readonly title: string }): Promise<{ readonly sessionID: string; close(): Promise<void> }>
  /**
   * Calls a plugin's method in that session: `POST /api/rpc/<plugin id>/<method>` with `{ sessionID, input }`. The
   * host maps the package to its plugin id, from its own record of installed plugins.
   */
  call(request: {
    readonly package: string
    readonly method: string
    readonly sessionID: string
    readonly input: Readonly<Record<string, unknown>>
    readonly signal?: AbortSignal
  }): Promise<unknown>
}

/** One read of a source. */
export interface ReadRequest {
  readonly installed: InstalledManifest
  readonly source: string
  readonly grant: Grant
  /** The consumer reading; must be the grant's. */
  readonly consumer: string
  /** Narrower than the grant's scope, or the grant's when absent. */
  readonly scope?: Readonly<Record<string, readonly string[]>>
  /** An events read. */
  readonly cursor?: string
  readonly since?: string
  readonly limit?: number
  /** Ask for each event's `thumbnail` (#42). Only a source that declares `thumbnails` accepts it. */
  readonly thumbnails?: true
  /** A snapshot read. */
  readonly pick?: readonly string[]
  readonly context: ParamsContext
  readonly signal?: AbortSignal
}

/** An events page, as the plugin answered it (design §2.1). */
export interface EventsPage {
  readonly source: string
  readonly account: string
  readonly owner: { readonly id: string; readonly label?: string }
  readonly events: readonly Readonly<Record<string, unknown>>[]
  readonly cursor: string
  readonly more: boolean
  readonly trust: "untrusted"
  readonly refused?: readonly unknown[]
  readonly failed?: readonly unknown[]
  readonly gap?: { readonly reason: string; readonly since: string }
  readonly cost?: unknown
  readonly [key: string]: unknown
}

/** A snapshot, as the plugin answered it, after `pick`. */
export interface Snapshot {
  readonly data: Readonly<Record<string, unknown>>
  readonly asOf: string
  readonly cost?: unknown
  readonly trust: "untrusted"
}

export type ReadOutcome =
  | { readonly ok: true; readonly kind: "events"; readonly page: EventsPage }
  | { readonly ok: true; readonly kind: "snapshot"; readonly snapshot: Snapshot }
  | { readonly ok: false; readonly failure: ReadFailure }

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const refused = (code: Parameters<typeof failure>[0], what: string, next: string): ReadOutcome => ({ ok: false, failure: failure(code, what, next) })
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

/**
 * The checks before any call, whoever makes it: the source is declared, the person has not turned it off, the grant is
 * this consumer's for the manifest as installed, the scope is within the grant, the inputs suit the source's kind,
 * and `pick` names paths of its output. The source and the scope to read when they pass.
 */
export function checkReadRequest(request: ReadRequest): { readonly source: SourceItem; readonly scope?: Readonly<Record<string, readonly string[]>> } | ReadOutcome {
  const { installed, grant } = request
  const source = findSource(installed.manifest, request.source)
  if (!source) return refused("UNAVAILABLE", `${installed.package} ${installed.version} declares no source ${request.source}`, "Check the source id against the installed plugin's manifest.")
  if (grant.disabled) return refused("SOURCE_DISABLED", `${source.id} is turned off for ${grant.consumer}`, "Turn the source on again to read it.")
  if (grant.consumer !== request.consumer) return refused("PERMISSION_DENIED", `the grant is ${grant.consumer}'s, not ${request.consumer}'s`, "Ask the person to grant this consumer the source.")
  if (grant.manifestHash !== installed.hash) {
    return refused("PERMISSION_DENIED", `${source.id}'s manifest changed since the person consented`, "Ask the person to review the source and consent again.")
  }
  const asked = request.scope ?? grant.scope
  if (!grantCovers(grant, { source: source.id, account: grant.account, ...(asked === undefined ? {} : { scope: asked }) })) {
    return refused("PERMISSION_DENIED", `the read asks for more of ${source.id} than the person granted`, "Read within the granted scope, or ask the person to widen it.")
  }
  // One canonical form (keys and values sorted, no repeats), so a cursor's binding and a cache key agree (#7, D12).
  const scope = asked === undefined ? undefined : (canonicalScope(asked) as Record<string, string[]>)
  if (source.kind === "events") {
    if (request.pick !== undefined) return refused("SCHEMA_VIOLATION", "pick is for a snapshot source", "Pass cursor, since and limit to an events source.")
    if (request.thumbnails === true && source.thumbnails !== true) {
      return refused("SCHEMA_VIOLATION", `${source.id} does not declare thumbnails`, "Ask for thumbnails only from a source that declares them.")
    }
  } else {
    if (request.cursor !== undefined || request.since !== undefined || request.limit !== undefined || request.thumbnails !== undefined) {
      return refused("SCHEMA_VIOLATION", "cursor, since, limit and thumbnails are for an events source", "Pass pick to a snapshot source.")
    }
    if (request.pick !== undefined) {
      const problems = isOutputName(source.output) ? pickProblemsForOutput(source.output, request.pick) : []
      if (problems.length > 0) return refused("SCHEMA_VIOLATION", problems.join("; "), "Pick only paths of the source's output schema.")
    }
  }
  return { source, ...(scope === undefined ? {} : { scope }) }
}

/** `checkReadRequest`, then the method's input: `since` resolved, and the account and scope the grant names. */
function prepare(request: ReadRequest): { source: SourceItem; input: Record<string, unknown> } | ReadOutcome {
  const checked = checkReadRequest(request)
  if ("ok" in checked) return checked
  const { source, scope } = checked
  const input: Record<string, unknown> = { ...(source.input ?? {}), account: request.grant.account }
  if (scope !== undefined) input["scope"] = scope
  if (source.kind === "events") {
    if (request.since !== undefined) {
      const since = resolveSince(request.since, request.context)
      if (!since.ok) return refused("SCHEMA_VIOLATION", since.problems.join("; "), "Pass since as a relative time such as -7d, or an ISO date-time.")
      input["since"] = since.value
    }
    if (request.cursor !== undefined) input["cursor"] = request.cursor
    if (request.limit !== undefined) input["limit"] = request.limit
    if (request.thumbnails === true) input["thumbnails"] = true
    return { source, input }
  }
  return { source, input }
}

/** The answer's problems against the contract, as a failure; undefined when it keeps it. */
function checkAnswer(source: SourceItem, account: string, answer: unknown): ReadFailure | undefined {
  const size = bytes(answer)
  if (size > maxBytesOf(source)) return failure("TOO_LARGE", `${source.id} answered ${size} bytes, over its ${maxBytesOf(source)}`, "Read a smaller window or fewer items.")
  if (!plain(answer)) return failure("SCHEMA_VIOLATION", `${source.id} answered something that is not an object`, "Report it to the plugin's maintainers.")
  if (answer["trust"] !== "untrusted") return failure("SCHEMA_VIOLATION", `${source.id}'s answer is not marked trust: "untrusted"`, "Report it to the plugin's maintainers.")
  if (answer["account"] !== undefined && answer["account"] !== account) {
    return failure("ACCOUNT_MISMATCH", `${source.id} answered for another account than the one granted`, "Sign the plugin in to the granted account, or ask the person to grant this one.")
  }
  return undefined
}

/** Runs one call in a fenced session, and always closes the session. */
async function fencedCall(host: ReadHost, rules: Checked<readonly PermissionRule[]>, call: Omit<Parameters<ReadHost["call"]>[0], "sessionID">, title: string): Promise<{ ok: true; answer: unknown } | { ok: false; failure: ReadFailure }> {
  if (!rules.ok) return { ok: false, failure: failure("PERMISSION_DENIED", rules.problems.join("; "), "Fix the source's declaration or the grant.") }
  let session: Awaited<ReturnType<ReadHost["openSession"]>> | undefined
  try {
    session = await host.openSession({ rules: rules.value, title })
    return { ok: true, answer: await host.call({ ...call, sessionID: session.sessionID }) }
  } catch (error) {
    return { ok: false, failure: failureFromError(error) }
  } finally {
    await session?.close().catch(() => undefined)
  }
}

/** Reads a source under a grant, in a session fenced by the grant's rules. Never throws for a refused or failed read. */
export async function read(host: ReadHost, request: ReadRequest): Promise<ReadOutcome> {
  const prepared = prepare(request)
  if ("ok" in prepared) return prepared
  const { source, input } = prepared
  const called = await fencedCall(
    host,
    sessionRules(source, request.grant),
    { package: request.installed.package, method: source.method, input, ...(request.signal ? { signal: request.signal } : {}) },
    `${request.consumer} reads ${source.id}`,
  )
  if (!called.ok) return { ok: false, failure: called.failure }
  return acceptAnswer(source, request.grant.account, called.answer, {
    ...(request.limit === undefined ? {} : { limit: request.limit }),
    ...(request.pick === undefined ? {} : { pick: request.pick }),
    ...(request.thumbnails === undefined ? {} : { thumbnails: request.thumbnails }),
  })
}

/**
 * A source's answer, checked as the contract says and picked: the account, `trust: "untrusted"`, the size against
 * `maxBytes`, an events page's shape or a snapshot's output, then `pick`. The same checks whoever made the call: `read`
 * embedded, or a host's broker (`broker-client`), so a broker never needs to be trusted for shape.
 */
export function acceptAnswer(source: SourceItem, account: string, answer: unknown, options: { readonly limit?: number; readonly pick?: readonly string[]; readonly thumbnails?: true } = {}): ReadOutcome {
  const problem = checkAnswer(source, account, answer)
  if (problem) return { ok: false, failure: problem }
  const value = answer as Record<string, unknown>
  if (source.kind === "events") {
    // The page against the events contract with §2.1's additions, under the source's maxBytes (checked above), and the
    // limit the read asked for.
    const problems = resultProblems(value, options.limit ?? PAGE.max, maxBytesOf(source), {
      ...(options.thumbnails === true ? { thumbnails: true } : {}),
      ...(source.urlHosts === undefined ? {} : { urlHosts: source.urlHosts }),
    })
    if (problems.length > 0) {
      return { ok: false, failure: failure("SCHEMA_VIOLATION", `${source.id}'s page breaks the events contract: ${problems.slice(0, 3).join("; ")}`, "Report it to the plugin's maintainers.") }
    }
    return { ok: true, kind: "events", page: value as EventsPage }
  }
  if (isOutputName(source.output)) {
    const checked = checkOutput(source.output, value["data"])
    if (!checked.ok) return { ok: false, failure: failure("SCHEMA_VIOLATION", `${source.id}'s data breaks the ${source.output} schema: ${checked.problems.slice(0, 3).join("; ")}`, "Report it to the plugin's maintainers.") }
  }
  if (typeof value["asOf"] !== "string" || !Number.isFinite(Date.parse(value["asOf"]))) {
    return { ok: false, failure: failure("SCHEMA_VIOLATION", `${source.id}'s snapshot has no asOf time`, "Report it to the plugin's maintainers.") }
  }
  let picked = value["data"] as Record<string, unknown>
  if (options.pick !== undefined) {
    const kept = pick(picked, options.pick)
    picked = kept.ok ? kept.data : {}
  }
  return {
    ok: true,
    kind: "snapshot",
    snapshot: { data: picked, asOf: value["asOf"], ...(value["cost"] === undefined ? {} : { cost: value["cost"] }), trust: "untrusted" },
  }
}

/** A detail read of one event (design §2.2 `details`). */
export interface DetailRequest {
  readonly installed: InstalledManifest
  readonly source: string
  readonly detail: string
  readonly grant: Grant
  readonly consumer: string
  /** The event the detail is read for, as the source listed it. Inputs come only from its API fields. */
  readonly event: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
}

/**
 * The detail's `fields`: exactly the event fields its `from` names, taken from the event as the source listed it, and
 * nothing else. An event's `title` and `text` are never among them, so item text cannot choose what is read next.
 */
export function detailFields(source: SourceItem, detailId: string, event: Readonly<Record<string, unknown>>): Checked<Record<string, unknown>> {
  const detail = source.details?.find((entry) => entry.id === detailId)
  if (!detail) return { ok: false, problems: [`${source.id} declares no detail read ${detailId}`] }
  const fields: Record<string, unknown> = {}
  const problems: string[] = []
  for (const field of detail.from) {
    if (event[field] === undefined || event[field] === null) problems.push(`the event has no ${field} for ${detailId}`)
    else fields[field] = event[field]
  }
  return problems.length === 0 ? { ok: true, value: fields } : { ok: false, problems }
}

/**
 * Reads a declared detail of one event, in a session fenced by the source's rules and the detail's method. The call
 * is `{ account, scope, fields }`, with the confirmed scope, so the plugin refuses an event outside it.
 */
export async function readDetail(host: ReadHost, request: DetailRequest): Promise<{ readonly ok: true; readonly answer: unknown } | { readonly ok: false; readonly failure: ReadFailure }> {
  const { installed, grant } = request
  const source = findSource(installed.manifest, request.source)
  if (!source) return { ok: false, failure: failure("UNAVAILABLE", `${installed.package} declares no source ${request.source}`, "Check the source id.") }
  if (grant.disabled) return { ok: false, failure: failure("SOURCE_DISABLED", `${source.id} is turned off for ${grant.consumer}`, "Turn the source on again to read it.") }
  if (grant.consumer !== request.consumer || grant.manifestHash !== installed.hash) {
    return { ok: false, failure: failure("PERMISSION_DENIED", `the grant does not cover ${request.consumer}'s read of ${source.id} as installed`, "Ask the person to consent again.") }
  }
  if (request.event["account"] !== undefined && request.event["account"] !== grant.account) {
    return { ok: false, failure: failure("ACCOUNT_MISMATCH", "the event is another account's", "Read details only for events of the granted account.") }
  }
  const fields = detailFields(source, request.detail, request.event)
  if (!fields.ok) return { ok: false, failure: failure("SCHEMA_VIOLATION", fields.problems.join("; "), "Read details only for events the source listed.") }
  const detail = source.details!.find((entry) => entry.id === request.detail)!
  const scope = grant.scope === undefined ? {} : (canonicalScope(grant.scope) as Record<string, string[]>)
  const called = await fencedCall(
    host,
    detailRules(source, request.detail, grant),
    { package: installed.package, method: detail.method, input: { account: grant.account, scope, fields: fields.value }, ...(request.signal ? { signal: request.signal } : {}) },
    `${request.consumer} reads ${request.detail}`,
  )
  if (!called.ok) return called
  const problem = checkAnswer(source, grant.account, called.answer)
  return problem ? { ok: false, failure: problem } : { ok: true, answer: called.answer }
}

/** What `probe` answers: the signed-in owner and the scopes the provider sign-in holds. It reads no content. */
export interface ProbeAnswer {
  readonly source: string
  readonly account: string
  /**
   * The signed-in owner. `verified: false` marks an owner the provider does not confirm (#30, item 13), and `orgs`
   * carries the organizations the provider reports (#44 item 2), at most five.
   */
  readonly owner: { readonly id: string; readonly label: string; readonly verified?: false; readonly orgs?: readonly OwnerOrg[] }
  readonly scopes?: readonly string[]
  readonly cost?: unknown
  readonly trust: "untrusted"
}

/**
 * Probes a source for an account, in a session fenced by the plugin's `methods.probe` action and the identity
 * operations it declares, or the identity operations the caller passes. The source's own method action fences the
 * read; `probe` adds no content. The call is `probe` with `{ source?, account }`.
 */
export async function probe(host: ReadHost, request: { readonly installed: InstalledManifest; readonly source: string; readonly account: string; readonly identityOperations?: readonly string[]; readonly signal?: AbortSignal }): Promise<{ readonly ok: true; readonly answer: ProbeAnswer } | { readonly ok: false; readonly failure: ReadFailure }> {
  const source = findSource(request.installed.manifest, request.source)
  if (!source) return { ok: false, failure: failure("UNAVAILABLE", `${request.installed.package} declares no source ${request.source}`, "Check the source id.") }
  const method = findMethod(request.installed.manifest, "probe")
  if (method === undefined) return { ok: false, failure: failure("PERMISSION_DENIED", `${request.installed.package} declares no probe method`, "Declare probe in the manifest's methods.") }
  const identity = request.identityOperations ?? method.operations ?? []
  const name = typeof source.input?.["source"] === "string" ? { source: source.input["source"] } : {}
  const called = await fencedCall(
    host,
    probeRules(source, request.account, identity, `${namespaceOf(source)}.probe`),
    { package: request.installed.package, method: "probe", input: { ...name, account: request.account }, ...(request.signal ? { signal: request.signal } : {}) },
    `probe ${source.id}`,
  )
  if (!called.ok) return called
  const answer = called.answer
  if (plain(answer) && answer["owner"] === null) {
    return { ok: false, failure: failure("NEEDS_SIGN_IN", `${source.id} is not signed in`, "Sign the plugin in to the account you mean. A probe refuses with NEEDS_SIGN_IN; it never answers owner: null.") }
  }
  if (plain(answer) && typeof answer["account"] === "string" && answer["account"] !== request.account) return { ok: false, failure: failure("ACCOUNT_MISMATCH", `${source.id} is signed in to another account`, "Sign the plugin in to the account you mean.") }
  const problems = probeResultProblems(answer, { ...(typeof source.input?.["source"] === "string" ? { source: source.input["source"] } : {}), account: request.account })
  if (problems.length > 0) {
    return { ok: false, failure: failure("SCHEMA_VIOLATION", `${source.id}'s probe answer is not the contract's: ${problems[0]}`, "Report it to the plugin's maintainers.") }
  }
  return { ok: true, answer: answer as unknown as ProbeAnswer }
}
