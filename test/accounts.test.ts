import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  accountLabel,
  accountName,
  accountsOf,
  accountStatus,
  accountStatuses,
  aliasProblem,
  aliasesSentence,
  DEFAULT_ALIAS,
  hasAccount,
  isAlias,
  localIdentity,
  redactReason,
  registerAccounts,
  resolveAccount,
  STATUS_SCHEMA,
  statusAnswer,
} from "../src/accounts.ts"
import { decodeBoundCursor, encodeBoundCursor } from "../src/cursor.ts"
import { checkManifest, type Manifest } from "../src/manifest.ts"
import { validate } from "../src/register/validate.ts"
import { manifest } from "./support/manifest.ts"

const checkedManifest = (change: (value: any) => void = () => {}): Manifest => {
  const checked = checkManifest(manifest(change))
  assert.equal(checked.ok, true, checked.ok ? "" : checked.problems.join("\n"))
  if (!checked.ok) throw new Error("fixture")
  return checked.value
}

describe("aliases", () => {
  test("one lowercase letter, then up to 31 lowercase letters or digits; no underscore", () => {
    for (const alias of ["default", "work", "personal", "a", "a".repeat(32)]) assert.equal(isAlias(alias), true, alias)
    for (const alias of ["Work", "2work", "work-2", "work_2", "work 2", "", "a".repeat(33)]) assert.equal(isAlias(alias), false, alias)
    assert.equal(aliasProblem("work"), undefined)
    assert.match(aliasProblem("work-2") ?? "", /must match/)
    assert.match(aliasProblem(2) ?? "", /must be a string/)
  })

  test("names derive from the plugin's name, and default has none", () => {
    assert.equal(accountName("slack", DEFAULT_ALIAS), "slack")
    assert.equal(accountName("slack", "work"), "slack-work")
    assert.equal(accountLabel("Slack", "work"), "Slack (work)")
    assert.equal(accountLabel("Slack", DEFAULT_ALIAS), "Slack")
    assert.throws(() => accountName("slack", "Work"), /not an account alias/)
  })
})

describe("accountsOf", () => {
  test("a plugin that signs in to nothing has no accounts", () => {
    const value = checkedManifest((m) => delete m.accounts)
    const plan = accountsOf(value)
    assert.deepEqual(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.value.mechanism, undefined)
    assert.deepEqual(plan.value.accounts, [])
  })

  test("with no accounts option there is exactly one default account", () => {
    const plan = accountsOf(checkedManifest())
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.value.mechanism, "integration")
    assert.deepEqual(plan.value.accounts.map((account) => account.alias), ["default"])
    assert.equal(hasAccount(plan.value, "default"), true)
    assert.equal(hasAccount(plan.value, "work"), false)
  })

  test("two aliases keep their order and profiles, checked against the plugin's profile schema", () => {
    const options = { accounts: { work: { region: "eu" }, personal: { region: "us" } } }
    const plan = accountsOf(checkedManifest(), options)
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.deepEqual(plan.value.accounts, [
      { alias: "work", profile: { region: "eu" } },
      { alias: "personal", profile: { region: "us" } },
    ])
  })

  test("refuses an alias that breaks the rule, a profile that breaks the plugin's schema, and a non-object option", () => {
    const value = checkedManifest()
    for (const [options, expected] of [
      [{ accounts: { "work-2": { region: "eu" } } }, /options\.accounts\.work-2/],
      [{ accounts: { Work: { region: "eu" } } }, /options\.accounts\.Work/],
      [{ accounts: { work: "eu" } }, /options\.accounts\.work: must be an object/],
      [{ accounts: { work: { region: 2 } } }, /options\.accounts\.work\.region/],
      [{ accounts: { work: { extra: true } } }, /options\.accounts\.work\.extra/],
      [{ accounts: "work" }, /options\.accounts: must be a map/],
    ] as const) {
      const plan = accountsOf(value, options as Record<string, unknown>)
      assert.equal(plan.ok, false, JSON.stringify(options))
      if (!plan.ok) assert.match(plan.problems.join("; "), expected)
    }
    // An empty map is the one default account.
    const empty = accountsOf(value, { accounts: {} })
    assert.equal(empty.ok, true)
    if (empty.ok) assert.deepEqual(empty.value.accounts.map((account) => account.alias), ["default"])
  })

  test("a local plugin has one default account with the machine's identity", () => {
    const value = checkedManifest((m) => (m.accounts.via = "local"))
    const plan = accountsOf(value, { accounts: { work: { region: "eu" } } })
    assert.equal(plan.ok, false)
    if (!plan.ok) assert.match(plan.problems.join("; "), /one account, named default/)
    const one = accountsOf(value)
    assert.equal(one.ok, true)
    if (!one.ok) return
    assert.equal(one.value.accounts.length, 1)
    assert.match(one.value.accounts[0]!.identity ?? "", /^os-user:.+@.+$/)
    assert.equal(localIdentity({ user: "ana", host: "box" }), "os-user:ana@box")
  })
})

