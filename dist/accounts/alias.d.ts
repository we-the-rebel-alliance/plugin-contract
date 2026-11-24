/**
 * Account aliases (contract §5): `^[a-z][a-z0-9_]{0,31}$`, and `default` for the account with no alias.
 *
 * A hyphen separates a plugin's name from an alias (`slack-work`), so an alias itself has none. An alias is the key of
 * a profile in the `accounts` option, the last segment of an integration or MCP server name, and the first half of a
 * permission resource (`work:conversations.history`).
 */
/** The one alias every plugin's unnamed account uses. */
export declare const DEFAULT_ALIAS = "default";
/** An alias: one lowercase letter, then up to 31 lowercase letters, digits or underscores. */
export declare const ALIAS_PATTERN: RegExp;
/** True when `value` is an alias. */
export declare function isAlias(value: unknown): value is string;
/** Why `value` is not an alias, or undefined when it is. `where` names it in the sentence. */
export declare function aliasProblem(value: unknown, where?: string): string | undefined;
