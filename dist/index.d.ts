/**
 * The plugin contract: one language for every OpenCode plugin and every app that uses one.
 *
 * Each module is also its own entry point (`@we-the-rebel-alliance/plugin-contract/<module>`), so a plugin bundles only
 * what it uses. This entry holds the wire version and re-exports nothing heavy.
 */
/** The manifest's wire version (contract §4). */
export declare const CONTRACT_VERSION = 1;
/** The manifest wire versions this package reads. */
export declare const SUPPORTED_CONTRACT_VERSIONS: readonly number[];
export type { Checked, Validator } from "./internal/checked.js";
