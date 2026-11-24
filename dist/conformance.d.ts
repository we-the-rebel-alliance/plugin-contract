import { type ConformanceReport, type Finding } from "./internal/conformance/report.js";
export type { ConformanceReport, Finding } from "./internal/conformance/report.js";
export { renderGeneratedDocs } from "./internal/conformance/docs.js";
/** What `runConformance` checks that the caller chooses. */
export interface ConformanceOptions {
    /** The OpenCode releases to load the plugin on. Default: the manifest's `plugin.host.tested`. */
    readonly hosts?: readonly string[] | undefined;
    /** While recording: a missing recording is a warning, not an error. */
    readonly record?: boolean | undefined;
}
/**
 * T0, the static gate: the namespace line, each skill description, every tool a text names, a pinned method's
 * evidence, and the generated doc sections. No model, no network, no host.
 */
export declare function t0(pluginDir: string): Promise<Finding[]>;
/**
 * T1, the host gate: the plugin loads on `host`, every method is a tool and an RPC method with permission
 * `<name>.<method>`, the access levels hold, and a non-read method over RPC without an answered ask is refused. An
 * unsupported `host` is expected to refuse cleanly with `HOST_UNTESTED`.
 */
export declare function t1(pluginDir: string, host: string): Promise<Finding[]>;
/**
 * Everything `plugin-kit conformance` runs: T0, the manifest's own declaration and options, every recorded source and
 * account, the bus and status, actions, grants and the RPC confirmation, then T1 on every host the manifest tested and
 * on the first unsupported one.
 */
export declare function runConformance(pluginDir: string, options?: ConformanceOptions): Promise<ConformanceReport>;
