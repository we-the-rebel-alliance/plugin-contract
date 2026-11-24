/**
 * The recorded-source checks (contract §7, §16): every answer a plugin's own test recorded, judged against the
 * manifest and the `events` module's authority.
 *
 * The kit does not call the provider and does not replay a call: a plugin records what its methods answered under
 * `fixtures/conformance.json`, and these checks read the recording. A page is checked against `resultProblems` (the
 * same call `read.acceptAnswer` makes), the source's `reads` and `maxBytes`, and the optional parts a page carries:
 * `failed` holds the cursor, `refused` is final, `removals` are final, `gap` is answered once, a billed source reports
 * its cost, and an event's `thumbnail` appears only when the read asked for it, on a declared host, outside the hash
 * (#42).
 *
 * A snapshot is checked against its output shape (the registry's, or an `x-` source's inline `outputSchema`); a probe
 * against `probeResultProblems`; a detail read only with the event fields it declares; a suggest answer against the
 * values a person may confirm.
 */
import { REFUSAL_REASONS, GAP_REASONS, PAGE, eventHash, isEventKindIn, removalProblems, secretKinds, sourceNamespace, type EventsListResult, type SourceEvent } from "./events.ts"
import { checkOutput } from "../outputs.ts"
import { acceptAnswer } from "../read.ts"
import { maxBytesOf, ownerProblems, thumbnailUrlProblems, type Detail, type SourceItem } from "../manifest.ts"
import { error, warning, type Finding } from "./conformance/report.ts"
import { thumbnailHostProblem } from "./conformance/url-hosts.ts"

/** One recorded `events_list` call: its input, what it was expected to answer, and the answer. */
export interface RecordedCase {
  readonly name?: string | undefined
  readonly input?: Readonly<Record<string, unknown>> | undefined
  /** `page`, `empty`, `expired`, or the code a refusal carries (or `{ refuses: "<code>: …" }`). Absent: page. */
  readonly expect?: unknown
  /** The refusal's message, when the case is refused. */
  readonly refuses?: string | undefined
  readonly answer?: unknown
}

/** What one events source records. */
export interface RecordedSource {
  readonly cases?: readonly RecordedCase[] | undefined
  readonly probe?: { readonly answer?: unknown } | undefined
  readonly details?: readonly RecordedDetail[] | undefined
  readonly suggest?: { readonly answer?: unknown } | undefined
  readonly snapshot?: { readonly answer?: unknown } | undefined
  readonly atomicPages?: { readonly reason?: unknown } | undefined
  readonly noExpiry?: { readonly reason?: unknown } | undefined
  readonly machineActors?: readonly string[] | undefined
}

/** One recorded detail read. */
export interface RecordedDetail {
  readonly id: string
  readonly scope?: Readonly<Record<string, readonly string[]>> | undefined
  readonly event?: Readonly<Record<string, unknown>> | undefined
  readonly expect?: unknown
  readonly refuses?: string | undefined
  readonly answer?: unknown
}

/** The name a page gives its source: the fixed `input.source`, or the source's id when it names none. */
export function pageSourceName(source: SourceItem): string {
  const named = source.input?.["source"]
  return typeof named === "string" ? named : source.id
}

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const line = (value: unknown): string => (value instanceof Error ? value.message.split("\n", 1)[0] ?? "" : String(value))
/** The code a recorded case expects: a string code, or `{ refuses: "<code>: …" }`. */
const codesOf = (expect: unknown): string | undefined => {
  if (typeof expect === "string" && !["page", "empty", "expired"].includes(expect)) return expect
  if (plain(expect) && typeof expect["refuses"] === "string") return expect["refuses"].split(":", 1)[0] ?? undefined
  return undefined
}
/** A recorded refusal reads `CODE: What happened. Next step: What to do.` */
function refusalFindings(item: RecordedCase, where: string): Finding[] {
  const findings: Finding[] = []
  const message = item.refuses
  if (typeof message !== "string") return findings
  const code = codesOf(item.expect) ?? (item.expect === "expired" ? "CURSOR_EXPIRED" : undefined)
  if (code !== undefined && !message.startsWith(`${code}: `)) findings.push(error("pages.refusal", `${where} refuses with "${message.slice(0, 120)}", and its case expects ${code}`, { path: "fixtures/conformance.json" }))
  if (!message.includes("Next step: ")) findings.push(error("pages.refusal", `${where}'s refusal has no "Next step: ", and every failure reads CODE: What happened. Next step: What to do.`, { path: "fixtures/conformance.json" }))
  return findings
}

