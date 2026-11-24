/** A valid v0 manifest, and a mutable copy for one test's change. */
import { manifestHash } from "../../src/manifest.ts"

export function manifest(change: (value: any) => void = () => {}): any {
  const value = {
    version: 1,
    plugin: {
      name: "demo",
      title: "Demo",
      summary: "A demo connector, for tests.",
      vendor: { id: "demo", name: "Demo", domain: "demo.example" },
      icons: [{ src: "assets/icon.svg", type: "image/svg+xml" }],
      host: { opencode: ">=2.4.1 <2.5.0", tested: ["2.4.1"] },
    },
    accounts: {
      via: "integration",
      profile: { $ref: "#/options/properties/accounts/additionalProperties" },
      owner: "mailto",
    },
    options: {
      type: "object",
      properties: {
        access: { type: "string", enum: ["all", "ask-changes", "read-only"], default: "all" },
        accounts: {
          type: "object",
          additionalProperties: { type: "object", properties: { region: { type: "string" } }, additionalProperties: false },
        },
        allowUntestedHost: { type: "boolean", default: false },
      },
    },
    methods: {
      status: { class: "read", accounts: "none" },
      probe: { class: "read", accounts: "optional", operations: ["demo.users.get"] },
      events_list: { class: "read", accounts: "optional" },
      events_detail: { class: "read", accounts: "optional", operations: ["demo.messages.get"] },
      list_channels: { class: "read", accounts: "optional", operations: ["demo.channels.list"] },
      plan_send: { class: "read", plans: true, accounts: "optional" },
      send_message: { class: "send", commits: "plan_send", accounts: "optional", operations: ["demo.messages.create"] },
      "mcp:*": { class: "read" },
    },
    sources: [
      {
        id: "demo.messages",
        kind: "events",
        reads: "message",
        method: "events_list",
        input: { source: "messages" },
        service: { id: "demo.chat", label: "Chat" },
        operations: ["demo.messages.list", "demo.messages.get"],
        scope: { keys: ["channels"], describe: "Which channels.", suggest: { method: "list_channels", operations: ["demo.channels.list"] } },
        cadence: { providerMinMinutes: 1, suggestMinutes: 2 },
        signals: ["bus", "mcp-events"],
        private: true,
        cost: { class: "free" },
        maxBytes: 262_144,
        details: [{ id: "demo.messages.thread", method: "events_detail", from: ["thread"] }],
        facts: ["commitment"],
        hints: ["hints/messages.md"],
        urlHosts: ["files.example", "*.cdn.example"],
        thumbnails: true,
      },
      {
        id: "demo.channels",
        kind: "snapshot",
        output: "list",
        method: "list_channels",
        service: { id: "demo.chat", label: "Chat" },
        operations: ["demo.channels.list"],
        cost: { class: "free" },
      },
    ],
    actions: [
      {
        id: "demo.messages.send",
        effect: "notify",
        preview: "plan_send",
        commit: "send_message",
        input: { type: "object", additionalProperties: true },
        output: { type: "object", additionalProperties: true },
      },
    ],
    events: { changed: {}, status: {}, account: {} },
  }
  change(value)
  return value
}

/** What `readInstalledManifest` returns for `manifest`, with a fixed package and version. */
export function installed(value: any = manifest()): any {
  return { package: "@example/demo", version: "1.0.0", directory: "/tmp/demo", manifest: value, hash: manifestHash(value) }
}
