/**
 * The three core fact schemas, in zod, so `npm run build` publishes each as `dist/schemas/fact.<type>.json`.
 *
 * A fact is derived in a plugin's code from provider fields, never from free text, and it is declared by type in the
 * manifest's `facts`. Each schema is a closed shape (`additionalProperties: false`): a fact carries no version, since a
 * consumer stamps the installed package's version on each fact it files, and none has a field for a sensitive trait.
 *
 * The plain types and the checks a runtime makes are `events`': `EventFact`, `factProblems` and `eventProblems`.
 */
import * as z from "zod"
import { ATTENDANCE_RESPONSES, COMMITMENT_STATES, EVENT_LIMITS, type FactType } from "../events.ts"
import type { Validator } from "../checked.ts"
import { validator } from "../validator.ts"

const actorId = z.string().min(1).max(EVENT_LIMITS.actorId).describe("An actor id on the same event.")
const httpsUrl = z
  .string()
  .max(EVENT_LIMITS.url)
  .refine((value) => /^https:\/\/\S+$/.test(value), { error: "must be an https URL" })

const commitment = z
  .object({
    type: z.literal("commitment"),
    key: z.string().min(1).max(EVENT_LIMITS.factKey).describe("A stable id of this commitment within the source and account."),
    title: z.string().min(1).max(EVENT_LIMITS.factTitle),
    owner: actorId,
    counterparty: actorId.optional(),
    due: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "must be a date such as 2026-11-30" })
      .optional(),
    state: z.enum(COMMITMENT_STATES),
    url: httpsUrl.optional(),
  })
  .strict()

const personAttribute = z
  .object({
    type: z.literal("person.attribute"),
    actor: actorId,
    org: z.string().min(1).max(EVENT_LIMITS.factAttribute).optional(),
    team: z.string().min(1).max(EVENT_LIMITS.factAttribute).optional(),
    role: z.string().min(1).max(EVENT_LIMITS.factAttribute).optional(),
  })
  .strict()
  .refine((value) => value.org !== undefined || value.team !== undefined || value.role !== undefined, {
    error: "must name org, team or role: a person's attribute comes from structured profile or directory data",
  })
  .describe("A person's attribute, from structured profile or directory data only: at least one of org, team or role.")

const meetingAttended = z
  .object({
    type: z.literal("meeting.attended"),
    actor: actorId,
    response: z.enum(ATTENDANCE_RESPONSES),
    organizer: z.boolean(),
  })
  .strict()

/** Every core fact type's schema, by the type name a descriptor declares. */
export const FACT_SCHEMAS = {
  commitment: validator("fact.commitment", commitment),
  "person.attribute": validator("fact.person.attribute", personAttribute),
  "meeting.attended": validator("fact.meeting.attended", meetingAttended),
}

/** The schema of a core fact type, or undefined for a type the contract does not have. */
export function factSchema(type: string): Validator<unknown> | undefined {
  return Object.hasOwn(FACT_SCHEMAS, type) ? FACT_SCHEMAS[type as FactType] : undefined
}
