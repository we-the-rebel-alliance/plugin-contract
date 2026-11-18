/**
 * Hints and routines (#45 §4, §5): the two kinds of file a source plugin may ship beside its sources.
 *
 * A **hint** says how to read one kind of item: at most 1,500 characters, with a frontmatter of `source`, `kinds` and
 * `produces`, and a body Memory quotes inside its prompt. A **routine** is for a meaning Memory's core extractor cannot
 * find even with hints: frontmatter of `id`, `title`, `reads: { sources, kinds }` and `produces`, and a body of
 * instructions of at most 4,000 characters. Memory's first engine runs only its own core routines, with plugin hints
 * and facts; the routine format is defined now so that it is stable, and a plugin should ship one only later.
 *
 * Both are **data**. A hint's body is quoted, never obeyed, and a routine runs alone later. So neither may set one of
 * Memory's decisions: a hint may not `apply`, say `stated_by`, or name a `space`, a `budget` or a `priority`; a routine
 * may not set those either, nor a `tier`, a `schedule` or a `namespace`, which is the installed package's and never
 * declared. Both name only the plugin's own sources, and `produces` names only the core fact types.
 *
 * The frontmatter is a small, strict subset of YAML: one `key: value` a line, a flow list `[a, b]`, and a flow mapping
 * `{ k: v, k2: [a, b] }`. Nesting by indentation is refused, so a file never depends on a parser's quirks.
 */
import * as z from "zod"
import type { Validator } from "./internal/checked.ts"
import { FACT_TYPES, isEventKind, type FactType } from "./internal/events.ts"
import { validator } from "./internal/validator.ts"

/** The most characters a hint takes, frontmatter and body alike (#45 §4). */
export const HINT_MAX = 1500
/** The most characters a routine's instructions take (#45 §5). */
export const ROUTINE_BODY_MAX = 4000

/** The keys a hint's frontmatter may have (#45 §4). */
export const HINT_KEYS = ["source", "kinds", "produces"] as const
/** The keys a routine's frontmatter may have (#45 §5). */
export const ROUTINE_KEYS = ["id", "title", "reads", "produces"] as const

/**
 * The keys a hint may not set (#45 §4, §7): a hint is data, and Memory alone decides how its text is used, whose word
 * it states and where it lands.
 */
export const FORBIDDEN_HINT_KEYS = ["apply", "stated_by", "space", "budget", "priority"] as const
/**
 * The keys a routine may not set (#45 §5, §7): the namespace is the installed package's and never declared, and the
 * tier, schedule, budget, priority and apply mode are Memory's, as `stated_by` is.
 */
export const FORBIDDEN_ROUTINE_KEYS = ["tier", "schedule", "budget", "priority", "apply", "stated_by", "namespace"] as const

/** A source id, as a descriptor declares it: at least two dotted lowercase segments. */
const SOURCE_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/
/** A routine's id: a lowercase word. */
const ROUTINE_ID = /^[a-z][a-z0-9-]{0,63}$/
/** A frontmatter key: a lowercase word. */
const KEY = /^[a-z][a-z0-9_]*$/

const factType = z.enum(FACT_TYPES, { error: "must be a core fact type (commitment, person.attribute, meeting.attended)" })
const kind = z.string().max(64).refine(isEventKind, { error: "must be an event kind, such as meeting or x-<namespace>/<name>" })
const sourceId = z.string().max(64).regex(SOURCE_ID, { error: "must be a source id such as granola.meetings" })

/** A hint's frontmatter (#45 §4). */
const hintFrontmatter = z
  .object({
    source: sourceId.describe("One of the plugin's own source ids."),
    kinds: z.array(kind, { error: "must be a list such as [meeting]" }).min(1, "must name at least one kind"),
    produces: z.array(factType, { error: "must be a list such as [commitment]" }).min(1, "must name at least one core fact type").optional(),
  })
  .strict()

/** A routine's frontmatter (#45 §5). */
const routineFrontmatter = z
  .object({
    id: z.string().max(64).regex(ROUTINE_ID, { error: "must be a lowercase word such as meeting-actions" }),
    title: z.string().min(1).max(200),
    reads: z
      .object({
        sources: z.array(sourceId, { error: "must be a list such as [granola.meetings]" }).min(1, "must name at least one source").describe("The plugin's own sources only."),
        kinds: z.array(kind, { error: "must be a list such as [meeting]" }).min(1, "must name at least one kind"),
      })
      .strict(),
    produces: z.array(factType, { error: "must be a list such as [commitment]" }).min(1, "must name at least one core fact type"),
  })
  .strict()

