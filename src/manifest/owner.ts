/**
 * A probe owner and its organizations (#44 item 2, contract §5 and §11).
 *
 * `probe({ account })` answers `{ account, owner: { id, label, verified?, orgs? } }`. The owner's `id` is
 * scheme-qualified, and `orgs` names at most five organizations the provider says the account belongs to, each with a
 * scheme-qualified id. A consumer checks its allow list against the `id`s; it never parses the owner's own id to work
 * out an organization. `verified: false` on the owner covers its `orgs` too.
 */
import { OWNER_ORGS_LIMIT } from "./types.ts"

/** A scheme-qualified id: `mailto:ana@example.com`, `domain:example.com`, `slack-team:T0123`. */
export const SCHEME_QUALIFIED = /^[a-z][a-z0-9+.-]*:\S+$/

/** One line: no control character, no line break. */
const line = (value: unknown, max: number, empty = false): value is string =>
  typeof value === "string" && value.length <= max && (empty || value.length > 0) && ![...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)

const plainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The problems with an owner's `orgs`, one sentence each; none when absent or valid. */
export function ownerOrgProblems(orgs: unknown, what = "owner.orgs"): string[] {
  if (orgs === undefined) return []
  if (!Array.isArray(orgs)) return [`${what} must be a list of at most ${OWNER_ORGS_LIMIT} organizations`]
  if (orgs.length > OWNER_ORGS_LIMIT) return [`${what} must name at most ${OWNER_ORGS_LIMIT} organizations`]
  const problems: string[] = []
  const seen = new Set<string>()
  for (const [index, org] of orgs.entries()) {
    const at = `${what}[${index}]`
    if (!plainObject(org)) {
      problems.push(`${at} is not an object`)
      continue
    }
    for (const key of Object.keys(org)) {
      if (key !== "id" && key !== "label") problems.push(`${at} has the field "${key}", which an organization does not define`)
    }
    const id = org["id"]
    if (typeof id !== "string" || !SCHEME_QUALIFIED.test(id)) problems.push(`${at}.id must be a scheme-qualified id such as domain:example.com or slack-team:T0123`)
    else if (seen.has(id)) problems.push(`${at}.id repeats an organization`)
    else seen.add(id)
    if (!line(org["label"], 200)) problems.push(`${at}.label must be one non-empty line of at most 200 characters`)
  }
  return problems
}

/**
 * The problems with a probe owner, one sentence each; none when it keeps the contract. `what` is the sentence's
 * subject, such as `the probe answer's owner`.
 */
export function ownerProblems(owner: unknown, what = "the owner"): string[] {
  if (!plainObject(owner)) return [`${what} must be an object with an id and a label`]
  const problems: string[] = []
  for (const key of Object.keys(owner)) {
    if (!["id", "label", "verified", "orgs"].includes(key)) problems.push(`${what} has the field "${key}", which the contract does not define`)
  }
  const id = owner["id"]
  if (typeof id !== "string" || id.length > 320) problems.push(`${what}.id must be 1 to 320 characters`)
  else if (!SCHEME_QUALIFIED.test(id)) problems.push(`${what}.id must be a scheme-qualified id such as mailto:someone@example.com or slack:U0123`)
  if (!line(owner["label"], 200)) problems.push(`${what}.label must be one non-empty line of at most 200 characters`)
  if (owner["verified"] !== undefined && owner["verified"] !== false) problems.push(`${what}.verified must be false, or left out for an owner the provider named`)
  problems.push(...ownerOrgProblems(owner["orgs"], `${what}.orgs`))
  return problems
}
