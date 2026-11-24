import type { Checked } from "../internal/checked.js";
import type { Manifest, MethodItem } from "../manifest.js";
import type { PermissionRule } from "./fences.js";
/** The three levels of the `access` option (contract §6), in the order the table lists them. */
export declare const ACCESS_LEVELS: readonly ["all", "ask-changes", "read-only"];
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
/** The level when the option is absent. */
export declare const DEFAULT_ACCESS: AccessLevel;
/** The `access` option, or `all` when it is absent; refused when it is not one of the three levels. */
export declare function accessLevel(options?: Readonly<Record<string, unknown>>): Checked<AccessLevel>;
/** True for a manifest method that classifies a pass-through MCP tool (`mcp:<tool>` or `mcp:*`). */
export declare function isMcpMethod(method: string): boolean;
/** The permission action of a plugin's own method (contract §3): `<name>.<method>`. */
export declare function methodAction(name: string, method: string): string;
/** The effect a method's class and `effect` give under `level`. */
export declare function effectFor(method: Pick<MethodItem, "class" | "effect">, level: AccessLevel): PermissionRule["effect"];
/**
 * The integration or MCP server name of `alias` (§3, §5): `<name>` for `default`, `<name>-<alias>` otherwise. Refused
 * when `alias` is not one of the plugin's declared aliases, so a rule can never be derived for an account that does not
 * exist. This is the one per-alias derivation: `operationRule`, the access rules and the conformance kit all use it.
 */
export declare function serverOf(name: string, alias: string, aliases: readonly string[]): Checked<string>;
/**
 * The per-alias name without the declared-alias check, for a grant whose account the app already resolved from the
 * manifest. Everything that derives a name from configuration uses `serverOf` instead.
 */
export declare function serverName(name: string, alias: string): string;
/** The declared aliases from the plugin's options, or `default` when the plugin has no accounts option. */
export declare function aliasesFrom(options?: Readonly<Record<string, unknown>>): readonly string[];
/**
 * The rules `level` generates for `manifest`, one per method and, for pass-through MCP tools, one per alias: every
 * alias gets its own `<server>_<tool>` rule, so a rule for `work` can never reach another alias's tools.
 */
export declare function rulesFor(manifest: Manifest, level: AccessLevel, aliases?: readonly string[]): readonly PermissionRule[];