/** Every finding for one events source's recorded cases. */
export function eventsFindings(options: {
  readonly plugin: string
  readonly source: Extract<SourceItem, { kind: "events" }>
  readonly recorded: RecordedSource
  readonly record?: boolean | undefined
}): Finding[] {
  const { plugin, source, recorded } = options
  const cases = recorded.cases ?? []
  const findings: Finding[] = []
  if (cases.length === 0) {
    findings.push(
      options.record === true
        ? warning("pages.recorded", `${source.id} has no recorded page, and the fixture is being recorded`, { path: "fixtures/conformance.json" })
        : error("pages.recorded", `${source.id} records no page, so nothing shows what its read answers`, {
            path: "fixtures/conformance.json",
            fix: "Record at least one page from a real account with plugin-kit record.",
          }),
    )
    return findings
  }
  const hashes = new Map<string, string>()
  let sawThumbnail = false
  for (const [index, item] of cases.entries()) {
    const where = `events_list(${item.name ?? `case ${index + 1}`})`
    const refusal = codesOf(item.expect)
    findings.push(...refusalFindings(item, where))
    if (item.answer === undefined) {
      if (refusal === undefined && item.expect !== "expired") findings.push(error("pages.answer", `${where} records no answer and no refusal code`, { path: "fixtures/conformance.json" }))
      if (item.expect === "expired" && item.refuses === undefined) findings.push(error("pages.answer", `${where} is an expired-cursor case with neither a gap nor a CURSOR_EXPIRED refusal`, { path: "fixtures/conformance.json" }))
      continue
    }
    if (refusal !== undefined) {
      findings.push(error("pages.answer", `${where} expects the refusal ${refusal} and records an answer`, { path: "fixtures/conformance.json" }))
      continue
    }
    const answer = item.answer
    const input = item.input ?? {}
    const asked = input["thumbnails"] === true
    if (asked && source.thumbnails !== true) {
      findings.push(error("pages.thumbnail", `${where} asks for thumbnails, and ${source.id} does not declare thumbnails`, { path: `capabilities.sources.${source.id}.thumbnails`, fix: "Declare thumbnails: true and urlHosts, or stop asking." }))
    }
    if (!asked && source.thumbnails === true) {
      // A source that declares thumbnails may still answer without them; what it may not do is answer one unasked.
      for (const event of eventsOf(answer)) {
        if (event["thumbnail"] !== undefined) findings.push(error("pages.thumbnail", `${where} answers a thumbnail although the read did not ask for one`, { path: "fixtures/conformance.json" }))
      }
    }
    const account = plain(answer) && typeof answer["account"] === "string" ? answer["account"] : "default"
    const limit = typeof input["limit"] === "number" && Number.isInteger(input["limit"]) ? input["limit"] : PAGE.max
    const accepted = acceptAnswer(source, account, answer, { limit, ...(asked ? { thumbnails: true as const } : {}) })
    if (!accepted.ok) {
      findings.push(error("pages.shape", `${where}: ${accepted.failure.message}`, { path: "fixtures/conformance.json", fix: "Fix the page the method answers, then record it again." }))
      continue
    }
    if (!plain(answer)) continue
    const page = answer as unknown as EventsListResult
    const requestedAccount = typeof input["account"] === "string" ? input["account"] : undefined
    if (requestedAccount !== undefined && page.account !== requestedAccount) findings.push(error("pages.account", `${where} was read for ${requestedAccount} and names ${page.account}`, { path: "fixtures/conformance.json" }))
    if (page.plugin !== undefined && page.plugin !== plugin) findings.push(error("pages.plugin", `${where} names the plugin ${page.plugin}, not ${plugin}`, { path: "fixtures/conformance.json" }))
    if (typeof source.input?.["source"] === "string" && page.source !== pageSourceName(source)) {
      findings.push(error("pages.source", `${where} names the source ${page.source}, not ${pageSourceName(source)}`, { path: `capabilities.sources.${source.id}.input` }))
    }
    if (item.expect === "empty" && page.events.length > 0) findings.push(error("pages.answer", `${where} expects an empty page and lists ${page.events.length} events`, { path: "fixtures/conformance.json" }))
    if (item.expect === "expired" && page.gap?.reason !== "expired") findings.push(error("pages.gap", `${where} expects an expired cursor and answers no gap.reason "expired"`, { path: "fixtures/conformance.json" }))
    if (page.gap !== undefined) findings.push(...gapFindings(source, item, page, cases))
    if (Array.isArray(page.failed) && page.failed.length > 0) {
      const held = typeof input["cursor"] === "string" ? input["cursor"] : ""
      if (page.cursor !== held) findings.push(error("pages.cursor", `${where} carries failed[] and answers another cursor than the one it was read with`, { path: "fixtures/conformance.json", fix: "A failed entry holds the consumer's cursor back." }))
    }
    if (Array.isArray(page.refused)) {
      for (const [at, entry] of page.refused.entries()) {
        if (plain(entry) && !(REFUSAL_REASONS as readonly unknown[]).includes(entry["reason"])) findings.push(error("pages.refused", `${where} refused[${at}] names no reason of ${REFUSAL_REASONS.join(", ")}`, { path: "fixtures/conformance.json" }))
      }
    }
    findings.push(...removalProblems(page).map((problem) => error("pages.removals", `${where}: ${problem}`, { path: "fixtures/conformance.json" })))
    if (source.cost.class === "billed" && page.cost === undefined) findings.push(error("pages.cost", `${where} carries no cost, and ${source.id} is a billed source`, { path: "fixtures/conformance.json" }))
    for (const [at, event] of page.events.entries()) {
      if (typeof event.kind === "string" && !isEventKindIn(event.kind, sourceNamespace(source.id))) {
        findings.push(error("pages.kinds", `${where} events[${at}] is a ${event.kind}, outside the namespace ${sourceNamespace(source.id)}`, { path: `capabilities.sources.${source.id}.reads` }))
      }
      const kinds = secretKinds([event.title, event.text].filter(Boolean).join("\n"))
      if (kinds.length > 0) findings.push(error("pages.secrets", `${where} events[${at}] holds a secret (${kinds.join(", ")}): it belongs in refused[] with reason "secret"`, { path: "fixtures/conformance.json" }))
      const before = hashes.get(`${event.account}\u0000${event.external_id}`)
      if (before !== undefined && before !== event.hash) findings.push(error("pages.hash", `${where} lists ${event.external_id} with another hash than an earlier page`, { path: "fixtures/conformance.json" }))
      else hashes.set(`${event.account}\u0000${event.external_id}`, event.hash)
      if (event.thumbnail !== undefined) {
        sawThumbnail = true
        findings.push(...thumbnailFindings(where, event as unknown as SourceEvent, source))
      }
    }
  }
  if (source.thumbnails === true && !sawThumbnail) {
    findings.push(warning("pages.thumbnail", `${source.id} declares thumbnails, and no recorded page carries one`, { path: "fixtures/conformance.json", fix: "Record one page with thumbnails: true, or stop declaring them." }))
  }
  return findings
}

