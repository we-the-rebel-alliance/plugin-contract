/**
 * Payload serialisation and secret screening for the three bus events (contract §13).
 *
 * Both sides use the same path: the writer refuses a secret before it reaches the host, and the reader refuses one an
 * app receives from anywhere else. A refusal names no value, so a malformed payload cannot echo a secret into a log.
 */
import { secretKinds } from "../internal/secrets.ts"

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