/** What a hint's frontmatter is, once it keeps the contract (#45 §4). */
export interface HintFrontmatter {
  /** One of the plugin's own source ids. */
  readonly source: string
  /** The kinds of item it says how to read, each a core kind or `x-<namespace>/<name>`. */
  readonly kinds: readonly string[]
  /** The core fact types its text produces. */
  readonly produces?: readonly FactType[] | undefined
}

/** What a routine's frontmatter is, once it keeps the contract (#45 §5). */
export interface RoutineFrontmatter {
  /** The routine's id: a lowercase word, unique in the plugin. */
  readonly id: string
  readonly title: string
  /** The plugin's own sources and kinds it reads, and no other. */
  readonly reads: {
    readonly sources: readonly string[]
    readonly kinds: readonly string[]
  }
  readonly produces: readonly FactType[]
}

/** A hint's frontmatter schema, published as `dist/schemas/hint.json`. */
export const HINT_SCHEMA: Validator<HintFrontmatter> = validator("hint", hintFrontmatter)
/** A routine's frontmatter schema, published as `dist/schemas/routine.json`. */
export const ROUTINE_SCHEMA: Validator<RoutineFrontmatter> = validator("routine", routineFrontmatter)

/** A file read: the frontmatter it declares, and the body it keeps as it is. */
export interface Frontmatter {
  readonly frontmatter: Record<string, unknown>
  readonly body: string
}

/** A parsed value, or that the line holding it is not one this subset reads. */
type Parsed = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

/** A scalar: quoted, or bare and trimmed. */
function scalar(raw: string): Parsed {
  const text = raw.trim()
  if (text.startsWith('"') || text.startsWith("'")) {
    const quote = text[0]!
    if (text.length < 2 || !text.endsWith(quote)) return { ok: false }
    return { ok: true, value: text.slice(1, -1).replaceAll(`\\${quote}`, quote) }
  }
  if (text.startsWith("[") || text.startsWith("{")) return { ok: false }
  return { ok: true, value: text }
}

/** Split on commas that sit outside brackets and quotes. */
function splitTop(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ""
  let start = 0
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quote !== "") {
      if (char === quote) quote = ""
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === "[" || char === "{") depth++
    else if (char === "]" || char === "}") depth--
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim()).filter((part) => part !== "")
}

/** A value: a scalar, a flow list `[a, b]`, or a flow mapping `{ k: v }`, one level deep. */
function parseValue(raw: string): Parsed {
  const text = raw.trim()
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1)
    const items: unknown[] = []
    for (const part of splitTop(inner)) {
      const parsed = scalar(part)
      if (!parsed.ok) return parsed
      items.push(parsed.value)
    }
    return { ok: true, value: items }
  }
  if (text.startsWith("{") && text.endsWith("}")) {
    const inner = text.slice(1, -1)
    const entries: Record<string, unknown> = {}
    for (const part of splitTop(inner)) {
      const colon = part.indexOf(":")
      if (colon <= 0) return { ok: false }
      const key = part.slice(0, colon).trim()
      if (!KEY.test(key)) return { ok: false }
      const parsed = parseValue(part.slice(colon + 1))
      if (!parsed.ok) return parsed
      entries[key] = parsed.value
    }
    return { ok: true, value: entries }
  }
  return scalar(text)
}

/**
 * A hint or routine file's frontmatter and body, or why it has neither, one sentence each. `what` names the file in a
 * message ("hint", "routine", or "file" by default). The frontmatter opens with `---` on a line of its own, is one key
 * a line, and closes with `---`; the body is everything after it, trimmed.
 */
