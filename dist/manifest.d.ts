/**
 * `manifest`: the v0 `capabilities` key (contract §4).
 *
 *   const installed = readInstalledManifest("/path/to/node_modules/@scope/plugin", { version: "1.2.3" })
 *   if (installed.ok) installed.value.hash   // "sha256:…": a grant stores it; a changed manifest asks again
 *
 * The manifest is read from the installed package on disk, validated strictly and hashed. Nothing said over RPC is
 * trusted as a manifest. The schema is `MANIFEST_SCHEMA`; `npm run build` writes its JSON Schema to
 * `dist/schemas/capabilities.json`.
 */
export { canonicalJson, manifestHash } from "./manifest/canonical.js";
export { ownerOrgProblems, ownerProblems, SCHEME_QUALIFIED } from "./manifest/owner.js";
export { hostInRange } from "./manifest/types.js";
export { hostMatches, thumbnailUrlProblems } from "./manifest/thumbnail.js";
export { checkManifest, findAction, findInstalledPackage, findMethod, findSource, manifestProblems, MANIFEST_SCHEMA, maxBytesOf, methodAccounts, readInstalledManifest, } from "./manifest/schema.js";
export { ACTION_EFFECTS, ACCOUNT_MECHANISMS, BUS_EVENTS, COST_CLASSES, DETAIL_FIELDS, EXTENSION_KEY, MANIFEST_VERSION, MAX_BYTES_DEFAULT, MAX_BYTES_LIMIT, METHOD_ACCOUNTS, METHOD_CLASSES, METHOD_EFFECTS, OPENCODE_RANGE, OWNER_ORGS_LIMIT, PLUGIN_NAME, SERVICE_ID_MAX, SERVICE_LABEL_MAX, SOURCE_KINDS, SOURCE_SIGNALS, TESTED_OPENCODE, THUMBNAIL_URL_MAX, } from "./manifest/types.js";
export type { ActionEffect, ActionItem, AccountMechanism, AccountsInfo, BusEvent, Cadence, Cost, CostClass, Detail, DetailField, HostRange, Icon, InstalledManifest, JsonSchema, Manifest, ManifestEvents, MethodAccounts, MethodClass, MethodEffect, MethodItem, Owner, OwnerOrg, PluginInfo, Price, Scope, Service, SourceEvents, SourceItem, SourceKind, SourceSignal, SourceSnapshot, Suggest, Vendor, } from "./manifest/types.js";
