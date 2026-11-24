import type { Checked } from "../internal/checked.js";
import type { JsonSchema } from "../manifest.js";
/** The plan's answer (contract §6): the id of the dry-run and the method that commits it. */
export declare const PLAN_OUTPUT: JsonSchema;
/** What a commit accepts from its planning method: the plan id, and nothing else. */
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
/** The plan's answer, checked: exactly the id and the method that commits it. */
export declare function validatePlan(value: unknown): Checked<{
    planId: string;
    method: string;
}>;
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