export function parseFrontmatter(text: string, what = "file"): { readonly ok: true; readonly value: Frontmatter } | { readonly ok: false; readonly problems: string[] } {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  if (lines[0] !== "---") return { ok: false, problems: [`the ${what} must begin with its frontmatter: --- on a line of its own`] }
  const close = lines.findIndex((line, index) => index > 0 && line === "---")
  if (close === -1) return { ok: false, problems: [`the ${what} has no closing --- line for its frontmatter`] }
  const frontmatter: Record<string, unknown> = {}
  const problems: string[] = []
  for (const [index, line] of lines.slice(1, close).entries()) {
    const at = index + 2
    if (line.trim() === "") continue
    if (/^[\s]/.test(line)) {
      problems.push(`the ${what}'s frontmatter line ${at} is indented: the frontmatter is one key a line`)
      continue
    }
    const colon = line.indexOf(":")
    const key = colon === -1 ? "" : line.slice(0, colon).trim()
    if (colon <= 0 || !KEY.test(key)) {
      problems.push(`the ${what}'s frontmatter line ${at} is not a key and its value`)
      continue
    }
    if (Object.hasOwn(frontmatter, key)) {
      problems.push(`the ${what}'s frontmatter line ${at} repeats the key "${key}"`)
      continue
    }
    const parsed = parseValue(line.slice(colon + 1))
    if (!parsed.ok) {
      problems.push(`the ${what}'s frontmatter line ${at} holds a value this contract does not read`)
      continue
    }
    frontmatter[key] = parsed.value
  }
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, value: { frontmatter, body: lines.slice(close + 1).join("\n").trim() } }
}

/** What `hintProblems` and `routineProblems` need: the plugin's own source ids, which a file may name and no other. */
export interface FileOptions {
  /** Every source id the plugin declares: a hint names one of them, and a routine reads one of them. */
  readonly sources: readonly string[]
}

/** The unknown keys of a frontmatter, each in the form that names the file. */
function keyProblems(frontmatter: Record<string, unknown>, known: readonly string[], forbidden: readonly string[], what: string, why: string): string[] {
  const problems: string[] = []
  for (const key of Object.keys(frontmatter)) {
    if (known.includes(key)) continue
    if (forbidden.includes(key)) problems.push(`the ${what} sets "${key}", which a ${what} may not set: ${why}`)
    else problems.push(`the ${what} has the key "${key}", which a ${what} does not have (${known.join(", ")})`)
  }
  return problems
}

const HINT_WHY = "a hint is data, and Memory decides how its text is used"
const ROUTINE_WHY = "the namespace, the tier, the schedule, the budget, the priority and the apply mode are Memory's"

/**
 * A hint file's problems (#45 §4), one sentence each; none when it keeps the contract. A hint is at most 1,500
 * characters; its frontmatter has the known keys only and no key of Memory's; its `source` is one of the plugin's own;
 * and its `produces` names core fact types only.
 */
export function hintProblems(text: unknown, options: FileOptions): string[] {
  if (typeof text !== "string") return ["the hint is not text"]
  const problems: string[] = []
  if (text.length > HINT_MAX) problems.push(`the hint is ${text.length} characters, over the ${HINT_MAX} a hint may take`)
  const parsed = parseFrontmatter(text, "hint")
  if (!parsed.ok) return [...problems, ...parsed.problems]
  const keys = keyProblems(parsed.value.frontmatter, HINT_KEYS, FORBIDDEN_HINT_KEYS, "hint", HINT_WHY)
  if (keys.length > 0) return [...problems, ...keys]
  const checked = HINT_SCHEMA.check(parsed.value.frontmatter)
  if (!checked.ok) return [...problems, ...checked.problems]
  if (!options.sources.includes(checked.value.source)) problems.push(`the hint names the source "${checked.value.source}", which is not one of the plugin's own`)
  return problems
}

/**
 * A routine file's problems (#45 §5), one sentence each; none when it keeps the contract. Its instructions are at most
 * 4,000 characters; its frontmatter has the known keys only and no key of Memory's; it reads only the plugin's own
 * sources; and its `produces` names core fact types only.
 */
export function routineProblems(text: unknown, options: FileOptions): string[] {
  if (typeof text !== "string") return ["the routine is not text"]
  const problems: string[] = []
  const parsed = parseFrontmatter(text, "routine")
  if (!parsed.ok) return parsed.problems
  if (parsed.value.body.length > ROUTINE_BODY_MAX) problems.push(`the routine's body is ${parsed.value.body.length} characters, over the ${ROUTINE_BODY_MAX} its instructions may take`)
  const keys = keyProblems(parsed.value.frontmatter, ROUTINE_KEYS, FORBIDDEN_ROUTINE_KEYS, "routine", ROUTINE_WHY)
  if (keys.length > 0) return [...problems, ...keys]
  const checked = ROUTINE_SCHEMA.check(parsed.value.frontmatter)
  if (!checked.ok) return [...problems, ...checked.problems]
  for (const source of checked.value.reads.sources) {
    if (!options.sources.includes(source)) problems.push(`the routine reads the source "${source}", which is not one of the plugin's own`)
  }
  return problems
}
