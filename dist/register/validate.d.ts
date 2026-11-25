import type { Checked } from "../internal/checked.js";
import type { JsonSchema } from "../manifest.js";
/**
 * The public plan answer (contract §6 and §8): the `planId` the register minted, the method that commits it, and the
 * preview fields a person sees before confirming: output, reaches, changes, cost and trust.
 */
export declare const PLAN_OUTPUT: JsonSchema;
/** What a commit accepts from its planning method: the plan id, and nothing else. The grant names the account. */
export declare const COMMIT_INPUT: JsonSchema;
/**
 * The problems with a handler's declared schema: it must be an object schema, so the register can add `account` and
 * address a call's fields, and it must be a JSON Schema this package can check.
 */
export declare function inputSchemaProblems(schema: unknown): string[];
/** The problems with a handler's declared answer schema. */
export declare function outputSchemaProblems(schema: unknown): string[];
/** The value checked against one JSON Schema, or every problem named by its path. */
export declare function validate(schema: JsonSchema, value: unknown): Checked<unknown>;
/**
 * The plan handler's answer, checked: a committing method, the preview fields it carries, and no `planId`. Private
 * plan data is kept, because the commit handler receives the whole answer as `call.plan`.
 */
export declare function validatePlanAnswer(value: unknown): Checked<Record<string, unknown>>;
/** A commit's input, checked: exactly `{ planId }`. */
export declare function validateCommitInput(value: unknown): Checked<{
    planId: string;
}>;
/**
 * The tool's input schema: the handler's own, with `account` added for a method declared `accounts: "optional"`. A
 * method declared `accounts: "none"` must not declare one.
 */
export declare function toolInputSchema(item: {
    readonly accounts?: "optional" | "none" | undefined;
    readonly commits?: string | undefined;
}, handlerInput: JsonSchema): JsonSchema;