describe("resolveAccount", () => {
  const two = [{ alias: "work" }, { alias: "personal" }]

  test("with one account, omitting it is fine; with more than one it is ACCOUNT_REQUIRED, listing the aliases", () => {
    assert.deepEqual(resolveAccount([{ alias: "work" }]), { ok: true, alias: "work" })
    const required = resolveAccount(two)
    assert.equal(required.ok, false)
    if (required.ok) return
    assert.equal(required.code, "ACCOUNT_REQUIRED")
    assert.match(required.next, /work/)
    assert.match(required.next, /personal/)
    assert.equal(aliasesSentence(two), "Pass account, one of: work or personal.")
  })

  test("names the alias when it is declared, and ACCOUNT_UNKNOWN when it is not", () => {
    assert.deepEqual(resolveAccount(two, { account: "work" }), { ok: true, alias: "work" })
    const unknown = resolveAccount(two, { account: "family" })
    assert.equal(unknown.ok, false)
    if (unknown.ok) return
    assert.equal(unknown.code, "ACCOUNT_UNKNOWN")
    assert.match(unknown.next, /Pass account, one of: work, personal/)
    const wrongType = resolveAccount(two, { account: 2 })
    assert.equal(wrongType.ok ? "" : wrongType.code, "ACCOUNT_UNKNOWN")
  })

  test("a plugin with no accounts resolves default when none is named, and refuses a named one", () => {
    assert.deepEqual(resolveAccount([]), { ok: true, alias: "default" })
    const named = resolveAccount([], { account: "work" })
    assert.equal(named.ok, false)
    if (!named.ok) assert.match(named.next, /Leave account out/)
  })
})