/** A gap is answered once per read: the page its cursor names, when recorded, carries none. */
function gapFindings(source: SourceItem, item: RecordedCase, page: EventsListResult, cases: readonly RecordedCase[]): Finding[] {
  const findings: Finding[] = []
  if (page.gap !== undefined && !(GAP_REASONS as readonly unknown[]).includes(page.gap.reason)) {
    findings.push(error("pages.gap", `events_list(${item.name ?? "a case"}) carries a gap reason outside ${GAP_REASONS.join(", ")}`, { path: "fixtures/conformance.json" }))
  }
  if (page.gap === undefined || page.more !== true) return findings
  const next = cases.find((entry) => plain(entry.input) && entry.input["cursor"] === page.cursor)
  if (next === undefined) {
    findings.push(warning("pages.gap", `events_list(${item.name ?? "a case"}) carries a gap and more: true, and the page its cursor names is not recorded, so the gap is not shown answered once`, { path: "fixtures/conformance.json" }))
    return findings
  }
  if (plain(next.answer) && next.answer["gap"] !== undefined) findings.push(error("pages.gap", `events_list(${item.name ?? "a case"}) answers a gap, and the page its cursor names answers another`, { path: "fixtures/conformance.json", fix: "A consumer counts one resync per gap." }))
  return findings
}

/** #42: a thumbnail is https, at most 2048 characters, on a declared host, and outside the event's hash. */
function thumbnailFindings(where: string, event: SourceEvent, source: SourceItem): Finding[] {
  const findings: Finding[] = []
  for (const problem of thumbnailUrlProblems(event.thumbnail, source.urlHosts ?? [])) {
    findings.push(error("pages.thumbnail", `${where} ${event.external_id}'s thumbnail ${problem}`, { path: "fixtures/conformance.json" }))
  }
  if (typeof event.thumbnail === "string") {
    const unsafe = thumbnailHostProblem(event.thumbnail)
    if (unsafe !== null) findings.push(error("pages.thumbnail", `${where} ${event.external_id}'s thumbnail host ${unsafe}: a thumbnail is displayed only from a site the source can claim`, { path: "fixtures/conformance.json" }))
  }
  const { hash, ...rest } = event
  if (eventHash({ ...rest, thumbnail: "https://example.invalid/another.png" }) !== hash) {
    findings.push(error("pages.thumbnail", `${where} ${event.external_id}'s hash changes with its thumbnail: a thumbnail is outside the hash`, { path: "fixtures/conformance.json" }))
  }
  return findings
}

