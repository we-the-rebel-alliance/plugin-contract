/**
 * Hints (contract §7, `hints`): the one kind of file a source plugin may ship beside its sources.
 *
 * A **hint** says how to read one kind of item: at most 1,500 characters, with a frontmatter of `source`, `kinds` and
 * `produces`, and a body a model-based consumer may quote in a prompt. It is **data**: the consumer decides how its
 * text is used. So a hint may not set one of the consumer's decisions — how to apply it, whose word it states, or
 * where it lands — and it names only the plugin's own sources. `produces` names a knowledge type a model may extract,
 * which is not a structured fact type of `facts[]`: a plugin derives a fact in code, while a hint only helps a model
 * find a piece of knowledge.
 *
 * The frontmatter is a small, strict subset of YAML: one `key: value` a line, a flow list `[a, b]`, and a flow mapping
 * `{ k: v, k2: [a, b] }`. Nesting by indentation is refused, so a file never depends on a parser's quirks.
 */
import * as z from "zod"
import type { Validator } from "./internal/checked.ts"
import { isEventKind } from "./internal/events.ts"
import { validator } from "./internal/validator.ts"

/** The most characters a hint takes, frontmatter and body alike. */
export const HINT_MAX = 1500

/** The keys a hint's frontmatter may have. */
export const HINT_KEYS = ["source", "kinds", "produces"] as const

/**
 * The keys a hint may not set: how the consumer applies it, whose word it states, and where it lands are the
 * consumer's decisions, never the plugin's.
 */
export const FORBIDDEN_HINT_KEYS = ["apply", "stated_by", "space", "budget", "priority"] as const

/**
 * The knowledge types `produces` may name: what a model-based consumer may extract with the hint's help. They are a
 * different list from the structured fact types of `facts[]`: a plugin derives a fact in code, while a hint only helps
 * a model find a piece of knowledge. A type the consumer derives itself is never a `produces` value.
 */
export const PRODUCES_TYPES = ["commitment", "decision", "fact", "preference", "constraint", "person", "project"] as const
export type ProducesType = (typeof PRODUCES_TYPES)[number]

/** `PRODUCES_TYPES` as a sentence reads the list. */
const PRODUCES_LIST = "commitment, decision, fact, preference, constraint, person or project"

/** A source id, as a manifest declares it: at least two dotted lowercase segments. */
const SOURCE_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/
/** A frontmatter key: a lowercase word. */
const KEY = /^[a-z][a-z0-9_]*$/

const producesType = z.enum(PRODUCES_TYPES, { error: `must be a knowledge type (${PRODUCES_LIST})` })
const kind = z.string().max(64).refine(isEventKind, { error: "must be an event kind, such as meeting or x-<namespace>/<name>" })
const sourceId = z.string().max(64).regex(SOURCE_ID, { error: "must be a source id such as acme.meetings" })

/** A hint's frontmatter. */
const hintFrontmatter = z
  .object({
    source: sourceId.describe("One of the plugin's own source ids."),
    kinds: z.array(kind, { error: "must be a list such as [meeting]" }).min(1, "must name at least one kind"),
    produces: z.array(producesType, { error: "must be a list such as [commitment]" }).min(1, "must name at least one type").optional(),
  })
  .strict()

/** What a hint's frontmatter is, once it keeps the contract. */
export interface HintFrontmatter {
  /** One of the plugin's own source ids. */
  readonly source: string
  /** The kinds of item it says how to read, each a core kind or `x-<namespace>/<name>`. */
  readonly kinds: readonly string[]
  /** The knowledge types its text helps a model find. */
  readonly produces?: readonly ProducesType[] | undefined
}

/** A hint's frontmatter schema, published as `dist/schemas/hint.json`. */
export const HINT_SCHEMA: Validator<HintFrontmatter> = validator("hint", hintFrontmatter)

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
 * A hint file's frontmatter and body, or why it has neither, one sentence each. `what` names the file in a message
 * ("hint" by default). The frontmatter opens with `---` on a line of its own, is one key a line, and closes with
 * `---`; the body is everything after it, trimmed.
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

/** What `hintProblems` needs: the plugin's own source ids, which a file may name and no other. */
export interface FileOptions {
  /** Every source id the plugin declares: a hint names one of them. */
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

const HINT_WHY = "a hint is data, and the consumer decides how its text is used"

/**
 * A hint file's problems, one sentence each; none when it keeps the contract. A hint is at most 1,500 characters; its
 * frontmatter has the known keys only and no key of the consumer's; its `source` is one of the plugin's own; and its
 * `produces` names a knowledge type a model may extract and no other.
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
