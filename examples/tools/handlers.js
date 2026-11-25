// The Glyph plugin's one handler table: a tools-only plugin with no accounts and no sources.
//
// A read is a pure function. A write is planned first with `plan_write_note`, then committed with `write_note`, and the
// commit emits the contract's `changed` bus event through `call.bus`, which `register(ctx, manifest, handlers,
// { bus: true })` attaches.
import { NO_ACCOUNTS, redactReason, STATUS_SCHEMA } from "../../dist/accounts.js"
import { unguardedAgents } from "../../dist/access.js"
import { COMMIT_INPUT, refusal, RegisterError } from "../../dist/register.js"

const PLUGIN = "glyph"
const OBJECT = { type: "object", additionalProperties: true }
const EMPTY = { type: "object", properties: {}, additionalProperties: false }
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
 * @param {{ access?: { rules: unknown[] }, agents?: () => Promise<unknown[]>, hostVersion?: string }} [parts.state] registration state status reads
 */
export function createHandlers({ manifest, version, state = {} }) {
  const hostRange = manifest.plugin.host.opencode
  const tested = manifest.plugin.host.tested
  const notes = new Map([["welcome", "Glyph keeps short notes in memory."]])

  return {
    status: {
      description: "Read Glyph's state, its host range and its (empty) account list.",
      input: EMPTY,
      output: STATUS_SCHEMA,
      async run() {
        let unguarded = []
        let agentsError
        if (state.access !== undefined && state.agents !== undefined) {
          try {
            unguarded = [...unguardedAgents(await state.agents(), state.access.rules)]
          } catch (error) {
            // An unreadable agent list is unknown, never zero: status says error, with a redacted next step.
            agentsError = redactReason(error instanceof Error ? error.message : String(error)).slice(0, 200)
          }
        }
        return {
          name: PLUGIN,
          version,
          host: { version: state.hostVersion ?? tested[0], range: hostRange, tested },
          state: agentsError === undefined ? "ready" : "error",
          accounts: [...NO_ACCOUNTS],
          unguardedAgents: unguarded,
          nextStep: agentsError ?? null,
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
        // The register mints the planId; the answer is the person's preview and the commit's call.plan. The preview
        // carries the text the commit will write, so the person confirms exactly what is written.
        return {
          method: "write_note",
          output: { id: input.id, text: input.text, characters: input.text.length },
          changes: [`Replace the text of ${input.id}.`],
          trust: "untrusted",
        }
      },
    },

    write_note: {
      description: "Commit a planned note write.",
      input: COMMIT_INPUT,
      output: NOTE,
      async run(input, call) {
        // The commit writes only what the preview showed the person, read from the plan's preview fields.
        const planned = call.plan?.output
        if (planned === undefined || typeof planned.id !== "string" || typeof planned.text !== "string") {
          throw new RegisterError(refusal("PLAN_INVALID", "Glyph holds no plan for this commit", "Plan the write again, then commit the new planId."))
        }
        notes.set(planned.id, planned.text)
        await call.bus.emit("changed", { capability: "glyph.notes", account: call.account, reason: "write" })
        return { id: planned.id, text: planned.text }
      },
    },
  }
}
