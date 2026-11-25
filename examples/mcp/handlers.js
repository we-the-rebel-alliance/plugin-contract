// The Trellis plugin's one handler table.
//
// `index.js` passes this table to `register` once. The vendor's own MCP tools are declared as `mcp:*` in the manifest
// and have no handler: their server owns them. Every method here is the plugin's own read, and the fake Trellis API is
// behind `provider.js`.
import { accountStatuses, accountsOf, redactReason, STATUS_SCHEMA, statusAnswer } from "../../dist/accounts.js"
import { decodeBoundCursor, encodeBoundCursor } from "../../dist/cursor.js"
import { LIST_OPTIONS_SCHEMA, makeEvent, PAGE_SCHEMA, PROBE_SCHEMA } from "../../dist/events.js"
import { refusal, RegisterError } from "../../dist/register.js"
import { ProviderError } from "./provider.js"

const PACKAGE = "@we-the-rebel-alliance/trellis-plugin"
const PLUGIN = "trellis"
const SOURCE = "messages"
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
        const problems = [...accountProblems]
        let unguarded = []
        try {
          unguarded = [...(await call.unguardedAgents())]
        } catch (error) {
          // An unreadable agent list is unknown, never zero: status says error, with a redacted next step.
          problems.unshift(redactReason(error instanceof Error ? error.message : String(error)))
        }
        return statusAnswer({
          manifest,
          version,
          hostVersion,
          accounts: profiles.length === 0 ? [] : accountStatuses(profiles, signals),
          problems,
          unguardedAgents: unguarded,
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
          return { source: SOURCE, account: call.account, owner: answer.owner, scopes: ["channels"], trust: "untrusted" }
        } catch (error) {
          throw refusalFor(error, call, "probe", "Sign the account in again, then probe it.")
        }
      },
    },

    events_list: {
      description: "List Trellis messages as contract events, oldest first, with a cursor that belongs to the account and scope.",
      input: {
        type: "object",
        properties: {
          source: { type: "string" },
          cursor: { type: "string" },
          since: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 500 },
          scope: { type: "object", properties: { channels: { type: "array", items: { type: "string" } } }, additionalProperties: false },
        },
        additionalProperties: false,
      },
      output: PAGE_SCHEMA,
      async run(input, call) {
        if (input.source !== undefined && input.source !== SOURCE) {
          throw new RegisterError(refusal("SOURCE_UNKNOWN", `${PLUGIN} has no source ${String(input.source)}`, `Read the ${SOURCE} source.`))
        }
        const scope = input.scope
        let position = 0
        if (input.cursor !== undefined) {
          const decoded = decodeBoundCursor(binding(call.account, scope), input.cursor)
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
            ...(input.cursor !== undefined || input.since === undefined ? {} : { since: input.since }),
            position,
            ...(input.limit === undefined ? {} : { limit: input.limit }),
          })
          const owner = await provider.whoami({ account: call.account })
          return {
            source: SOURCE,
            account: call.account,
            owner: owner.owner,
            events: answer.messages.map((message) => messageEvent(message, call.account)),
            cursor: encodeBoundCursor(binding(call.account, scope), { position: answer.next_position }),
            more: answer.more,
            trust: "untrusted",
            plugin: PACKAGE,
            asOf: provider.asOf,
          }
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
        try {
          const answer = await provider.readThread({ account: call.account, thread: input.thread })
          const owner = await provider.whoami({ account: call.account })
          return {
            source: SOURCE,
            account: call.account,
            owner: owner.owner,
            events: answer.messages.map((message) => messageEvent(message, call.account)),
            cursor: encodeBoundCursor(binding(call.account), { thread: input.thread }),
            more: false,
            trust: "untrusted",
            plugin: PACKAGE,
            asOf: provider.asOf,
          }
        } catch (error) {
          throw refusalFor(error, call, "read_thread", "Read a thread that belongs to this account.")
        }
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