const eventsOf = (answer: unknown): Record<string, unknown>[] => (plain(answer) && Array.isArray(answer["events"]) ? (answer["events"] as unknown[]).filter(plain) : [])

/** A probe reads the account, never content: its answer names the account, its owner and its trust, and no content. */
export function probeFindings(source: SourceItem, answer: unknown, account?: string): Finding[] {
  if (!plain(answer)) return [error("probe.shape", `probe(${source.id}) records no answer`, { path: "fixtures/conformance.json" })]
  const findings: Finding[] = []
  const keys = ["source", "account", "owner", "scopes", "cost", "trust"]
  for (const key of Object.keys(answer)) if (!keys.includes(key)) findings.push(error("probe.shape", `probe(${source.id}) carries ${key}: a probe reads the account, never content`, { path: "fixtures/conformance.json" }))
  if (answer["source"] !== undefined && typeof source.input?.["source"] === "string" && answer["source"] !== pageSourceName(source)) findings.push(error("probe.shape", `probe(${source.id}) names the source ${String(answer["source"])}, not ${pageSourceName(source)}`, { path: "fixtures/conformance.json" }))
  if (typeof answer["account"] !== "string" || answer["account"].length === 0) findings.push(error("probe.shape", `probe(${source.id}) names no account`, { path: "fixtures/conformance.json" }))
  else if (account !== undefined && answer["account"] !== account) findings.push(error("probe.shape", `probe(${source.id}) names ${answer["account"]}, not the account it was asked about`, { path: "fixtures/conformance.json" }))
  findings.push(...ownerProblems(answer["owner"], `probe(${source.id}).owner`).map((problem) => error("probe.shape", problem, { path: "fixtures/conformance.json" })))
  if (plain(answer["owner"]) && typeof answer["owner"]["id"] === "string" && !/^[a-z][a-z0-9+.-]*:/.test(answer["owner"]["id"])) {
    findings.push(error("probe.shape", `probe(${source.id}).owner.id must be scheme-qualified, such as mailto:someone@example.com or slack:U0123`, { path: "fixtures/conformance.json" }))
  }
  if (answer["owner"] === null) findings.push(error("probe.shape", `probe(${source.id}) answers owner: null: an account that is not signed in refuses with NEEDS_SIGN_IN`, { path: "fixtures/conformance.json" }))
  if (answer["trust"] !== "untrusted") findings.push(error("probe.shape", `probe(${source.id}).trust must be "untrusted"`, { path: "fixtures/conformance.json" }))
  return findings
}

/** A detail read takes only the event fields it declares and answers a page for one event. */
export function detailFindings(source: SourceItem, recorded: readonly RecordedDetail[], account: string): Finding[] {
  const findings: Finding[] = []
  for (const item of recorded) {
    const detail = source.details?.find((entry) => entry.id === item.id)
    if (detail === undefined) {
      findings.push(error("details.declared", `the fixture records the detail ${item.id}, which ${source.id} does not declare`, { path: "fixtures/conformance.json" }))
      continue
    }
    const expected = codesOf(item.expect)
    if (item.refuses !== undefined) {
      const code = expected ?? "PERMISSION_DENIED"
      if (!item.refuses.startsWith(`${code}: `)) findings.push(error("details.refusal", `details(${item.id}) refuses with "${item.refuses.slice(0, 120)}", and its case expects ${code}`, { path: "fixtures/conformance.json" }))
      if (!item.refuses.includes("Next step: ")) findings.push(error("details.refusal", `details(${item.id})'s refusal has no "Next step: "`, { path: "fixtures/conformance.json" }))
    }
    if (item.answer === undefined) {
      if (expected === undefined) findings.push(error("details.answer", `details(${item.id}) records no answer and no refusal code`, { path: "fixtures/conformance.json" }))
      else if (item.refuses === undefined) findings.push(error("details.answer", `details(${item.id}) expects the refusal ${expected} and records no message`, { path: "fixtures/conformance.json" }))
      continue
    }
    if (expected !== undefined) {
      findings.push(error("details.answer", `details(${item.id}) expects the refusal ${expected} and records an answer`, { path: "fixtures/conformance.json" }))
      continue
    }
    findings.push(...detailInputFindings(detail, item))
    const answerAccount = plain(item.answer) && typeof item.answer["account"] === "string" ? item.answer["account"] : account
    const accepted = acceptAnswer(source, answerAccount, item.answer)
    if (!accepted.ok) findings.push(error("details.shape", `details(${item.id}): ${accepted.failure.message}`, { path: "fixtures/conformance.json" }))
  }
  return findings
}

