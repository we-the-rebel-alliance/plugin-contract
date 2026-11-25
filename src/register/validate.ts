/**
 * Input and output validation for the register (contract §6 and §12).
 *
 * A method's handler declares the JSON Schema of its input and answer; the register checks them against that schema
 * before the handler runs and after it answers. `plans` and `commits` add the contract's two shapes: a plan answers
 * exactly `{ planId, method }`, and a commit takes exactly `{ planId }` from its planning method.
 *
 * The schemas stay plain JSON: a consumer reads them over RPC and a plugin's own docs generate from them. zod is used
 * inside only, through `z.fromJSONSchema`, so no public type names it.
 */
import * as z from "zod"
import type { Checked } from "../internal/checked.ts"
import type { JsonSchema } from "../manifest.ts"
import { problemsOf } from "../internal/validator.ts"

/**
 * The plan's answer (contract §6 and §8): the id of the dry-run, the method that commits it, and the preview fields a
 * person sees before confirming: output, reaches, changes, cost and trust.
 */
export const PLAN_OUTPUT: JsonSchema = {
  type: "object",
  properties: {
    planId: { type: "string", minLength: 1 },
    method: { type: "string", minLength: 1 },
    output: {},
    reaches: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: { id: { type: "string", minLength: 1, maxLength: 320 }, label: { type: "string", maxLength: 200 } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    changes: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 500 } },
    cost: {},
    trust: { type: "string", enum: ["untrusted"] },
  },
  required: ["planId", "method"],
  additionalProperties: false,
}

/** What a commit accepts from its planning method: the plan id, and nothing else. The grant names the account. */
export const COMMIT_INPUT: JsonSchema = {
  type: "object",
  properties: { planId: { type: "string", minLength: 1 } },
  required: ["planId"],
  additionalProperties: false,
}

const reach = z.strictObject({ id: z.string().min(1).max(320), label: z.string().max(200).optional() })
const plan = z.strictObject({
  planId: z.string().min(1),
  method: z.string().min(1),
  output: z.unknown().optional(),
  reaches: z.array(reach).max(20).optional(),
  changes: z.array(z.string().min(1).max(500)).max(20).optional(),
  cost: z.unknown().optional(),
  trust: z.literal("untrusted").optional(),
})
const commit = z.strictObject({ planId: z.string().min(1) })

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** A JSON Schema converted once, or the reason it is not one this package can check. */
function codecOf(schema: JsonSchema): { ok: true; codec: z.ZodType } | { ok: false; problem: string } {
  try {
    return { ok: true, codec: z.fromJSONSchema(schema as never) }
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The problems with a handler's declared schema: it must be an object schema, so the register can add `account` and
 * address a call's fields, and it must be a JSON Schema this package can check.
 */
export function inputSchemaProblems(schema: unknown): string[] {
  if (!plain(schema)) return ["the input schema must be an object"]
  if (schema["type"] !== "object") return ['the input schema must have type: "object"']
  const codec = codecOf(schema as JsonSchema)
  return codec.ok ? [] : [`the input schema is not a JSON Schema this package can check: ${codec.problem}`]
}

/** The problems with a handler's declared answer schema. */
export function outputSchemaProblems(schema: unknown): string[] {
  if (!plain(schema)) return ["the output schema must be an object"]
  const codec = codecOf(schema as JsonSchema)
  return codec.ok ? [] : [`the output schema is not a JSON Schema this package can check: ${codec.problem}`]
}

/** The value checked against one JSON Schema, or every problem named by its path. */
export function validate(schema: JsonSchema, value: unknown): Checked<unknown> {
  const codec = codecOf(schema)
  if (!codec.ok) return { ok: false, problems: [`the schema is not a JSON Schema this package can check: ${codec.problem}`] }
  const result = codec.codec.safeParse(value)
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: problemsOf(result.error) }
}

/** The plan's answer, checked: exactly the id and the method that commits it. */
export function validatePlan(value: unknown): Checked<{ planId: string; method: string }> {
  const result = plan.safeParse(value)
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: problemsOf(result.error) }
}

/** A commit's input, checked: exactly `{ planId }`. */
export function validateCommitInput(value: unknown): Checked<{ planId: string }> {
  const result = commit.safeParse(value)
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: problemsOf(result.error) }
}

/**
 * The tool's input schema: the handler's own, with `account` added for a method declared `accounts: "optional"`. A
 * method declared `accounts: "none"` must not declare one.
 */
export function toolInputSchema(item: { readonly accounts?: "optional" | "none" | undefined; readonly commits?: string | undefined }, handlerInput: JsonSchema): JsonSchema {
  // A commit takes exactly { planId }; the grant names the account, so no account property is added.
  if (item.commits !== undefined) return COMMIT_INPUT
  const base = handlerInput
  const properties = plain(base["properties"]) ? { ...(base["properties"] as Record<string, unknown>) } : {}
  const required = Array.isArray(base["required"]) ? [...(base["required"] as unknown[])] : []
  const declaresAccount = Object.hasOwn(properties, "account") || required.includes("account")
  if (item.accounts === "optional") {
    if (declaresAccount) throw new Error("register: a method with accounts: optional gets account from the register; remove it from the handler's input schema")
    // No `pattern`: OpenCode 2.4.1 disables JSON Schema patterns unless a schema is trusted. `accounts` checks the
    // alias instead, and the description tells the model what one looks like.
    properties["account"] = { type: "string", description: "The account alias, such as work; omit it when the plugin has one account." }
  } else if (declaresAccount) {
    throw new Error('register: a method with accounts: none cannot take an account; remove account from the handler\'s input schema')
  }
  return { ...base, type: "object", properties, ...(required.length === 0 ? {} : { required }) }
}
