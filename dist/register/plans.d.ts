/**
 * The plan store: every plan records the account and the method that commits it, and a planId commits once (contract §6).
 *
 * A plan is a dry-run; its `planId` is answered by a planning method and carried to exactly one commit. The account is
 * part of the plan's meaning: a personal plan must not be committed as work just because work is the first alias. The
 * method is part of it too: a planId for one commit method is refused by another. The store is scoped to one plugin
 * instance and kept in memory; a plan expires after {@link PLAN_TTL_MS}. Unknown and expired ids are `PLAN_INVALID`;
 * a second commit with a used id is `PLAN_USED`.
 */
import type { Checked } from "../internal/checked.js";
/** How long a plan may be committed after it was made (15 minutes). */
export declare const PLAN_TTL_MS: number;
/** A plan lookup that failed with the contract code the caller reports. */
export interface PlanRefusal {
    readonly ok: false;
    readonly code: "PLAN_INVALID" | "PLAN_USED";
    readonly problems: readonly string[];
}
/** The account of a live, unused plan, or why the id cannot commit. */
export type PlanLookup = Checked<string> & ({
    readonly ok: true;
} | PlanRefusal);
/** The per-instance plan ledger. */
export interface PlanStore {
    /** Record the account and committing method a plan was made for, pruning expired plans first. A repeated id replaces the earlier plan. */
    record(planId: string, account: string, method: string): void;
    /** Take a live, unused plan for `method`; it cannot be taken again. */
    take(planId: string, method: string): PlanLookup;
    /** The number of live plans, for tests and diagnostics. */
    readonly size: number;
}
/** A plan store over a clock a test can replace. */
export declare function planStore(options?: {
    readonly now?: () => number;
    readonly ttlMs?: number;
}): PlanStore;