/** The input a detail read may take: the fields it declares, and never an event's prose. */
function detailInputFindings(detail: Detail, item: RecordedDetail): Finding[] {
  const findings: Finding[] = []
  const event = item.event ?? {}
  for (const field of Object.keys(event)) {
    if (detail.from.includes(field as Detail["from"][number])) continue
    findings.push(error("details.input", `details(${detail.id}) records the event field ${field}, which its from does not name`, { path: "fixtures/conformance.json" }))
  }
  if (event["title"] !== undefined || event["text"] !== undefined) findings.push(error("details.input", `details(${detail.id}) records an event's title or text, and a detail's input comes only from identifiers`, { path: "fixtures/conformance.json" }))
  for (const field of detail.from) {
    if (event[field] === undefined) findings.push(error("details.input", `details(${detail.id}) records no ${field}, and the declared input needs it`, { path: "fixtures/conformance.json" }))
  }
  return findings
}

/** A suggest answer lists at most 64 values a person may confirm, each `{ id, label? }`, once. */
export function suggestFindings(source: SourceItem, answer: unknown): Finding[] {
  const where = `scope.suggest(${source.scope?.suggest?.method ?? "—"})`
  if (!plain(answer)) return [error("suggest.answer", `${where} records no answer`, { path: "fixtures/conformance.json" })]
  const options = answer["options"]
  if (!Array.isArray(options)) return [error("suggest.answer", `${where} options must be a list, empty when there is nothing to offer`, { path: "fixtures/conformance.json" })]
  const findings: Finding[] = []
  if (options.length > 64) findings.push(error("suggest.answer", `${where} offers ${options.length} options, over 64`, { path: "fixtures/conformance.json" }))
  const ids = new Set<string>()
  for (const [index, option] of options.entries()) {
    if (!plain(option) || typeof option["id"] !== "string" || option["id"].length === 0 || option["id"].length > 200) {
      findings.push(error("suggest.answer", `${where} options[${index}] must be { id, label? }`, { path: "fixtures/conformance.json" }))
      continue
    }
    if (ids.has(option["id"])) findings.push(error("suggest.answer", `${where} offers ${option["id"]} twice`, { path: "fixtures/conformance.json" }))
    ids.add(option["id"])
    if (option["label"] !== undefined && (typeof option["label"] !== "string" || option["label"].length > 200)) findings.push(error("suggest.answer", `${where} options[${index}].label must be at most 200 characters`, { path: "fixtures/conformance.json" }))
  }
  return findings
}

/** A snapshot validates against its registry output, or an `x-` source's inline outputSchema. */
export function snapshotFindings(source: Extract<SourceItem, { kind: "snapshot" }>, answer: unknown, account: string): Finding[] {
  const findings: Finding[] = []
  const accepted = acceptAnswer(source, account, answer)
  if (!accepted.ok) findings.push(error("snapshot.shape", `snapshot(${source.id}): ${accepted.failure.message}`, { path: "fixtures/conformance.json" }))
  if (plain(answer)) {
    if (typeof answer["asOf"] !== "string" || !Number.isFinite(Date.parse(answer["asOf"]))) findings.push(error("snapshot.shape", `snapshot(${source.id}) has no asOf time`, { path: "fixtures/conformance.json" }))
    const checked = checkOutput(source.output, answer["data"])
    if (!checked.ok) findings.push(...checked.problems.map((problem) => error("snapshot.shape", `snapshot(${source.id}) data: ${problem}`, { path: "fixtures/conformance.json" })))
  }
  if (source.maxBytes !== undefined && answer !== undefined) {
    const bytes = Buffer.byteLength(JSON.stringify(answer))
    if (bytes > maxBytesOf(source)) findings.push(error("snapshot.shape", `snapshot(${source.id}) is ${bytes} bytes, over its maxBytes of ${maxBytesOf(source)}`, { path: "fixtures/conformance.json" }))
  }
  return findings
}