describe("registerAccounts with a synthetic context", () => {
  type Update = { id: string; name: string | undefined; methods: unknown[] }
  function integrationContext(fail?: (id: string) => boolean) {
    const updates: Update[] = []
    const ctx = {
      integration: {
        async transform(callback: (editor: any) => void) {
          const editor = {
            get: () => undefined,
            update(id: string, update: (ref: { id: string; name: string }) => void) {
              if (fail?.(id)) throw new Error("the host refused it")
              const ref = { id, name: "" }
              update(ref)
              updates.push({ id, name: ref.name, methods: [] })
            },
            method: {
              list: () => [],
              update(input: unknown) {
                updates.at(-1)!.methods.push(input)
              },
              remove: () => {},
            },
          }
          callback(editor)
          return {}
        },
      },
      mcp: { transform: async () => ({}) },
    }
    return { ctx, updates }
  }

  function mcpContext() {
    const servers: { name: string; config: unknown }[] = []
    const ctx = {
      integration: { transform: async () => ({}) },
      mcp: {
        async transform(callback: (editor: any) => void) {
          const editor = {
            list: () => [],
            get: () => undefined,
            set(name: string, config: unknown) {
              servers.push({ name, config })
            },
            update: () => {},
            remove: () => {},
          }
          callback(editor)
          return {}
        },
      },
    }
    return { ctx, servers }
  }

  test("an integration plugin registers one integration per alias, with its auth methods", async () => {
    const { ctx, updates } = integrationContext()
    const result = await registerAccounts(ctx, {
      manifest: checkedManifest(),
      options: { accounts: { work: { region: "eu" }, personal: { region: "us" } } },
      auth: (account, id) => [{ integrationID: id, method: { type: "key", label: `Key for ${account.alias}` } }] as never,
    })
    assert.deepEqual(result.problems, [])
    assert.deepEqual(result.accounts, [
      { alias: "work", name: "demo-work" },
      { alias: "personal", name: "demo-personal" },
    ])
    assert.deepEqual(updates.map((update) => update.id), ["demo-work", "demo-personal"])
    assert.deepEqual(updates.map((update) => update.name), ["Demo (work)", "Demo (personal)"])
    assert.deepEqual(updates[0]!.methods, [{ integrationID: "demo-work", method: { type: "key", label: "Key for work" } }])
  })

  test("the default alias has the plugin's own name, and no alias means exactly one integration", async () => {
    const { ctx, updates } = integrationContext()
    const result = await registerAccounts(ctx, { manifest: checkedManifest(), auth: (_account, id) => [{ integrationID: id, method: { type: "key" } }] as never })
    assert.equal(result.problems.length, 0)
    assert.deepEqual(updates.map((update) => update.id), ["demo"])
    assert.deepEqual(result.accounts, [{ alias: "default", name: "demo" }])
  })

  test("an mcp plugin registers one server per alias with its own config", async () => {
    const { ctx, servers } = mcpContext()
    const result = await registerAccounts(ctx, {
      manifest: checkedManifest((m) => (m.accounts.via = "mcp")),
      options: { accounts: { work: { region: "eu" }, personal: {} } },
      server: (account, name) => ({ type: "remote", url: `https://${name}.example/mcp`, oauth: account.alias }) as never,
    })
    assert.deepEqual(result.problems, [])
    assert.deepEqual(servers.map((server) => server.name), ["demo-work", "demo-personal"])
    assert.deepEqual(servers[1]!.config, { type: "remote", url: "https://demo-personal.example/mcp", oauth: "personal" })
  })

  test("a local plugin registers nothing", async () => {
    let called = 0
    const ctx = {
      integration: {
        async transform() {
          called++
          return {}
        },
      },
      mcp: {
        async transform() {
          called++
          return {}
        },
      },
    }
    const result = await registerAccounts(ctx, { manifest: checkedManifest((m) => (m.accounts.via = "local")) })
    assert.equal(result.problems.length, 0)
    assert.equal(called, 0)
    assert.equal(result.mechanism, "local")
  })

  test("records a failure and never throws, so a transform cannot take the plugin down", async () => {
    const { ctx } = integrationContext((id) => id === "demo-personal")
    const result = await registerAccounts(ctx, {
      manifest: checkedManifest(),
      options: { accounts: { work: {}, personal: {} } },
      auth: (_account, id) => [{ integrationID: id, method: { type: "key" } }] as never,
    })
    assert.deepEqual(result.problems, ["accounts.personal: the integration demo-personal could not be registered: the host refused it"])
  })

  test("an integration plugin with no auth methods is reported, not silently registered", async () => {
    const { ctx, updates } = integrationContext()
    const result = await registerAccounts(ctx, { manifest: checkedManifest() })
    assert.deepEqual(result.problems, ["accounts: the integration mechanism needs auth methods for each alias"])
    assert.equal(updates.length, 0)
  })

  test("an invalid options map is reported before any transform runs", async () => {
    const { ctx, updates } = integrationContext()
    const result = await registerAccounts(ctx, { manifest: checkedManifest(), options: { accounts: "work" } })
    assert.equal(updates.length, 0)
    assert.match(result.problems[0] ?? "", /options\.accounts/)
  })
})

describe("status per alias", () => {
  const accounts = [{ alias: "work" }, { alias: "personal" }]

  test("reports each alias independently, with its owner once probed", () => {
    const statuses = accountStatuses(accounts, {
      work: { state: "ready", owner: { id: "mailto:ana@example.com", label: "Ana" } },
      personal: { state: "needs_sign_in" },
    })
    assert.deepEqual(statuses, [
      { alias: "work", state: "ready", owner: { id: "mailto:ana@example.com", label: "Ana" } },
      { alias: "personal", state: "needs_sign_in" },
    ])
    assert.deepEqual(accountStatuses([]), [])
  })

  test("an unchecked alias is needs_sign_in; an error carries one redacted line of at most 160 characters", () => {
    assert.deepEqual(accountStatus("work", undefined), { alias: "work", state: "needs_sign_in", reason: "Not signed in yet." })
    assert.deepEqual(accountStatus("work", { state: "ready", reason: "should not show" }), { alias: "work", state: "ready" })
    const redacted = accountStatus("work", {
      state: "error",
      reason: `GET https://api.example/x?token=secret&sig=abc failed\nAuthorization: Bearer sk_live_${"9".repeat(40)} ${"z".repeat(300)}`,
    })
    assert.equal(redacted.state, "error")
    assert.ok(redacted.reason !== undefined)
    assert.equal(redacted.reason.includes("\n"), false)
    assert.equal(redacted.reason.includes("secret"), false)
    assert.equal(redacted.reason.includes("sk_live"), false)
    assert.ok(redacted.reason.length <= 160, redacted.reason)
  })
})

