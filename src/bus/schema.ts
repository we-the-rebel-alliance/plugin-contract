/**
 * The one schema source for the bus events: each event's data is a zod schema, and the same validators provide both
 * the payload check (`checkBusData`) and the JSON Schema in the events block (`busEvents`).
 *
 * The JSON Schema carries the shape the host can enforce without a regular expression: the object is closed, its
 * fields are required, `state` is an enum and `reason` has its length bounds. The alias, capability and one-line rules
 * stay zod refinements, because OpenCode 2.4.1's JSON Schema conversion disables `pattern` by default and would fail
 * every emit if one appeared in the schema. The writer and the reader always apply the full validator.
 */
import * as z from "zod"
import { validator, type Validator } from "../internal/validator.ts"
import {
  ACCOUNT_ALIAS,
  assertPluginName,
  BUS_EVENTS,
  BUS_STATES,
  capabilityPattern,
  ONE_LINE,
  REASON_MAX,
  type AccountData,
  type BusEventData,
  type BusEventName,
  type BusEvents,
  type BusSchema,
  type ChangedData,
  type StatusData,
} from "./definition.ts"

/** A payload checked: the event's data, or every problem, one sentence each. */
export type CheckedData<K extends BusEventName> =
  | { readonly ok: true; readonly value: BusEventData[K] }
  | { readonly ok: false; readonly problems: readonly string[] }

/** The three validators for one plugin: the alias and capability rules depend on the name. */
interface BusValidators {
  readonly changed: Validator<ChangedData>
  readonly status: Validator<StatusData>
  readonly account: Validator<AccountData>
}

const ACCOUNT = new RegExp(ACCOUNT_ALIAS)
const ONE_LINE_RE = new RegExp(ONE_LINE)
const ACCOUNT_EXPECTATION = "must be an account alias: lowercase letters, digits and underscores, starting with a letter (contract §5)"

function validatorsFor(name: string): BusValidators {
  const capability = new RegExp(capabilityPattern(name))
  const changed = z
    .object({
      capability: z.string().refine((value) => capability.test(value), { error: `must be this plugin's capability id, ${name}.<capability>` }),
      account: z.string().min(1).max(32).refine((value) => ACCOUNT.test(value), { error: ACCOUNT_EXPECTATION }),
      reason: z
        .string()
        .min(1, { error: "must not be empty" })
        .max(REASON_MAX, { error: `must be at most ${REASON_MAX} characters` })
        .refine((value) => ONE_LINE_RE.test(value), { error: `must be 1 to ${REASON_MAX} characters on one line` }),
    })
    .strict()
  const status = z.object({ state: z.enum([...BUS_STATES]) }).strict()
  const account = z.object({ account: z.string().min(1).max(32).refine((value) => ACCOUNT.test(value), { error: ACCOUNT_EXPECTATION }), state: z.enum([...BUS_STATES]) }).strict()
  return {
    changed: validator("bus.changed", changed),
    status: validator("bus.status", status),
    account: validator("bus.account", account),
  }
}

const cache = new Map<string, BusValidators>()

/** The three validators for one plugin, built once. The name is refused when it breaks contract §3. */
function busValidators(name: string): BusValidators {
  assertPluginName(name)
  const existing = cache.get(name)
  if (existing !== undefined) return existing
  const built = validatorsFor(name)
  cache.set(name, built)
  return built
}

/** The JSON Schema of one validator, checked to be the closed object every bus event declares. */
function schemaOf(validator: Validator<unknown>): BusSchema {
  const schema = validator.jsonSchema()
  if (schema["type"] !== "object" || schema["additionalProperties"] !== false) {
    throw new Error("bus: an event schema must be a closed object")
  }
  return schema as BusSchema
}

/**
 * The events block a plugin merges into its single RPC registration:
 *
 *   const registration = await ctx.rpc.register({ id: name, methods, events: busEvents(name) }, handlers)
 *   const bus = createBus(name, registration)
 */
export function busEvents(name: string): BusEvents {
  const validators = busValidators(name)
  return {
    changed: { schema: schemaOf(validators.changed) },
    status: { schema: schemaOf(validators.status) },
    account: { schema: schemaOf(validators.account) },
  }
}

/** Check one event's data against contract §10. The writer and the reader both use this one validator. */
export function checkBusData<K extends BusEventName>(name: string, event: K, value: unknown): CheckedData<K> {
  if (!(BUS_EVENTS as readonly string[]).includes(event)) {
    return { ok: false, problems: ["event: must be one of changed, status, account"] }
  }
  const checked = busValidators(name)[event].check(value)
  return checked.ok ? { ok: true, value: checked.value as BusEventData[K] } : checked
}
