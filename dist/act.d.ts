import { type ActionEffect, type InstalledManifest } from "./manifest.js";
import { type ReadFailure } from "./internal/failure.js";
import { type ActGrant, type ActPhase } from "./access.js";
import type { ReadHost } from "./read.js";
export type { ReadFailure } from "./internal/failure.js";
export type { ActGrant, ActPhase } from "./access.js";
/** What a project's host does for `act`: a read host, plus a confirmation check when it can issue one. */
export interface ActHost extends ReadHost {
    /**
     * True when `token` is a confirmation this host issued for this act, account and consumer. Absent when the host
     * has no issuer: a non-local commit is then refused. The contract never issues a token.
     */
    issuedConfirmation?(check: {
        readonly token: string;
        readonly action: string;
        readonly effect: ActionEffect;
        readonly account: string;
        readonly consumer: string;
    }): boolean | Promise<boolean>;
}
/** One preview or commit of an act. */
export interface ActRequest {
    readonly installed: InstalledManifest;
    readonly action: string;
    readonly grant: ActGrant;
    readonly consumer: string;
    readonly phase: ActPhase;
    /** The caller's input, checked against the act's input schema. The library adds `account`. */
    readonly input?: Readonly<Record<string, unknown>>;
    /**
     * A confirmation the host issued. Required to commit an act whose effect is not `local`. Ignored for a preview
     * and for a local commit. An empty token is not a confirmation.
     */
    readonly confirmation?: string;
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
export type ActOutcome = {
    readonly ok: true;
    readonly phase: "preview";
    readonly preview: ActAnswer;
} | {
    readonly ok: true;
    readonly phase: "commit";
    readonly result: ActAnswer;
} | {
    readonly ok: false;
    readonly failure: ReadFailure;
};
/** Previews or commits an act under a grant, in a session fenced by that phase's rules. Never throws for a refusal. */
export declare function act(host: ActHost, request: ActRequest): Promise<ActOutcome>;
