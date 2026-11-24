/**
 * `catalog`: the installed manifests, and the broker request a consumer sends a host (contract §14).
 *
 * Remote apps cannot read the disk, and RPC is untrusted for manifests, so the catalog is the one trusted door:
 *
 *   const listing = await listInstalledPlugins(ctx)
 *   if (listing.plugins[0]) {
 *     listing.plugins[0].manifest   // validated from the installed package
 *     listing.plugins[0].hash       // sha256:…, the hash a grant stores
 *   }
 *
 * A consumer that has a host's broker reads through `sourceReader`, which asks the broker first and reads embedded
 * when none is offered. The request is keyed on `consumer`; `package`, `version` and `manifestHash` describe the
 * source's manifest (issue #8). The transport is passed by the consumer's own code, never found over RPC.
 */
export { brokerRequest, isBrokerAnswer, isBrokerRequest, sourceReader } from "./catalog/broker.ts"
export type { BrokerAnswer, BrokerRequest, BrokerTransport, ReaderOutcome, SourceReader } from "./catalog/broker.ts"
export { listInstalledPlugins } from "./catalog/list.ts"
export type { CatalogHost, CatalogListing, CatalogOptions, CatalogPlugin, CatalogProblem, HostPlugin } from "./catalog/list.ts"
