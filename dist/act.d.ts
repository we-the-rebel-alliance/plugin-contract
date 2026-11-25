import { type InstalledManifest } from "./manifest.js";
import { type ReadFailure } from "./internal/failure.js";
import { type ActGrant, type ActPhase } from "./access.js";
import { type ReadHost } from "./read.js";
export type { ReadFailure } from "./internal/failure.js";
export type { ActGrant, ActPhase } from "./access.js";
/** What a project's host does for `act`: the same host as `read`, whose call may carry a commit's grant. */
export type ActHost = ReadHost;
/** One preview or commit of an act. */
export interface ActRequest {
    readonly installed: InstalledManifest;
    readonly action: string;
    readonly grant: ActGrant;
    readonly consumer: string;
    readonly phase: ActPhase;
    /** Preview only: the caller's input, checked against the act's input schema. A commit with an input is refused. */
    readonly input?: Readonly<Record<string, unknown>>;
    /** Commit only: the `planId` the preview answered. */
    readonly planId?: string;
    /** Commit only: the host-signed action grant `register` verifies. */
    readonly grantToken?: string;
    readonly signal?: AbortSignal;
}
/** Who a commit would reach, as the preview names them. A host shows this on the one confirm. */
export interface ActParty {
    readonly id: string;
    readonly label?: string;
}
/**
 * What a preview or a commit answers. `output` is the act's declared output. `reaches`, `changes` and `cost` are
 * optional, so a host can render one confirm without knowing the act.
 */
export interface ActAnswer {
    readonly trust: "untrusted";
    readonly output: unknown;
    readonly reaches?: readonly ActParty[];
    readonly changes?: readonly string[];
    readonly cost?: unknown;
    readonly account?: string;
}
/** A preview's answer: the confirm fields, and the plan the commit carries. */
export interface ActPreview extends ActAnswer {
    readonly planId: string;
    /** The act's commit method, as the preview named it. */
    readonly method: string;
}
export type ActOutcome = {
    readonly ok: true;
    readonly phase: "preview";
    readonly preview: ActPreview;
} | {
    readonly ok: true;
    readonly phase: "commit";
    readonly result: ActAnswer;
} | {
    readonly ok: false;
    readonly failure: ReadFailure;
};
/** Previews or commits an act under a grant. Never throws for a refusal. */
export declare function act(host: ActHost, request: ActRequest): Promise<ActOutcome>;
