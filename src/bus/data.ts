/**
 * Payload checking and secret screening for the three bus events (contract §10, §13).
 *
 * Both sides use the same checks: the writer refuses a payload before it reaches the host, and the reader refuses one
 * an app receives from anywhere else. A refusal names fields and never values, so a malformed payload cannot echo a
 * secret into a log.
 */
import { secretKinds } from "../internal/secrets.ts"
import { BUS_STATES, capabilityPattern, REASON_MAX, type BusEventData, type BusEventName, type BusState } from "./definition.ts"

/** A payload checked: the event's data, or every problem, one sentence each. */
export type CheckedData<K extends BusEventName> =
  | { readonly ok: true; readonly value: BusEventData[K] }
  | { readonly ok: false; readonly problems: readonly string[] }

/** The JSON text of a value, or `undefined` when the value is not JSON (a function, a BigInt, a cycle). */
export function serialise(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

/** Whether JSON text holds a secret the contract's detector knows (contract §13). */
export function holdsSecret(text: string): boolean {
  return secretKinds(text).length > 0
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The payload must be an object with exactly `fields`; a missing field and an extra one are both problems. */
function shape(value: unknown, fields: readonly string[], problems: string[]): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) {
    problems.push("data: must be an object")
    return undefined
  }
  for (const field of fields) if (!Object.hasOwn(value, field)) problems.push(`data.${field}: is required`)
  for (const key of Object.keys(value)) if (!fields.includes(key)) problems.push(`data.${key}: is not a field of this event`)
  return value
}

/** A string field, checked only when it is present, so a missing field is reported once. */
function text(
  value: Readonly<Record<string, unknown>>,
  field: string,
  problems: string[],
  options: { readonly pattern?: RegExp; readonly min?: number; readonly max?: number; readonly expectation: string },
): string | undefined {
  if (!Object.hasOwn(value, field)) return undefined
  const found = value[field]
  if (typeof found !== "string") {
    problems.push(`data.${field}: must be a string`)
    return undefined
  }
  if (found.length < (options.min ?? 1)) {
    problems.push(`data.${field}: must not be empty`)
    return undefined
  }
  if (found.length > (options.max ?? Number.POSITIVE_INFINITY)) {
    problems.push(`data.${field}: must be at most ${options.max} characters`)
    return undefined
  }
  if (options.pattern !== undefined && !options.pattern.test(found)) {
    problems.push(`data.${field}: must be ${options.expectation}`)
    return undefined
  }
  return found
}

const ACCOUNT = /^[a-z][a-z0-9_]{0,31}$/
const ONE_LINE = /^[^\r\n]+$/

function account(value: Readonly<Record<string, unknown>>, problems: string[]): string | undefined {
  return text(value, "account", problems, {
    pattern: ACCOUNT,
    expectation: "an account alias: lowercase letters, digits and underscores, starting with a letter (contract §5)",
  })
}

function state(value: Readonly<Record<string, unknown>>, problems: string[]): BusState | undefined {
  if (!Object.hasOwn(value, "state")) return undefined
  const found = value["state"]
  if (typeof found !== "string" || !(BUS_STATES as readonly string[]).includes(found)) {
    problems.push(`data.state: must be one of ${BUS_STATES.join(", ")}`)
    return undefined
  }
  return found as BusState
}

/**
 * Check one event's data against contract §10. The writer and the reader both call it, so a payload the writer accepts
 * is exactly one the reader accepts.
 */
export function checkBusData<K extends BusEventName>(name: string, event: K, value: unknown): CheckedData<K> {
  const problems: string[] = []
  if (event === "changed") {
    const record = shape(value, ["capability", "account", "reason"], problems)
    if (record !== undefined) {
      const capability = text(record, "capability", problems, {
        pattern: new RegExp(capabilityPattern(name)),
        expectation: `this plugin's capability id, ${name}.<capability>`,
      })
      const alias = account(record, problems)
      const reason = text(record, "reason", problems, {
        pattern: ONE_LINE,
        max: REASON_MAX,
        expectation: `1 to ${REASON_MAX} characters on one line`,
      })
      if (problems.length === 0 && capability !== undefined && alias !== undefined && reason !== undefined) {
        return { ok: true, value: { capability, account: alias, reason } as BusEventData[K] }
      }
    }
  } else if (event === "status") {
    const record = shape(value, ["state"], problems)
    if (record !== undefined) {
      const found = state(record, problems)
      if (problems.length === 0 && found !== undefined) return { ok: true, value: { state: found } as BusEventData[K] }
    }
  } else {
    const record = shape(value, ["account", "state"], problems)
    if (record !== undefined) {
      const alias = account(record, problems)
      const found = state(record, problems)
      if (problems.length === 0 && alias !== undefined && found !== undefined) {
        return { ok: true, value: { account: alias, state: found } as BusEventData[K] }
      }
    }
  }
  return { ok: false, problems }
}
