import type { Validator } from "./internal/checked.js";
import type { Sources } from "./internal/schema/types.js";
export { MAX_BYTES_DEFAULT, MAX_BYTES_LIMIT, SERVICE_ID_MAX, SERVICE_LABEL_MAX } from "./internal/schema/types.js";
export { FACT_SCHEMAS, factSchema } from "./internal/schema/facts.js";
export { ACT_EFFECTS } from "./internal/schema/types.js";
export type { Accounts, ActEffect, ActItem, ActPermission, Cadence, Cost, Detail, DetailField, Permission, PermissionEvents, PermissionTool, Price, Scope, Service, SourceCommon, SourceEvents, SourceItem, SourceSnapshot, Sources, Suggest, } from "./internal/schema/types.js";
/** The validator for a plugin's `sources` declaration, wire version 1. */
export declare const SOURCES_SCHEMA: Validator<Sources>;
