// The fake Harbour API, as the example's provider.
//
// The example needs no network: Harbour is an invented notes service, and this module answers the same way its HTTP API
// would. Each call answers a `request_id`, and each failure is a `ProviderError` with the API's own code, a request id
// and a message. The handler table maps those codes to contract codes. Tests in the repository drive this provider
// directly, and the recorded fixture was produced from its answers through the handlers.
//
// API contract:
//
//   whoami({ account })                    -> { request_id, account, owner: { id, label } }
//   listSpaces({ account })                -> { request_id, spaces: [{ id, label }] }
//   listNotes({ account, spaces?, since?, position?, limit? })
//                                          -> { request_id, notes: [note], next_position, more }
//   readNote({ account, id })              -> { request_id, note }
//
// note: { id, space, title, text, url, updated_at, author: { id, name } }
// error: { code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "RATE_LIMITED", message, request_id }

const AS_OF = "2026-11-20T09:00:00.000Z"

const ACCOUNTS = {
  work: {
    owner: { id: "mailto:ana.silva@harbour.example.com", label: "Ana Silva" },
    spaces: [
      { id: "space-research", label: "Research" },
      { id: "space-operations", label: "Operations" },
    ],
    notes: [
      {
        id: "note-work-1",
        space: "space-research",
        title: "Queue migration notes",
        text: "The queue moves to one provider per environment. The runbook follows after the rehearsal.",
        url: "https://docs.harbour.example.com/notes/note-work-1",
        updated_at: "2026-11-18T10:15:00.000Z",
        author: { id: "mailto:ana.silva@harbour.example.com", name: "Ana Silva" },
      },
      {
        id: "note-work-2",
        space: "space-operations",
        title: "On-call handover",
        text: "No open incidents. Watch the queue lag after the migration.",
        url: "https://docs.harbour.example.com/notes/note-work-2",
        updated_at: "2026-11-19T08:40:00.000Z",
        author: { id: "mailto:kai.mensah@harbour.example.com", name: "Kai Mensah" },
      },
    ],
  },
  personal: {
    owner: { id: "mailto:ana.silva@personal.example", label: "Ana Silva (personal)" },
    spaces: [{ id: "space-home", label: "Home" }],
    notes: [
      {
        id: "note-personal-1",
        space: "space-home",
        title: "Weekend reading",
        text: "Finish the two library books, then plan the garden bed.",
        url: "https://docs.harbour.example.com/notes/note-personal-1",
        updated_at: "2026-11-17T19:05:00.000Z",
        author: { id: "mailto:ana.silva@personal.example", name: "Ana Silva" },
      },
    ],
  },
}

/** A failure the Harbour API answers, with its own code and the request id a support ticket names. */
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

/** A fresh fake Harbour API. Every instance starts at request 1, so a test gets the same ids every run. */
export function createHarbourProvider() {
  let requests = 0
  const requestId = (operation) => {
    requests += 1
    return `req_harbour_${String(requests).padStart(4, "0")}_${operation}`
  }

  const accountOf = (alias, operation) => {
    const account = ACCOUNTS[alias]
    if (account === undefined) throw new ProviderError("UNAUTHENTICATED", `Harbour has no credential for ${String(alias)}`, requestId(operation))
    return account
  }

  return {
    asOf: AS_OF,

    async whoami({ account }) {
      const id = requestId("whoami")
      const held = accountOf(account, "whoami")
      return { request_id: id, account, owner: clone(held.owner) }
    },

    async listSpaces({ account }) {
      const id = requestId("spaces")
      const held = accountOf(account, "spaces")
      return { request_id: id, spaces: clone(held.spaces) }
    },

    async listNotes({ account, spaces, since, position = 0, limit = 100 } = {}) {
      const id = requestId("notes")
      const held = accountOf(account, "notes")
      if (!Number.isInteger(position) || position < 0) throw new ProviderError("NOT_FOUND", "the page position is not one Harbour issued", id)
      let notes = [...held.notes].sort((left, right) => left.updated_at.localeCompare(right.updated_at))
      if (spaces !== undefined && spaces.length > 0) {
        const wanted = new Set(spaces)
        const known = new Set(held.spaces.map((space) => space.id))
        const unknown = [...wanted].filter((space) => !known.has(space))
        if (unknown.length > 0) throw new ProviderError("NOT_FOUND", `the account has no space ${unknown.join(", ")}`, id)
        notes = notes.filter((note) => wanted.has(note.space))
      }
      if (since !== undefined) {
        const at = Date.parse(since)
        if (!Number.isFinite(at)) throw new ProviderError("NOT_FOUND", "since is not a date Harbour reads", id)
        notes = notes.filter((note) => Date.parse(note.updated_at) > at)
      }
      const page = notes.slice(position, position + limit)
      return { request_id: id, notes: clone(page), next_position: position + page.length, more: position + page.length < notes.length }
    },

    async readNote({ account, id: noteId }) {
      const id = requestId("note")
      const held = accountOf(account, "note")
      const note = held.notes.find((entry) => entry.id === noteId)
      if (note !== undefined) return { request_id: id, note: clone(note) }
      const elsewhere = Object.values(ACCOUNTS).some((other) => other !== held && other.notes.some((entry) => entry.id === noteId))
      if (elsewhere) throw new ProviderError("FORBIDDEN", `the ${account} account does not own that note`, id)
      throw new ProviderError("NOT_FOUND", `Harbour has no note ${String(noteId)}`, id)
    },
  }
}
