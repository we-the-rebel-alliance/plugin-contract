/**
 * The host gate (contract §4): one check that a plugin starts only inside the OpenCode range its manifest declares.
 *
 *   export default {
 *     id: manifest.plugin.name,
 *     async setup(ctx) {
 *       assertHost(ctx, manifest)
 *       …
 *     },
 *   }
 *
 * `ctx.app.version` is the running OpenCode release; the manifest's `plugin.host.opencode` is the range. Outside it the
 * gate refuses with `HOST_UNTESTED` and a next step, unless `options.allowUntestedHost` is `true`. The range predicate is
 * `hostInRange` in `manifest`, so a plugin and the conformance kit never disagree about which releases are supported.
 */
import { type Manifest } from "../manifest.js";
/** The part of the plugin context the gate reads: the running app's version and the plugin's options. */
export interface HostContext {
    readonly app: {
        readonly version: string;
    };
    readonly options?: Readonly<Record<string, unknown>> | undefined;
}
/**
 * Refuse a host outside the manifest's range, unless the person allowed an untested one. Supported hosts, and
 * `allowUntestedHost: true`, return without doing anything.
 */
export declare function assertHost(context: HostContext, manifest: Manifest): void;
