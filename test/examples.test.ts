import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { evaluate, operationRule, rulesFor, serverOf, sessionRules, toolAction } from "../src/access.ts"
import { STATUS_SCHEMA } from "../src/accounts.ts"
import { runConformance, t0, t1 } from "../src/conformance.ts"
import { PAGE_SCHEMA, PROBE_SCHEMA } from "../src/events.ts"
import { hostRuntimeProblem, inspectHost } from "../src/internal/conformance/host.ts"
import { readInstalledManifest, type Manifest } from "../src/manifest.ts"
import { acceptAnswer } from "../src/read.ts"
import { validate } from "../src/register/validate.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const nodeMajor = Number(process.versions.node.split(".")[0])
const skipHost = nodeMajor < 24 ? "the embedded host needs Node 24" : false
const exampleNames = ["integration", "mcp", "tools"]
const examples = readdirSync(join(root, "examples"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

/** One example's installed manifest, or the problems that stop the test. */
function manifestOf(name: string): Manifest {
  const installed = readInstalledManifest(join(root, "examples", name))
  if (!installed.ok) throw new Error(`${name}: ${installed.problems.join("; ")}`)
  return installed.value.manifest
}

/** The installed manifest with one source declaring `maxBytes`, for a detail read at and over the cap. */
function withSourceMaxBytes(manifest: Manifest, id: string, maxBytes: number): Manifest {
  return { ...manifest, sources: manifest.sources.map((source) => (source.id === id ? { ...source, maxBytes } : source)) }
}

/** The pages a fixture records, for the events authority. */
function recordedPages(name: string): { what: string; answer: unknown }[] {
  const file = join(root, "examples", name, "fixtures", "conformance.json")
  if (!existsSync(file)) return []
  const fixture = JSON.parse(readFileSync(file, "utf8")) as { sources?: Record<string, { cases?: { name?: string; answer?: unknown }[]; details?: { id: string; answer?: unknown }[] }> }
  const pages: { what: string; answer: unknown }[] = []
  for (const [id, source] of Object.entries(fixture.sources ?? {})) {
    for (const entry of source.cases ?? []) if (entry.answer !== undefined) pages.push({ what: `${id} ${entry.name ?? "a case"}`, answer: entry.answer })
    for (const detail of source.details ?? []) if (detail.answer !== undefined) pages.push({ what: `${id} ${detail.id}`, answer: detail.answer })
  }
  return pages
}

/** A minimal call object: the example handlers read only the resolved account. */
const call = (account: string) => ({ account })

describe("the examples", () => {
  test("there are exactly three installed packages, each with a manifest, a server entry and a fixture", () => {
    assert.deepEqual(examples, exampleNames)
    for (const name of exampleNames) {
      const installed = readInstalledManifest(join(root, "examples", name))
      assert.ok(installed.ok, `${name}: ${installed.ok ? "" : installed.problems.join("; ")}`)
      assert.ok(existsSync(join(root, "examples", name, "index.js")), `${name} has no server entry`)
      assert.ok(existsSync(join(root, "examples", name, "fixtures", "conformance.json")), `${name} records no fixture`)
      assert.ok(existsSync(join(root, "examples", name, "skills", manifestOf(name).plugin.name, "SKILL.md")), `${name} ships no skill`)
      assert.ok(existsSync(join(root, "examples", name, "README.md")), `${name} ships no README`)
    }
  })

  test("the manifest and the kit accept every example", { timeout: 60_000 }, async () => {
    for (const name of exampleNames) {
      const report = await runConformance(join(root, "examples", name))
      if (hostRuntimeProblem() === undefined) {
        assert.deepEqual(report.findings.filter((finding) => finding.level === "error"), [], `${name}: ${report.findings.map((finding) => `${finding.id}: ${finding.message}`).join("\n")}`)
        assert.equal(report.ok, true, name)
        if (name === "mcp") assert.ok(report.checks?.includes("T1.grant-alias"), "the mcp report names the grant-alias check it ran")
      } else {
        assert.equal(report.ok, false, name)
        assert.equal(report.findings.some((finding) => finding.id === "T1.host-unavailable" && finding.level === "error"), true, name)
      }
    }
  })

  test("T0 is clean, and T1 loads each plugin on 2.4.1 and refuses 2.5.0 cleanly", { skip: skipHost, timeout: 60_000 }, async () => {
    for (const name of exampleNames) {
      const directory = join(root, "examples", name)
      assert.deepEqual(await t0(directory), [], name)
      assert.deepEqual(await t1(directory, "2.4.1"), [], name)
      assert.deepEqual(await t1(directory, "2.5.0"), [], name)
    }
  })

  test("every recorded page is accepted by read's own answer check, as a consumer receives it", () => {
    let accepted = 0
    for (const name of exampleNames) {
      const manifest = manifestOf(name)
      for (const page of recordedPages(name)) {
        const bySource = manifest.sources.filter((source) => source.kind === "events")
        const events = bySource.find((source) => (source.input as { source?: string } | undefined)?.source === (page.answer as { source?: string })?.source) ?? bySource[0]
        assert.ok(events, `${name}: ${page.what} names no events source`)
        const account = (page.answer as { account?: string })?.account ?? "work"
        const outcome = acceptAnswer(events, account, page.answer)
        assert.ok(outcome.ok, `${name}: ${page.what}: ${outcome.ok ? "" : outcome.failure.message}`)
        accepted++
      }
    }
    assert.ok(accepted > 0)
  })

  test("the exported status, page and probe schemas accept every recorded answer", () => {
    let checked = 0
    for (const name of exampleNames) {
      const fixture = JSON.parse(readFileSync(join(root, "examples", name, "fixtures", "conformance.json"), "utf8")) as {
        events?: { status?: unknown }
        sources?: Record<string, { cases?: { answer?: unknown }[]; details?: { answer?: unknown }[]; probe?: { answer?: unknown } }>
      }
      const status = validate(STATUS_SCHEMA, fixture.events?.status)
      assert.ok(status.ok, `${name} status: ${status.ok ? "" : status.problems.join("; ")}`)
      checked++
      for (const source of Object.values(fixture.sources ?? {})) {
        for (const answer of [...(source.cases ?? []).map((entry) => entry.answer), ...(source.details ?? []).map((entry) => entry.answer)].filter((value) => value !== undefined)) {
          const page = validate(PAGE_SCHEMA, answer)
          assert.ok(page.ok, `${name} page: ${page.ok ? "" : page.problems.join("; ")}`)
          checked++
        }
        if (source.probe?.answer !== undefined) {
          const probe = validate(PROBE_SCHEMA, source.probe.answer)
          assert.ok(probe.ok, `${name} probe: ${probe.ok ? "" : probe.problems.join("; ")}`)
          checked++
        }
      }
    }
    assert.ok(checked >= 3, `${checked} recorded answers were checked`)
  })

  test("T1 proves on the real host that a grant for one alias cannot reach another alias's tools", { skip: skipHost, timeout: 60_000 }, async () => {
    const directory = join(root, "examples", "mcp")
    const inspection = await inspectHost(directory, manifestOf("mcp"), "2.4.1", { accounts: ["work", "personal"] })
    assert.deepEqual(inspection.findings, [])
    assert.ok(inspection.checks?.includes("T1.grant-alias"), `the report names the check it ran: ${inspection.checks?.join(", ")}`)
    const asserted = (inspection.run?.asks ?? []).map((ask) => ask.action)
    // The check compiles the work account's grant fence into a real session and asserts both aliases' tools on it.
    assert.ok(asserted.includes("trellis-work_messages_search"), `the work alias's own tool was asserted: ${asserted.join(", ")}`)
    assert.ok(asserted.includes("trellis-personal_messages_search"), `the personal alias's tool was asserted against work's grant: ${asserted.join(", ")}`)
  })

  test("an MCP rule or grant for one alias cannot match another alias's tool", () => {
    const manifest = manifestOf("mcp")
    const fixture = JSON.parse(readFileSync(join(root, "examples", "mcp", "fixtures", "conformance.json"), "utf8")) as { accounts?: { real?: boolean } }
    assert.equal(fixture.accounts?.real, true, "the mcp example runs its two-account cases on the real host")
    const aliases = ["work", "personal"]
    assert.deepEqual(manifest.methods["mcp:*"], { class: "read", operations: ["messages_search", "messages_read"] })

    const work = serverOf(manifest.plugin.name, "work", aliases)
    const personal = serverOf(manifest.plugin.name, "personal", aliases)
    assert.ok(work.ok && personal.ok)
    assert.equal(work.value, "trellis-work")
    assert.equal(personal.value, "trellis-personal")

    const workTool = toolAction(work.value, "messages_search")
    const personalTool = toolAction(personal.value, "messages_search")
    const workRead = toolAction(work.value, "messages_read")
    const personalRead = toolAction(personal.value, "messages_read")
    assert.equal(workTool, "trellis-work_messages_search")
    assert.equal(personalTool, "trellis-personal_messages_search")
    assert.equal(workRead, "trellis-work_messages_read")
    assert.equal(personalRead, "trellis-personal_messages_read")

    // The access rules install one wildcard per alias; a rule for work never matches personal's server.
    const rules = rulesFor(manifest, "all", aliases)
    const workRules = rules.filter((rule) => rule.action === "trellis-work_*")
    assert.equal(workRules.length, 1)
    assert.equal(evaluate(workRules, workTool), "allow")
    assert.equal(evaluate(workRules, personalTool), "ask")

    // A grant for the source compiles its bare MCP operations per alias, so work's grant fences work's server only.
    const source = manifest.sources.find((entry) => entry.kind === "events")
    assert.ok(source)
    const fence = sessionRules(source, { source: source.id, account: "work" }, aliases)
    assert.ok(fence.ok)
    assert.equal(evaluate(fence.value, workTool), "allow")
    assert.equal(evaluate(fence.value, workRead), "allow")
    assert.equal(evaluate(fence.value, personalTool), "deny")
    assert.equal(evaluate(fence.value, personalRead), "deny")

    // A specific MCP tool rule uses the same derivation and reaches only work's tool.
    const grant = operationRule(source, "messages_search", "work", aliases, "tool")
    assert.ok(grant.ok)
    assert.equal(grant.value.action, workTool)
    assert.equal(evaluate([grant.value], workTool), "allow")
    assert.equal(evaluate([grant.value], personalTool), "ask")
    assert.equal(evaluate([grant.value], "trellis-work_messages_read"), "ask")
  })

  test("status reports an unreadable agent list as error, never as an empty unguarded list", async () => {
    // The call's unguardedAgents() reader is the register's; a host whose list fails must make status say error.
    const failing = { account: "default", unguardedAgents: async () => ({ ok: false, error: "the agent list is unavailable" }) }
    const toolsModule = (await import(pathToFileURL(join(root, "examples", "tools", "handlers.js")).href)) as {
      createHandlers(parts: object): { status: { run(input: unknown, call: object): Promise<{ state: string; unguardedAgents: string[]; nextStep: unknown }> } }
    }
    const toolsStatus = await toolsModule.createHandlers({ manifest: manifestOf("tools"), version: "0.0.0", hostVersion: "2.4.1" }).status.run(undefined, failing)
    assert.equal(toolsStatus.state, "error")
    assert.deepEqual(toolsStatus.unguardedAgents, [], "the list is unknown, and the state says so")
    assert.match(String(toolsStatus.nextStep), /the agent list is unavailable/)

    const providerModule = (await import(pathToFileURL(join(root, "examples", "mcp", "provider.js")).href)) as { createTrellisProvider(): object }
    const mcpModule = (await import(pathToFileURL(join(root, "examples", "mcp", "handlers.js")).href)) as {
      createHandlers(parts: object): { status: { run(input: unknown, call: object): Promise<{ state: string; nextStep: unknown }> } }
    }
    const mcpStatus = await mcpModule
      .createHandlers({
        provider: providerModule.createTrellisProvider(),
        manifest: manifestOf("mcp"),
        options: { accounts: { work: {}, personal: {} } },
        version: "0.0.0",
        hostVersion: "2.4.1",
        accountProblems: [],
      })
      .status.run(undefined, failing)
    assert.equal(mcpStatus.state, "error")
    assert.match(String(mcpStatus.nextStep), /the agent list is unavailable/)
  })

  test("the fake Harbour provider answers deterministically, carries request ids, and refuses another account's note", async () => {
    const providerModule = (await import(pathToFileURL(join(root, "examples", "integration", "provider.js")).href)) as {
      createHarbourProvider(): {
        whoami(input: { account: string }): Promise<{ request_id: string; owner: { id: string; label: string } }>
        listNotes(input: { account: string }): Promise<{ request_id: string; notes: { id: string; space: string }[]; more: boolean }>
        readNote(input: { account: string; id: string }): Promise<{ request_id: string; note: { id: string } }>
      }
    }
    const provider = providerModule.createHarbourProvider()
    const first = await provider.listNotes({ account: "work" })
    const again = await providerModule.createHarbourProvider().listNotes({ account: "work" })
    assert.deepEqual(again, first)
    assert.match(first.request_id, /^req_harbour_\d{4}_notes$/)
    assert.ok(first.notes.length > 0)
    assert.ok(first.notes.every((note) => note.id.startsWith("note-work-")))

    const workOwner = await provider.whoami({ account: "work" })
    const personalOwner = await provider.whoami({ account: "personal" })
    assert.notEqual(workOwner.owner.id, personalOwner.owner.id)
    assert.match(workOwner.owner.id, /^[a-z][a-z0-9+.-]*:/)

    await assert.rejects(
      () => provider.readNote({ account: "personal", id: "note-work-1" }),
      (error: unknown) => {
        const failure = error as { code?: string; requestId?: string }
        assert.equal(failure.code, "FORBIDDEN")
        assert.match(String(failure.requestId), /^req_harbour_\d{4}_note$/)
        return true
      },
    )
  })

  test("the Harbour handlers map a provider refusal to the contract's message, with a next step", async () => {
    const providerModule = (await import(pathToFileURL(join(root, "examples", "integration", "provider.js")).href)) as { createHarbourProvider(): object }
    const handlersModule = (await import(pathToFileURL(join(root, "examples", "integration", "handlers.js")).href)) as {
      createHandlers(parts: object): {
        read_note: { run(input: { external_id: string }, call: { account: string }): Promise<unknown> }
        events_list: { run(input: Record<string, unknown>, call: { account: string }): Promise<unknown> }
      }
    }
    const manifest = manifestOf("integration")
    const handlers = handlersModule.createHandlers({
      provider: providerModule.createHarbourProvider(),
      manifest,
      options: { accounts: { work: {}, personal: {} } },
      version: "0.0.0",
      hostVersion: "2.4.1",
      accountProblems: [],
    })

    // The committed page is what this handler answers today, not a hand-written shape.
    const fixture = JSON.parse(readFileSync(join(root, "examples", "integration", "fixtures", "conformance.json"), "utf8")) as {
      sources: Record<string, { cases: { input: Record<string, unknown>; answer: unknown }[] }>
    }
    const first = fixture.sources["harbour.notes"]?.cases[0]
    assert.ok(first)
    assert.deepEqual(await handlers.events_list.run(first.input, call("work")), first.answer)

    await assert.rejects(
      () => handlers.read_note.run({ external_id: "note-personal-1" }, call("work")),
      (error: unknown) => {
        assert.match((error as Error).message, /^PERMISSION_DENIED: .*Next step: /)
        return true
      },
    )
  })

  test("the Harbour read_note answers TOO_LARGE instead of trimming a detail page over maxBytes", async () => {
    const handlersModule = (await import(pathToFileURL(join(root, "examples", "integration", "handlers.js")).href)) as {
      createHandlers(parts: object): { read_note: { run(input: { external_id: string }, call: { account: string }): Promise<unknown> } }
    }
    const manifest = manifestOf("integration")
    // The fake provider answers one note as large as a note can be; a page over a small declared maxBytes must refuse,
    // never cut the note, and a page exactly at the cap is the whole note.
    const fake = {
      asOf: "2026-11-20T09:00:00.000Z",
      async whoami() {
        return { request_id: "req_harbour_0001_whoami", owner: { id: "mailto:ana.silva@harbour.example.com", label: "Ana Silva" } }
      },
      async readNote({ id }: { id: string }) {
        return {
          request_id: "req_harbour_0001_note",
          note: {
            id,
            space: "space-research",
            title: "A note larger than its source's limit",
            text: "x".repeat(4096),
            url: "https://docs.harbour.example.com/notes/note-work-1",
            updated_at: "2026-11-18T10:15:00.000Z",
            author: { id: "mailto:ana.silva@harbour.example.com", name: "Ana Silva" },
          },
        }
      },
    }
    const at = (maxBytes: number) =>
      handlersModule.createHandlers({
        provider: fake,
        manifest: withSourceMaxBytes(manifest, "harbour.notes", maxBytes),
        options: { accounts: { work: {}, personal: {} } },
        version: "0.0.0",
        hostVersion: "2.4.1",
        accountProblems: [],
      })
    const page = await at(262_144).read_note.run({ external_id: "note-work-1" }, call("work"))
    const bytes = Buffer.byteLength(JSON.stringify(page), "utf8")
    assert.ok(bytes > 1_024, `the fake note's page is ${bytes} bytes`)
    assert.deepEqual(await at(bytes).read_note.run({ external_id: "note-work-1" }, call("work")), page, "a page exactly at maxBytes is accepted")
    await assert.rejects(
      () => at(bytes - 1).read_note.run({ external_id: "note-work-1" }, call("work")),
      (error: unknown) => {
        assert.match((error as Error).message, /^TOO_LARGE: .*Next step: /)
        assert.match((error as Error).message, new RegExp(`${bytes} bytes, over the ${bytes - 1}-byte limit of harbour.notes`))
        return true
      },
    )
  })

  test("the Trellis read_thread answers TOO_LARGE instead of trimming a detail page over maxBytes", async () => {
    const handlersModule = (await import(pathToFileURL(join(root, "examples", "mcp", "handlers.js")).href)) as {
      createHandlers(parts: object): { read_thread: { run(input: { thread: string }, call: { account: string }): Promise<unknown> } }
    }
    const manifest = manifestOf("mcp")
    // A thread of messages as large as the normaliser allows: over the source's declared 256 KB, so the read refuses.
    const fake = {
      asOf: "2026-11-20T09:00:00.000Z",
      async whoami() {
        return { request_id: "req_trellis_0001_whoami", owner: { id: "trellis:U-WORK-ANA", label: "Ana Silva" } }
      },
      async readThread({ thread }: { thread: string }) {
        const messages = Array.from({ length: 80 }, (_, index) => ({
          id: `M-LONG-${index}`,
          channel: "C-RESEARCH",
          thread,
          title: `Message ${index}`,
          text: "x".repeat(4096),
          url: `https://app.trellis.example.com/channels/C-RESEARCH/p/M-LONG-${index}`,
          sent_at: "2026-11-18T10:15:00.000Z",
          author: { id: "trellis:U-WORK-ANA", name: "Ana Silva" },
        }))
        return { request_id: "req_trellis_0001_thread", messages }
      },
    }
    const at = (maxBytes: number) =>
      handlersModule.createHandlers({
        provider: fake,
        manifest: withSourceMaxBytes(manifest, "trellis.messages", maxBytes),
        options: { accounts: { work: {}, personal: {} } },
        version: "0.0.0",
        hostVersion: "2.4.1",
        accountProblems: [],
      })
    const thread = "trellis-thread:C-RESEARCH:M-WORK-1"
    await assert.rejects(
      () => at(262_144).read_thread.run({ thread }, call("work")),
      (error: unknown) => {
        assert.match((error as Error).message, /^TOO_LARGE: .*Next step: /)
        assert.match((error as Error).message, /over the 262144-byte limit of trellis\.messages/)
        return true
      },
    )
    const accepted = await at(1_048_576).read_thread.run({ thread }, call("work"))
    const bytes = Buffer.byteLength(JSON.stringify(accepted), "utf8")
    assert.ok(bytes > 262_144, `the fake thread's page is ${bytes} bytes`)
    assert.deepEqual(await at(bytes).read_thread.run({ thread }, call("work")), accepted, "a page exactly at maxBytes is accepted")
    await assert.rejects(
      () => at(bytes - 1).read_thread.run({ thread }, call("work")),
      (error: unknown) => {
        assert.match((error as Error).message, new RegExp(`${bytes} bytes, over the ${bytes - 1}-byte limit of trellis\\.messages`))
        return true
      },
    )
  })

  test("the tools handlers plan, commit and emit changed, and refuse an unknown note", async () => {
    const handlersModule = (await import(pathToFileURL(join(root, "examples", "tools", "handlers.js")).href)) as {
      createHandlers(parts: object): {
        word_count: { run(input: { text: string }, call: { account: string }): Promise<unknown> }
        read_note: { run(input: { id: string }, call: { account: string }): Promise<unknown> }
        plan_write_note: { run(input: { id: string; text: string }, call: { account: string }): Promise<{ method: string; output: { id: string; text: string; characters: number } }> }
        write_note: { run(input: { planId: string }, call: { account: string; plan?: unknown; bus: { emit(event: string, data: unknown): Promise<unknown> } }): Promise<unknown> }
      }
    }
    const emitted: unknown[] = []
    const handlers = handlersModule.createHandlers({
      manifest: manifestOf("tools"),
      version: "0.0.0",
      hostVersion: "2.4.1",
    })

    assert.deepEqual(await handlers.word_count.run({ text: "One two three." }, call("default")), { words: 3, characters: 14 })
    const plan = await handlers.plan_write_note.run({ id: "welcome", text: "A new note." }, call("default"))
    assert.equal(plan.method, "write_note")
    assert.equal(Object.hasOwn(plan, "planId"), false, "the register mints the planId")
    assert.deepEqual(plan.output, { id: "welcome", text: "A new note.", characters: 11 }, "the preview carries what the commit writes")
    // The register keeps the plan handler's full answer and gives it to the commit as call.plan; `register` always
    // puts the bus writer on the call as call.bus.
    const bus = { emit: async (event: string, data: unknown) => (emitted.push({ event, data }), { ok: true }) }
    assert.deepEqual(await handlers.write_note.run({ planId: "minted-by-the-register" }, { ...call("default"), plan, bus }), { id: "welcome", text: "A new note." })
    assert.deepEqual(await handlers.read_note.run({ id: "welcome" }, call("default")), { id: "welcome", text: "A new note." })
    assert.deepEqual(emitted, [{ event: "changed", data: { capability: "glyph.notes", account: "default", reason: "write" } }])
    await assert.rejects(
      () => handlers.read_note.run({ id: "missing" }, call("default")),
      (error: unknown) => {
        assert.match((error as Error).message, /^INPUT_INVALID: .*Next step: /)
        return true
      },
    )
  })
})
