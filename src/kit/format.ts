/**
 * Markdown the kit generates: one table, one code span, one cell that never breaks the table.
 *
 * Generated text goes between the `<!-- kit:start:… -->` markers in a doc, so it must be plain and deterministic: the
 * same manifest always makes the same bytes, and a diff is a manifest change.
 */

/** A table cell: pipes escaped, newlines folded, and an empty value shown as an em dash. */
export function cell(value: unknown): string {
  const text = value === undefined || value === null || value === "" ? "—" : String(value)
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim()
}

/** A value as inline code, with backticks inside it escaped by doubling them. */
export function code(value: unknown): string {
  return `\`${String(value).replace(/`/g, "``")}\``
}

/** A list as cells, or an em dash when it is empty. */
export function list(values: readonly string[] | undefined, render: (value: string) => string = code): string {
  if (values === undefined || values.length === 0) return "—"
  return values.map(render).join(", ")
}

/** A markdown table with a header row, a rule, and one row per entry. */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const head = `| ${headers.map(cell).join(" | ")} |`
  const rule = `| ${headers.map(() => "---").join(" | ")} |`
  return [head, rule, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n")
}

/** Minutes as a cadence a person reads: `2 min`, `1 hour`, `1 day`. */
export function cadence(minutes: number | undefined): string {
  if (minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return "—"
  if (minutes < 60) return `${minutes} min`
  if (minutes < 60 * 24) {
    const hours = minutes / 60
    return Number.isInteger(hours) ? `${hours} hour${hours === 1 ? "" : "s"}` : `${Math.round(minutes)} min`
  }
  const days = minutes / (60 * 24)
  return Number.isInteger(days) ? `${days} day${days === 1 ? "" : "s"}` : `${Math.round(minutes / 60)} hours`
}

/** A JSON Schema's type, as a table shows it: `string`, `"a" | "b"`, `string[]`, or `object`. */
export function schemaType(schema: unknown): string {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return "any"
  const value = schema as Record<string, unknown>
  const literal = value["const"]
  if (typeof literal === "string") return code(literal)
  const values = value["enum"]
  if (Array.isArray(values) && values.length > 0) return values.map((entry) => (typeof entry === "string" ? code(entry) : cell(entry))).join(" | ")
  const anyOf = value["anyOf"] ?? value["oneOf"]
  if (Array.isArray(anyOf) && anyOf.length > 0) return anyOf.map((entry) => schemaType(entry)).join(" | ")
  const type = value["type"]
  if (Array.isArray(type)) return type.map(String).join(" | ")
  if (type === "array") {
    const items = schemaType(value["items"])
    return items.includes("|") ? `(${items})[]` : `${items}[]`
  }
  if (type === "object") {
    const properties = value["properties"]
    if (typeof properties === "object" && properties !== null) return "object"
    const additional = value["additionalProperties"]
    if (typeof additional === "object" && additional !== null) return "map"
    return "object"
  }
  if (typeof type === "string") return type
  const ref = value["$ref"]
  if (typeof ref === "string") return code(ref)
  return "any"
}

/** A JSON value as a table shows it: inline JSON, or an em dash when not stated. */
export function jsonValue(value: unknown): string {
  if (value === undefined) return "—"
  if (typeof value === "string") return code(value)
  if (typeof value === "number" || typeof value === "boolean" || value === null) return code(String(value))
  return code(JSON.stringify(value))
}

/** One property of an object JSON Schema, as a configuration table needs it. */
export interface SchemaProperty {
  readonly name: string
  readonly type: string
  readonly required: boolean
  readonly default: string
  readonly description: string
}

/** The top-level properties of an object JSON Schema, in the order the schema states them. */
export function schemaProperties(schema: unknown): SchemaProperty[] {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return []
  const value = schema as Record<string, unknown>
  const properties = value["properties"]
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) return []
  const required = new Set(Array.isArray(value["required"]) ? (value["required"] as unknown[]).filter((item): item is string => typeof item === "string") : [])
  return Object.entries(properties as Record<string, unknown>).map(([name, property]) => {
    const record = typeof property === "object" && property !== null && !Array.isArray(property) ? (property as Record<string, unknown>) : {}
    return {
      name,
      type: schemaType(record),
      required: required.has(name),
      default: jsonValue(record["default"]),
      description: typeof record["description"] === "string" ? record["description"] : typeof record["title"] === "string" ? record["title"] : "—",
    }
  })
}
