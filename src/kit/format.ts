/**
 * The small formatters the kit's `SUPPORTED.md` row uses. Rendering a plugin's docs belongs to the conformance module,
 * not here.
 */

/** A value as inline code. */
export function code(value: unknown): string {
  return `\`${String(value).replace(/`/g, "``")}\``
}

/** A list as cells, or an em dash when it is empty. */
export function list(values: readonly string[] | undefined, render: (value: string) => string = code): string {
  if (values === undefined || values.length === 0) return "—"
  return values.map(render).join(", ")
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
