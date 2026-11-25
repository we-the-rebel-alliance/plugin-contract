// The fake Trellis API, as the example's provider.
//
// Trellis is an invented chat service. This module answers the same way its HTTP API would: every call carries a
// `request_id`, and every failure is a `ProviderError` with the API's own code. The vendor's MCP server holds the
// credentials in the real plugin; this fake stands in for it so the example runs with no network.
//
// API contract:
//
//   whoami({ account })                    -> { request_id, account, owner: { id, label } }
//   listChannels({ account })              -> { request_id, channels: [{ id, label }] }
//   listMessages({ account, channels?, since?, position?, limit? })
//                                          -> { request_id, messages: [message], next_position, more }
//   readThread({ account, thread })        -> { request_id, messages: [message] }
//
// message: { id, channel, thread, title, text, url, sent_at, author: { id, name } }
// error: { code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "RATE_LIMITED", message, request_id }

const AS_OF = "2026-11-20T09:00:00.000Z"

/** The vendor MCP server URL for one account's server name. This module is the one place the example names it. */
export const mcpServerUrl = (name) => `https://mcp.trellis.example.com/${name}`

const ACCOUNTS = {
  work: {
    owner: { id: "trellis:U-WORK-ANA", label: "Ana Silva" },
    channels: [
      { id: "C-RESEARCH", label: "research" },
      { id: "D-KAI", label: "Kai Mensah (direct message)" },
    ],
    messages: [
      {
        id: "M-WORK-1",
        channel: "C-RESEARCH",
        thread: "trellis-thread:C-RESEARCH:M-WORK-1",
        title: "Queue migration notes",
        text: "The queue migration is on for Thursday. The runbook is in the shared space.",
        url: "https://app.trellis.example.com/channels/C-RESEARCH/p/M-WORK-1",
        sent_at: "2026-11-18T10:15:00.000Z",
        author: { id: "trellis:U-WORK-ANA", name: "Ana Silva" },
      },
      {
        id: "M-WORK-2",
        channel: "C-RESEARCH",
        thread: "trellis-thread:C-RESEARCH:M-WORK-1",
        title: "Re: Queue migration notes",
        text: "Rehearsal passed. I will watch the lag after the switch.",
        url: "https://app.trellis.example.com/channels/C-RESEARCH/p/M-WORK-2",
        sent_at: "2026-11-18T10:31:00.000Z",
        author: { id: "trellis:U-WORK-KAI", name: "Kai Mensah" },
      },
      {
        id: "M-WORK-3",
        channel: "D-KAI",
        thread: "trellis-thread:D-KAI:M-WORK-3",
        title: "Handover",
        text: "No open incidents. Ping me if the queue backs up.",
        url: "https://app.trellis.example.com/channels/D-KAI/p/M-WORK-3",
        sent_at: "2026-11-19T08:40:00.000Z",
        author: { id: "trellis:U-WORK-KAI", name: "Kai Mensah" },
      },
    ],
  },
  personal: {
    owner: { id: "trellis:U-PERSONAL-ANA", label: "Ana Silva (personal)" },
    channels: [{ id: "D-ROWAN", label: "Rowan (direct message)" }],
    messages: [
      {
        id: "M-PERSONAL-1",
        channel: "D-ROWAN",
        thread: "trellis-thread:D-ROWAN:M-PERSONAL-1",
        title: "Weekend",
        text: "Are we still walking on Saturday?",
        url: "https://app.trellis.example.com/channels/D-ROWAN/p/M-PERSONAL-1",
        sent_at: "2026-11-17T19:05:00.000Z",
        author: { id: "trellis:U-PERSONAL-ROWAN", name: "Rowan Vale" },
      },
    ],
  },
}

/** A failure the Trellis API answers, with its own code and the request id a support ticket names. */
export class ProviderError extends Error {
  /**
   * @param {string} code the API's code
   * @param {string} message one line, safe to show
   * @param {string} requestId the request id the API assigned
   */
  constructor(code, message, requestId) {
    super(message)
    this.name = "ProviderError"
    this.code = code
    this.requestId = requestId
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value))

/** A fresh fake Trellis API. Every instance starts at request 1, so a test gets the same ids every run. */
export function createTrellisProvider() {
  let requests = 0
  const requestId = (operation) => {
    requests += 1
    return `req_trellis_${String(requests).padStart(4, "0")}_${operation}`
  }

  const accountOf = (alias, operation) => {
    const account = ACCOUNTS[alias]
    if (account === undefined) throw new ProviderError("UNAUTHENTICATED", `Trellis has no credential for ${String(alias)}`, requestId(operation))
    return account
  }

  return {
    asOf: AS_OF,

    async whoami({ account }) {
      const id = requestId("whoami")
      const held = accountOf(account, "whoami")
      return { request_id: id, account, owner: clone(held.owner) }
    },

    async listChannels({ account }) {
      const id = requestId("channels")
      const held = accountOf(account, "channels")
      return { request_id: id, channels: clone(held.channels) }
    },

    async listMessages({ account, channels, since, position = 0, limit = 100 } = {}) {
      const id = requestId("messages")
      const held = accountOf(account, "messages")
      if (!Number.isInteger(position) || position < 0) throw new ProviderError("NOT_FOUND", "the page position is not one Trellis issued", id)
      let messages = [...held.messages].sort((left, right) => left.sent_at.localeCompare(right.sent_at))
      if (channels !== undefined && channels.length > 0) {
        const wanted = new Set(channels)
        const known = new Set(held.channels.map((channel) => channel.id))
        const unknown = [...wanted].filter((channel) => !known.has(channel))
        if (unknown.length > 0) throw new ProviderError("NOT_FOUND", `the account has no channel ${unknown.join(", ")}`, id)
        messages = messages.filter((message) => wanted.has(message.channel))
      }
      if (since !== undefined) {
        const at = Date.parse(since)
        if (!Number.isFinite(at)) throw new ProviderError("NOT_FOUND", "since is not a date Trellis reads", id)
        messages = messages.filter((message) => Date.parse(message.sent_at) > at)
      }
      const page = messages.slice(position, position + limit)
      return { request_id: id, messages: clone(page), next_position: position + page.length, more: position + page.length < messages.length }
    },

    async readThread({ account, thread }) {
      const id = requestId("thread")
      const held = accountOf(account, "thread")
      const messages = held.messages.filter((message) => message.thread === thread).sort((left, right) => left.sent_at.localeCompare(right.sent_at))
      if (messages.length > 0) return { request_id: id, messages: clone(messages) }
      const elsewhere = Object.values(ACCOUNTS).some((other) => other !== held && other.messages.some((message) => message.thread === thread))
      if (elsewhere) throw new ProviderError("FORBIDDEN", `the ${account} account does not own that thread`, id)
      throw new ProviderError("NOT_FOUND", `Trellis has no thread ${String(thread)}`, id)
    },
  }
}
