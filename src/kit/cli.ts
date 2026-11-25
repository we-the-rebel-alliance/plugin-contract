/**
 * `plugin-kit`: the binary a plugin's CI runs.
 *
 *   plugin-kit check          T0, T1 for each tested host, generated docs, forbidden patterns
 *   plugin-kit docs           write the manifest-driven doc sections (--check: report drift only)
 *   plugin-kit record         record provider fixtures, then redact secrets and personal data
 *   plugin-kit conformance    the whole conformance report
 *   plugin-kit hosts          the OpenCode release matrix, [2.4.1]
 *   plugin-kit release <v>    checks, changelog, version, one commit, one tag; CI publishes it
 *   plugin-kit supported      this plugin's SUPPORTED.md row
 *   plugin-kit forbidden      app names, main-branch links, secrets
 *
 * Every command runs from a plugin directory, or with --dir. The kit is a devDependency: it is never bundled into a
 * plugin, and it calls `src/conformance.ts` for every check instead of keeping a check of its own.
 */
import { execFile } from "node:child_process"
import { resolve } from "node:path"
import { runCheck } from "./check.ts"
import { loadConformance, runConformance } from "./conformance.ts"
import { runDocs } from "./docs.ts"
import { runForbidden } from "./forbidden.ts"
import { runHosts } from "./hosts.ts"
import { runRecord } from "./record.ts"
import { runRelease } from "./release.ts"
import { runSupported } from "./supported.ts"
import type { CommandContext, ConformanceRunner, Git } from "./types.ts"
import { KitError } from "./types.ts"

/** The commands, for help and for a typo's next step. */
export const COMMANDS = ["check", "docs", "record", "conformance", "hosts", "release", "supported", "forbidden"] as const
export type Command = (typeof COMMANDS)[number]

/** The process's `git`: its exit code, stdout and stderr, never a throw for a failing command. */
const defaultGit: Git = (args, directory) =>
  new Promise((done) => {
    execFile("git", [...args], { cwd: directory, encoding: "utf8" }, (error, stdout, stderr) => {
      const numeric = error === null ? 0 : Number((error as NodeJS.ErrnoException).code)
      const code = Number.isFinite(numeric) && numeric !== 0 ? numeric : error === null ? 0 : 1
      done({ code, stdout: stdout ?? "", stderr: stderr ?? "" })
    })
  })

/** What a test may replace; everything else comes from the process. */
export interface MainOptions {
  readonly cwd?: string | undefined
  readonly stdout?: ((text: string) => void) | undefined
  readonly stderr?: ((text: string) => void) | undefined
  readonly conformance?: (() => Promise<ConformanceRunner>) | undefined
  readonly git?: Git | undefined
  readonly now?: (() => Date) | undefined
}

/** The help text, also what a missing command prints. */
export const HELP = `plugin-kit: the plugin contract's development kit

Usage: plugin-kit <command> [options]

Commands:
  check                     T0, T1 on every tested host, generated docs, forbidden patterns
  docs                      write the manifest-driven doc sections
  record                    record provider fixtures, then redact secrets and personal data
  conformance               run the whole conformance report
  hosts                     print the OpenCode release matrix
  release <version>         checks, changelog section, version, one commit and one tag
  supported                 print this plugin's SUPPORTED.md row
  forbidden                 check app names, main-branch links and secrets

Options:
  --dir <path>              the plugin directory (default: the working directory)
  --json                    print one JSON object instead of a report
  --help                    this text, or a command's options
  --host <release>          a host for check or conformance (repeatable)
  --check                   report drift only (docs, record)
  --account <alias>         the account a recording belongs to
  --record                  record while running conformance
  --dry-run                 write nothing (release)
  --wave <name>             the SUPPORTED.md wave cell
  --status <state>          the SUPPORTED.md status cell
`

interface Parsed {
  readonly command: Command
  readonly positionals: readonly string[]
  readonly flags: ReadonlyMap<string, string | true | readonly string[]>
}

const VALUE_FLAGS = new Set(["dir", "host", "account", "wave", "status"])
const BOOLEAN_FLAGS = new Set(["json", "check", "record", "dry-run", "help"])