describe("statusAnswer", () => {
  const value = checkedManifest()
  const base = { manifest: value, version: "1.2.3", hostVersion: "2.4.9" }

  test("assembles the identity, the host block and every alias, and the answer is what STATUS_SCHEMA describes", () => {
    const answer = statusAnswer({ ...base, accounts: accountStatuses([{ alias: "work" }], { work: { state: "ready", owner: { id: "mailto:ana@example.com", label: "Ana" } } }), unguardedAgents: [] })
    assert.deepEqual(answer, {
      name: "demo",
      version: "1.2.3",
      host: { version: "2.4.9", range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] },
      state: "ready",
      accounts: [{ alias: "work", state: "ready", owner: { id: "mailto:ana@example.com", label: "Ana" } }],
      unguardedAgents: [],
      nextStep: null,
    })
    const checked = validate(STATUS_SCHEMA, answer)
    assert.deepEqual(checked.ok, true, checked.ok ? "" : checked.problems.join("; "))
  })

  test("state is error over needs_sign_in over ready; a problem is the redacted next step", () => {
    const signedOut = statusAnswer({ ...base, accounts: accountStatuses([{ alias: "work" }], { work: { state: "needs_sign_in" } }), unguardedAgents: ["build"] })
    assert.equal(signedOut.state, "needs_sign_in")
    assert.equal(signedOut.nextStep, "Sign in to the account that needs it, then read status again.")
    assert.deepEqual(signedOut.unguardedAgents, ["build"])

    const token = `sk_live_${"9".repeat(40)}`
    const failed = statusAnswer({ ...base, accounts: [], problems: [`accounts: the key ${token} was refused`], unguardedAgents: [] })
    assert.equal(failed.state, "error")
    assert.equal(failed.nextStep?.includes("sk_live"), false, "a problem is redacted before it reaches nextStep")
    assert.ok((failed.nextStep?.length ?? 0) <= 160)
    assert.deepEqual(failed.accounts, [], "a plugin with no accounts answers an empty list, never a default")
  })
})

describe("redactReason", () => {
  test("drops query values, credentials and token-shaped words", () => {
    assert.equal(redactReason("see https://x.example/a?token=abc&keep=1"), "see https://x.example/a?token=…&keep=…")
    assert.equal(redactReason("Authorization: Bearer abc.def.ghi"), "Authorization: Bearer …")
    assert.equal(redactReason(`token ${"A".repeat(64)} refused`), "token … refused")
    assert.equal(redactReason("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"), "…")
    assert.equal(redactReason(""), "No reason was given.")
    assert.equal(redactReason(undefined), "No reason was given.")
    assert.equal(redactReason("a\nb\tc"), "a b c")
  })

  test("cuts a long line to 160 characters without splitting a surrogate pair", () => {
    const cut = redactReason("é".repeat(400))
    assert.equal(cut.length, 160)
    assert.ok(cut.endsWith("…"))
    const pairs = redactReason("😀".repeat(200))
    assert.ok(pairs.length <= 160)
    assert.equal(pairs.endsWith("😀…"), true)
  })
})

describe("two accounts, end to end", () => {
  test("independent status, resolution, names, and cursors that do not cross over", () => {
    const plan = accountsOf(checkedManifest(), { accounts: { work: { region: "eu" }, personal: { region: "us" } } })
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    const aliases = plan.value.accounts.map((account) => account.alias)
    assert.deepEqual(aliases, ["work", "personal"])
    assert.deepEqual(aliases.map((alias) => accountName("demo", alias)), ["demo-work", "demo-personal"])
    assert.deepEqual(
      accountStatuses(plan.value.accounts, {
        work: { state: "ready", owner: { id: "mailto:ana@example.com", label: "Ana" } },
        personal: { state: "error", reason: "the provider refused the refresh token" },
      }).map((status) => [status.alias, status.state]),
      [
        ["work", "ready"],
        ["personal", "error"],
      ],
    )
    const work = encodeBoundCursor({ plugin: "demo", source: "messages", account: "work" }, { since: 1 })
    const personal = encodeBoundCursor({ plugin: "demo", source: "messages", account: "personal" }, { since: 2 })
    assert.deepEqual(decodeBoundCursor({ plugin: "demo", source: "messages", account: "work" }, work), { ok: true, state: { since: 1 } })
    assert.deepEqual(decodeBoundCursor({ plugin: "demo", source: "messages", account: "personal" }, personal), { ok: true, state: { since: 2 } })
    assert.deepEqual(decodeBoundCursor({ plugin: "demo", source: "messages", account: "personal" }, work), { ok: false, reason: "foreign" })
    assert.deepEqual(decodeBoundCursor({ plugin: "demo", source: "messages", account: "work" }, personal), { ok: false, reason: "foreign" })
  })
})
