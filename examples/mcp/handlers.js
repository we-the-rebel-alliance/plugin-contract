// The Trellis plugin's one handler table.
//
// `index.js` passes this table to `register` once. The vendor's own MCP tools are declared as `mcp:*` in the manifest
// and have no handler: their server owns them. Every method here is the plugin's own read, and the fake Trellis API is
// behind `provider.js`.
import { accountStatuses, accountsOf, STATUS_SCHEMA, statusAnswer } from "../../dist/accounts.js"
import { decodeBoundCursor, encodeBoundCursor } from "../../dist/cursor.js"
import { eventsListResult, EVENTS_LIST_INPUT_SCHEMA, fitPage, LIST_OPTIONS_SCHEMA, makeEvent, MAX_PAGE_BYTES, PAGE_SCHEMA, parseEventsListInput, PROBE_SCHEMA, probeResult } from "../../dist/events.js"
import { findSource, maxBytesOf } from "../../dist/manifest.js"
import { refusal, RegisterError } from "../../dist/register.js"
import { ProviderError } from "./provider.js"

const PACKAGE = "@we-the-rebel-alliance/trellis-plugin"
const PLUGIN = "trellis"
const SOURCE = "messages"
const SOURCE_ID = "trellis.messages"
const EMPTY = { type: "object", properties: {}, additionalProperties: false }

const binding = (account, scope) => ({ plugin: PLUGIN, source: SOURCE, account, ...(scope === undefined ? {} : { scope }) })

/** The contract refusal for a Trellis API failure. The request id is safe to show; no credential is. */
function refusalFor(error, call, action, next) {
  if (error instanceof ProviderError) {
    if (error.code === "UNAUTHENTICATED") {
      return new RegisterError(refusal("NEEDS_SIGN_IN", `${action} could not sign in to ${call.account} (request ${error.requestId})`, `Sign in again as ${call.account}.`))
    }
    if (error.code === "RATE_LIMITED") {
      return new RegisterError(refusal("RATE_LIMITED", `Trellis asked to slow down (request ${error.requestId})`, "Try again after a short wait."))
    }
    if (error.code === "FORBIDDEN") {
      return new RegisterError(refusal("PERMISSION_DENIED", `${action} is outside what ${call.account} may read (request ${error.requestId})`, next))
    }
    if (error.code === "NOT_FOUND") {
      return new RegisterError(refusal("INPUT_INVALID", `${action} found nothing for that input (request ${error.requestId})`, next))
    }
  }
  const reason = error instanceof Error ? error.message : String(error)
  return new RegisterError(refusal("UNAVAILABLE", `${action} failed: ${reason}`, "Try again; if it keeps failing, check the plugin's status."))
}

/** One message as a contract event, through the shared normaliser. */
function messageEvent(message, account) {
  return makeEvent({
    source: SOURCE,
    account,
    external_id: message.id,
    kind: "message",
    occurred_at: message.sent_at,
    thread: message.thread,
    actors: [{ role: "from", id: message.author.id, name: message.author.name }],
    title: message.title,
    text: message.text,
    url: message.url,
    labels: [message.channel],
  })
}

/**
 * The handler table.
 *
 * @param {object} parts
 * @param {ReturnType<import("./provider.js").createTrellisProvider>} parts.provider the fake Trellis API
 * @param {object} parts.manifest the installed capabilities
 * @param {object} [parts.options] the plugin options, including the account profiles
 * @param {string} parts.version the installed package version, for status
 * @param {string} parts.hostVersion the OpenCode release the plugin runs on, for status
 * @param {string[]} [parts.accountProblems] what registering the accounts could not do, for status
 */
