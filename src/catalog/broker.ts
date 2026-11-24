/**
 * The broker side of `catalog`: one request and one answer (contract §9, §14).
 *
 * A broker is a thin layer a host builds over the same library. It adds a persistent cache keyed by the provider
 * identity from `probe` plus `(source, account, scope, params, window)`, per-person budgets and cadence, and an audit
 * line per read with no content. The host holds the grants it drew consent for, and may only narrow them: a cached
 * answer serves a consumer only when that consumer's own grant covers the same source, account and scope, never
 * another person or viewer. It never advances a consumer's cursor and never transforms an answer.
 *
 * **The grant key is `consumer`.** The request names who reads (`consumer`), and `package`, `version` and
 * `manifestHash` describe the source's installed manifest. A broker looks the grant up by consumer, compares the
 * version and hash with its own installed copy, and refuses another declaration with `PERMISSION_DENIED` (issue #8).
 *
 * **The wire shape** is one request and one answer (`BrokerRequest`, `BrokerAnswer`), so any host can offer a broker
 * through its own channel.
 *
 * - `{ offered: false }`: no broker now; the client reads embedded, for this request.
 * - `{ offered: true, ok: true, value }`: `value` is the plugin's answer, untransformed. The client checks it exactly as
 *   an embedded read does (`acceptAnswer`) and applies `pick`, so a broker never needs to be trusted for shape.
 * - `{ offered: true, ok: false, code, message }`: a refusal, read through the error table.
 *
 * **How a broker is offered.** The consumer's own code passes the transport, from a channel it already trusts. Never
 * find one by asking over RPC: an RPC id has no owner in OpenCode, so another plugin could answer in the broker's
 * name.
 */
import { canonicalScope } from "../cursor.ts"
import { failureFromError } from "../internal/failure.ts"
import { acceptAnswer, checkReadRequest, read, type ReadHost, type ReadOutcome, type ReadRequest } from "../read.ts"

/** One read, as a consumer asks a host's broker for it. */
export interface BrokerRequest {
  /** The installed package the consumer read its manifest from. */
  readonly package: string
  /** The installed package's version. */
  readonly version: string
  /** The manifest hash the consumer consented under; a broker whose own copy differs refuses with PERMISSION_DENIED. */
  readonly manifestHash: string
  /** Who reads, such as `memory`: the broker's grant key and its audit line. */
  readonly consumer: string
  readonly source: string
  readonly account?: string
  readonly scope?: Readonly<Record<string, readonly string[]>>
  /** An events read. `since` may be relative; the broker resolves it in the person's time zone. */
  readonly cursor?: string
  readonly since?: string
  readonly limit?: number
  /** A broker may apply it to send less; the client applies it again. */
  readonly pick?: readonly string[]
}

/** A broker's answer. */
export type BrokerAnswer =
  | { readonly offered: false }
  | { readonly offered: true; readonly ok: true; readonly value: unknown; readonly asOf?: string; readonly cached?: boolean }
  | { readonly offered: true; readonly ok: false; readonly code: string; readonly message: string; readonly next?: string; readonly retryAfterSec?: number }

/** How a consumer reaches a host's broker: one call, through a channel it trusts. */
export type BrokerTransport = (request: BrokerRequest, signal?: AbortSignal) => Promise<BrokerAnswer>

/** A read's outcome, and how it was made. */
export type ReaderOutcome = ReadOutcome & {
  /** "broker" when the host's broker answered, "embedded" when the read ran here. */
  readonly via: "broker" | "embedded"
  /** True when the broker served the answer from its cache. */
  readonly cached?: boolean
}

/** A consumer's reader. */
export interface SourceReader {
  read(request: ReadRequest): Promise<ReaderOutcome>
}

/** The request a broker receives for a consumer's read: references to the installed package, never its manifest or the grant. */
export function brokerRequest(request: ReadRequest): BrokerRequest {
  const asked = request.scope ?? request.grant.scope
  const scope = asked === undefined ? undefined : (canonicalScope(asked) as Record<string, string[]>)
  return {
    package: request.installed.package,
    version: request.installed.version,
    manifestHash: request.installed.hash,
    consumer: request.consumer,
    source: request.source,
    account: request.grant.account,
    ...(scope === undefined ? {} : { scope }),
    ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    ...(request.since === undefined ? {} : { since: request.since }),
    ...(request.limit === undefined ? {} : { limit: request.limit }),
    ...(request.pick === undefined ? {} : { pick: request.pick }),
  }
}

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** True when `answer` has a broker answer's shape. */
export function isBrokerAnswer(answer: unknown): answer is BrokerAnswer {
  if (!plain(answer)) return false
  if (answer["offered"] === false) return true
  if (answer["offered"] !== true) return false
  if (answer["ok"] === true) return "value" in answer
  return answer["ok"] === false && typeof answer["code"] === "string" && typeof answer["message"] === "string"
}

/**
 * True when `request` has a broker request's shape, for a broker reading one from an untrusted channel. `consumer` is
 * required and non-empty: it is the grant key, so a request without one cannot be served.
 */
export function isBrokerRequest(request: unknown): request is BrokerRequest {
  if (!plain(request)) return false
  for (const key of ["package", "version", "manifestHash", "consumer", "source"] as const) {
    const value = request[key]
    if (typeof value !== "string" || value.length === 0) return false
  }
  if (request["account"] !== undefined && typeof request["account"] !== "string") return false
  if (request["cursor"] !== undefined && typeof request["cursor"] !== "string") return false
  if (request["since"] !== undefined && typeof request["since"] !== "string") return false
  if (request["limit"] !== undefined && !(typeof request["limit"] === "number" && Number.isInteger(request["limit"]) && request["limit"] > 0)) return false
  const scope = request["scope"]
  if (scope !== undefined && !(plain(scope) && Object.values(scope).every((values) => Array.isArray(values) && values.every((value) => typeof value === "string")))) return false
  const pick = request["pick"]
  if (pick !== undefined && !(Array.isArray(pick) && pick.every((value) => typeof value === "string"))) return false
  return true
}

/**
 * The reader a consumer uses. With a broker transport, each read goes to the broker first, after the same checks an
 * embedded read makes; it runs embedded when the broker says it is not offered, when the transport fails, or when its
 * answer is not a broker answer. Without one, every read runs embedded over the consumer's own host.
 */
export function sourceReader(options: { readonly host: ReadHost; readonly broker?: BrokerTransport }): SourceReader {
  const { host, broker } = options
  const embedded = async (request: ReadRequest): Promise<ReaderOutcome> => ({ ...(await read(host, request)), via: "embedded" })
  if (!broker) return { read: embedded }
  return {
    async read(request) {
      const checked = checkReadRequest(request)
      if ("ok" in checked) return { ...checked, via: "embedded" }
      let answer: unknown
      try {
        answer = await broker(brokerRequest(request), request.signal)
      } catch {
        return embedded(request)
      }
      if (!isBrokerAnswer(answer) || !answer.offered) return embedded(request)
      if (!answer.ok) {
        const failure = failureFromError({
          code: answer.code,
          message: answer.message,
          data: { ...(answer.next === undefined ? {} : { next: answer.next }), ...(answer.retryAfterSec === undefined ? {} : { retryAfterSec: answer.retryAfterSec }) },
        })
        return { ok: false, failure, via: "broker" }
      }
      const accepted = acceptAnswer(checked.source, request.grant.account, answer.value, {
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.pick === undefined ? {} : { pick: request.pick }),
      })
      return { ...accepted, via: "broker", ...(answer.cached === undefined ? {} : { cached: answer.cached }) }
    },
  }
}
