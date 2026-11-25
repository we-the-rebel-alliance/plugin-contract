// The Glyph plugin's one handler table: a tools-only plugin with no accounts and no sources.
//
// A read is a pure function. A write is planned first with `plan_write_note`, then committed with `write_note`, and the
// commit emits the contract's `changed` bus event. `index.js` gives this table its one bus writer after `register`.
import { NO_ACCOUNTS } from "../../dist/accounts.js"
import { unguardedAgents } from "../../dist/access.js"
import { refusal, RegisterError } from "../../dist/register.js"

const PLUGIN = "glyph"
const OBJECT = { type: "object", additionalProperties: true }
const EMPTY = { type: "object", properties: {}, additionalProperties: false }
const STATUS = {
  type: "object",
  properties: {
    name: { type: "string" },
    version: { type: "string" },
    host: {
      type: "object",
      properties: { version: { type: "string" }, range: { type: "string" }, tested: { type: "array", items: { type: "string" } } },
      required: ["version", "range", "tested"],
      additionalProperties: false,
    },
    state: { type: "string", enum: ["ready", "needs_sign_in", "error"] },
    accounts: { type: "array", items: { type: "object", additionalProperties: true } },
    unguardedAgents: { type: "array", items: { type: "string" } },
    nextStep: {},
  },
  required: ["name", "version", "host", "state", "accounts", "unguardedAgents", "nextStep"],
  additionalProperties: false,
}
const COUNT = {
  type: "object",
  properties: { words: { type: "integer" }, characters: { type: "integer" } },
  required: ["words", "characters"],
  additionalProperties: false,
}
const NOTE = {
  type: "object",
  properties: { id: { type: "string" }, text: { type: "string" } },
  required: ["id", "text"],
  additionalProperties: false,
}

/**
 * The handler table.
 *
 * @param {object} parts
 * @param {object} parts.manifest the installed capabilities
 * @param {string} parts.version the installed package version, for status
 * @param {{ emit: (event: string, data: unknown) => Promise<unknown> }} parts.bus the bus writer, set by `index.js`
 * @param {{ access?: { rules: unknown[] }, agents?: () => Promise<unknown[]>, hostVersion?: string }} [parts.state] registration state status reads
 */
export function createHandlers({ manifest, version, bus, state = {} }) {
  const hostRange = manifest.plugin.host.opencode
  const tested = manifest.plugin.host.tested
  const notes = new Map([["welcome", "Glyph keeps short notes in memory."]])

  return {
    status: {
      description: "Read Glyph's state, its host range and its (empty) account list.",
      input: EMPTY,
      output: STATUS,
      async run() {
        let unguarded = []
        if (state.access !== undefined && state.agents !== undefined) {
          try {
            unguarded = [...unguardedAgents(await state.agents(), state.access.rules)]
          } catch {
            unguarded = []
          }
        }
        return {
          name: PLUGIN,
          version,
          host: { version: state.hostVersion ?? tested[0], range: hostRange, tested },
          state: "ready",
          accounts: [...NO_ACCOUNTS],
          unguardedAgents: unguarded,
          nextStep: null,
        }
      },
    },

    word_count: {
      description: "Count the words and characters in a piece of text.",
      input: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
      output: COUNT,
      async run(input) {
        const trimmed = input.text.trim()
        return { words: trimmed === "" ? 0 : trimmed.split(/\s+/).length, characters: [...input.text].length }
      },
    },

    read_note: {
      description: "Read one short note by its id.",
      input: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      output: NOTE,
      async run(input) {
        const text = notes.get(input.id)
        if (text === undefined) {
          throw new RegisterError(refusal("INPUT_INVALID", `Glyph has no note ${JSON.stringify(input.id)}`, "Pass the id of a note that exists."))
        }
        return { id: input.id, text }
      },
    },

    plan_write_note: {
      description: "Plan a note write: the preview names the note and the text, and writes nothing.",
      input: {
        type: "object",
        properties: { id: { type: "string" }, text: { type: "string" } },
        required: ["id", "text"],
        additionalProperties: false,
      },
      output: OBJECT,
      async run(input) {
        // The register mints the planId; the planned note travels to the commit as call.plan.
        return {
          method: "write_note",
          id: input.id,
          text: input.text,
          output: { id: input.id, characters: input.text.length },
          changes: [`Replace the text of ${input.id}.`],
          trust: "untrusted",
        }
      },
    },

    write_note: {
      description: "Commit a planned note write.",
      input: EMPTY,
      output: NOTE,
      async run(input, call) {
        const planned = call.plan
        if (planned === undefined || typeof planned !== "object" || typeof planned.id !== "string" || typeof planned.text !== "string") {
          throw new RegisterError(refusal("PLAN_INVALID", "Glyph holds no plan for this commit", "Plan the write again, then commit the new planId."))
        }
        notes.set(planned.id, planned.text)
        await bus.emit("changed", { capability: "glyph.notes", account: call.account, reason: "write" })
        return { id: planned.id, text: planned.text }
      },
    },
  }
}