export function createHandlers({ provider, manifest, options = {}, version, hostVersion, accountProblems = [] }) {
  const source = findSource(manifest, SOURCE_ID)
  const maxBytes = source === undefined ? MAX_PAGE_BYTES : maxBytesOf(source)

  async function ownersByAlias() {
    const plan = accountsOf(manifest, options)
    if (!plan.ok) return { profiles: [], signals: {} }
    const signals = {}
    for (const profile of plan.value.accounts) {
      try {
        const answer = await provider.whoami({ account: profile.alias })
        signals[profile.alias] = { state: "ready", owner: answer.owner }
      } catch (error) {
        if (error instanceof ProviderError && error.code === "UNAUTHENTICATED") signals[profile.alias] = { state: "needs_sign_in" }
        else signals[profile.alias] = { state: "error", reason: error instanceof Error ? error.message : String(error) }
      }
    }
    return { profiles: plan.value.accounts, signals }
  }

  return {
    status: {
      description: "Read Trellis's state, its host range and every account alias.",
      input: EMPTY,
      output: STATUS_SCHEMA,
      async run(_input, call) {
        const { profiles, signals } = await ownersByAlias()
        return statusAnswer({
          manifest,
          version,
          hostVersion,
          accounts: profiles.length === 0 ? [] : accountStatuses(profiles, signals),
          problems: [...accountProblems],
          unguardedAgents: await call.unguardedAgents(),
        })
      },
    },

    probe: {
      description: "Read the signed-in Trellis owner for an account, without reading any message.",
      input: EMPTY,
      output: PROBE_SCHEMA,
      async run(_input, call) {
        try {
          const answer = await provider.whoami({ account: call.account })
          return probeResult({ source: SOURCE, account: call.account, owner: answer.owner }, { scopes: ["channels"] })
        } catch (error) {
          throw refusalFor(error, call, "probe", "Sign the account in again, then probe it.")
        }
      },
    },

    events_list: {
      description: "List Trellis messages as contract events, oldest first, with a cursor that belongs to the account and scope.",
      input: EVENTS_LIST_INPUT_SCHEMA,
      output: PAGE_SCHEMA,
      async run(input, call) {
        const parsed = parseEventsListInput(input, { scopeKeys: ["channels"] })
        if (!parsed.ok) {
          throw new RegisterError(refusal("INPUT_INVALID", `events_list's input breaks its schema: ${parsed.problems.join("; ")}`, "Pass only the input events_list's schema describes."))
        }
        const request = parsed.value
        if (request.source !== undefined && request.source !== SOURCE) {
          throw new RegisterError(refusal("SOURCE_UNKNOWN", `${PLUGIN} has no source ${request.source}`, `Read the ${SOURCE} source.`))
        }
        const scope = request.scope
        let position = 0
        if (request.cursor !== undefined) {
          const decoded = decodeBoundCursor(binding(call.account, scope), request.cursor)
          if (!decoded.ok) {
            throw new RegisterError(refusal("CURSOR_INVALID", `the cursor is ${decoded.reason} to ${call.account}, so this read cannot use it`, "Read again without a cursor."))
          }
          if (typeof decoded.state.position !== "number" || !Number.isInteger(decoded.state.position) || decoded.state.position < 0) {
            throw new RegisterError(refusal("CURSOR_INVALID", "the cursor carries no page Trellis issued", "Read again without a cursor."))
          }
          position = decoded.state.position
        }
        try {
          const answer = await provider.listMessages({
            account: call.account,
            ...(scope?.channels === undefined ? {} : { channels: scope.channels }),
            ...(request.cursor !== undefined || request.since === undefined ? {} : { since: new Date(request.since).toISOString() }),
            position,
            limit: request.limit,
          })
          const owner = await provider.whoami({ account: call.account })
          const events = answer.messages.map((message) => messageEvent(message, call.account))
          const fit = fitPage(events, request.limit, maxBytes)
          return eventsListResult(
            { source: SOURCE, account: call.account, owner: owner.owner },
            events.slice(0, fit),
            encodeBoundCursor(binding(call.account, scope), { position: position + fit }),
            answer.more || fit < events.length,
            { plugin: PACKAGE, asOf: provider.asOf },
          )
        } catch (error) {
          throw refusalFor(error, call, "events_list", "Confirm a channel this account can read, then read again.")
        }
      },
    },

    read_thread: {
      description: "Read one Trellis thread, taken from the thread of the event that listed it.",
      input: { type: "object", properties: { thread: { type: "string" } }, required: ["thread"], additionalProperties: false },
      output: PAGE_SCHEMA,
      async run(input, call) {
        let page
        try {
          const answer = await provider.readThread({ account: call.account, thread: input.thread })
          const owner = await provider.whoami({ account: call.account })
          const events = answer.messages.map((message) => messageEvent(message, call.account))
          page = eventsListResult(
            { source: SOURCE, account: call.account, owner: owner.owner },
            events,
            encodeBoundCursor(binding(call.account), { thread: input.thread }),
            false,
            { plugin: PACKAGE, asOf: provider.asOf },
          )
        } catch (error) {
          throw refusalFor(error, call, "read_thread", "Read a thread that belongs to this account.")
        }
        // A detail read is not trimmed: a page over the source's limit is refused, so the thread is whole or not at all.
        const bytes = Buffer.byteLength(JSON.stringify(page), "utf8")
        if (bytes > maxBytes) {
          throw new RegisterError(refusal("TOO_LARGE", `the thread's detail page is ${bytes} bytes, over the ${maxBytes}-byte limit of ${SOURCE_ID}`, "Request a narrower detail, or read within the source's configured limit."))
        }
        return page
      },
    },

    list_channels: {
      description: "List the Trellis channels and direct messages this account may confirm for a read.",
      input: EMPTY,
      output: LIST_OPTIONS_SCHEMA,
      async run(_input, call) {
        try {
          const answer = await provider.listChannels({ account: call.account })
          return { options: answer.channels.map((channel) => ({ id: channel.id, label: channel.label })) }
        } catch (error) {
          throw refusalFor(error, call, "list_channels", "Sign the account in again, then list its channels.")
        }
      },
    },
  }
}
