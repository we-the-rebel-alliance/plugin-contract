// The conformance fixture plugin: a real server entry that uses contract.register, with write, send and delete
// methods, a plan and its commit, a grant action, an events source with thumbnails, a detail, a suggest read and a
// pinned tool. The kit's tests load this into the real @opencode/sdk host and run every hard check against it.
import { readFileSync } from "node:fs"
import { makeEvent } from "../../../dist/events.js"
import { assertHost, register } from "../../../dist/register.js"

const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).capabilities
const OBJECT = { type: "object", additionalProperties: true }
const EMPTY = { type: "object", properties: {}, additionalProperties: false }
const OK = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false }

const owners = {
  work: { id: "mailto:work@example.test", label: "Work" },
  personal: { id: "mailto:personal@example.test", label: "Personal" },
}

const cursor = (account) => Buffer.from(JSON.stringify({ account, source: "messages" }), "utf8").toString("base64url")

function page(account, input = {}) {
  const event = makeEvent({
    source: "messages",
    account,
    external_id: `m-${account}`,
    kind: "message",
    occurred_at: "2026-11-01T09:00:00.000Z",
    title: "A fixture message",
    text: "The fixture plugin's own text.",
    url: "https://files.example.com/messages/1",
    labels: ["inbox"],
    actors: [{ role: "from", id: owners[account]?.id ?? "mailto:work@example.test", name: owners[account]?.label ?? "Work" }],
    ...(input["thumbnails"] === true ? { thumbnail: "https://files.example.com/thumbs/1.png" } : {}),
  })
  return {
    source: "messages",
    account,
    owner: owners[account] ?? owners.work,
    events: [event],
    cursor: cursor(account),
    more: false,
    trust: "untrusted",
    asOf: "2026-11-13T09:00:00.000Z",
  }
}

const handlers = {
  status: { description: "Read the fixture's status.", input: EMPTY, output: OK, run: async () => ({ ok: true }) },
  probe: {
    description: "Read the signed-in owner.",
    input: EMPTY,
    output: OBJECT,
    run: async (_input, call) => ({ account: call.account, owner: owners[call.account] ?? owners.work, trust: "untrusted" }),
  },
  events_list: {
    description: "List fixture messages.",
    input: {
      type: "object",
      properties: {
        source: { type: "string" },
        cursor: { type: "string" },
        thumbnails: { type: "boolean" },
        scope: { type: "object", additionalProperties: true },
      },
      additionalProperties: false,
    },
    output: OBJECT,
    run: async (input, call) => {
      if (typeof input["cursor"] === "string") {
        let decoded
        try {
          decoded = JSON.parse(Buffer.from(input["cursor"], "base64url").toString("utf8"))
        } catch {
          throw new Error("CURSOR_INVALID: the cursor is not ours. Next step: read again without a cursor.")
        }
        if (decoded.account !== call.account || decoded.source !== "messages") {
          throw new Error("CURSOR_INVALID: the cursor belongs to another account or source. Next step: read again without a cursor.")
        }
      }
      return page(call.account, input)
    },
  },
  read_message: {
    description: "Read one message's detail.",
    input: { type: "object", properties: { external_id: { type: "string" } }, required: ["external_id"], additionalProperties: false },
    output: OBJECT,
    run: async (_input, call) => page(call.account),
  },
  list_channels: {
    description: "List the channels a person may confirm.",
    input: EMPTY,
    output: OBJECT,
    run: async () => ({ options: [{ id: "C1", label: "general" }] }),
  },
  plan_send: { description: "Plan a message.", input: EMPTY, output: OBJECT, run: async () => ({ method: "send_message" }) },
  send_message: { description: "Send a planned message.", input: EMPTY, output: OK, run: async () => ({ ok: true }) },
  write_note: { description: "Write a note.", input: EMPTY, output: OK, run: async () => ({ ok: true }) },
  delete_note: { description: "Delete a note.", input: EMPTY, output: OK, run: async () => ({ ok: true }) },
  share_note: { description: "Share a note.", input: EMPTY, output: OK, run: async () => ({ ok: true }) },
  pinned_status: { description: "Read the pinned status.", input: EMPTY, output: OK, run: async () => ({ ok: true }) },
}

export default {
  id: manifest.plugin.name,
  async setup(context) {
    assertHost(context, manifest)
    const registration = await register(context, manifest, handlers)
    return () => registration.dispose()
  },
}