function parse(argv: readonly string[]): Parsed | "help" {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) return "help"
  let command: string | undefined
  const positionals: string[] = []
  const flags = new Map<string, string | true | string[]>()
  const set = (name: string, value: string | true): void => {
    if (name === "host") {
      const hosts = (flags.get(name) as string[] | undefined) ?? []
      flags.set(name, [...hosts, String(value)])
      return
    }
    flags.set(name, value)
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1))
      break
    }
    if (!arg.startsWith("--")) {
      if (command === undefined) command = arg
      else positionals.push(arg)
      continue
    }
    const equals = arg.indexOf("=")
    const name = arg.slice(2, equals === -1 ? undefined : equals)
    const inline = equals === -1 ? undefined : arg.slice(equals + 1)
    if (BOOLEAN_FLAGS.has(name)) {
      if (inline !== undefined) throw usage(`--${name} takes no value`)
      flags.set(name, true)
      continue
    }
    if (!VALUE_FLAGS.has(name)) throw usage(`--${name} is not an option`)
    const value = inline ?? argv[++index]
    if (value === undefined || value.startsWith("--")) throw usage(`--${name} needs a value`)
    set(name, value)
  }
  if (command === undefined) return "help"
  if (!(COMMANDS as readonly string[]).includes(command)) throw usage(`"${command}" is not a command`)
  return { command: command as Command, positionals, flags }
}

const usage = (what: string): KitError => new KitError("KIT_USAGE", what, `run plugin-kit --help; commands are ${COMMANDS.join(", ")}`)

const flag = (parsed: Parsed, name: string): string | undefined => {
  const value = parsed.flags.get(name)
  return typeof value === "string" ? value : undefined
}

const bool = (parsed: Parsed, name: string): boolean => parsed.flags.get(name) === true

const hosts = (parsed: Parsed): string[] => {
  const value = parsed.flags.get("host")
  return Array.isArray(value) ? value : []
}

/** Run the command line and answer the process's exit code. */
export async function main(argv: readonly string[], options: MainOptions = {}): Promise<number> {
  const io = {
    stdout: options.stdout ?? ((text: string) => process.stdout.write(text)),
    stderr: options.stderr ?? ((text: string) => process.stderr.write(text)),
  }
  const wantsJson = argv.includes("--json")
  let parsed: Parsed | "help"
  try {
    parsed = parse(argv)
  } catch (error) {
    if (wantsJson) io.stdout(`${JSON.stringify(errorObject(error), null, 2)}\n`)
    else io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
  if (parsed === "help") {
    io.stdout(HELP)
    return 0
  }
  const context: CommandContext = {
    dir: resolve(options.cwd ?? process.cwd(), flag(parsed, "dir") ?? "."),
    io,
    conformance: options.conformance ?? (() => loadConformance()),
    git: options.git ?? defaultGit,
    now: options.now ?? (() => new Date()),
    json: bool(parsed, "json"),
  }
  try {
    const command = parsed.command
    if (command !== "release" && parsed.positionals.length > 0) throw usage(`${command} takes no positional arguments`)
    switch (command) {
      case "check":
        return await runCheck(context, { hosts: hosts(parsed) })
      case "docs":
        return await runDocs(context, { check: bool(parsed, "check") })
      case "record":
        return await runRecord(context, { account: flag(parsed, "account"), check: bool(parsed, "check") })
      case "conformance":
        return await runConformance(context, { hosts: hosts(parsed), record: bool(parsed, "record") })
      case "hosts":
        return await runHosts(context)
      case "release": {
        const version = parsed.positionals[0]
        if (version === undefined) throw usage("release needs a version, such as 0.0.0")
        if (parsed.positionals.length > 1) throw usage("release takes one version")
        return await runRelease(context, version, { dryRun: bool(parsed, "dry-run") })
      }
      case "supported":
        return await runSupported(context, { wave: flag(parsed, "wave"), status: flag(parsed, "status") })
      case "forbidden":
        return await runForbidden(context)
    }
  } catch (error) {
    if (context.json) io.stdout(`${JSON.stringify(errorObject(error), null, 2)}\n`)
    else if (error instanceof KitError) io.stderr(`${error.message}\n`)
    else io.stderr(`KIT_INTERNAL: ${error instanceof Error ? error.message : String(error)}. Next step: run plugin-kit --help, and report this with the plugin directory.\n`)
    return error instanceof KitError ? (error.code === "KIT_USAGE" ? 2 : 1) : 1
  }
}

/** A failure as `--json` prints it: one object on stdout, with the code, what happened and the next step. */
function errorObject(error: unknown): { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly next: string } } {
  if (error instanceof KitError) return { ok: false, error: { code: error.code, message: error.what, next: error.next } }
  return {
    ok: false,
    error: {
      code: "KIT_INTERNAL",
      message: error instanceof Error ? error.message : String(error),
      next: "run plugin-kit --help, and report this with the plugin directory",
    },
  }
}
