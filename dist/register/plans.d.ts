/** How long a plan may be committed after it was made (15 minutes). */
export declare const PLAN_TTL_MS: number;
/** A plan lookup that failed with the contract code the caller reports. */
export interface PlanRefusal {
    readonly ok: false;
    readonly code: "PLAN_INVALID" | "PLAN_USED";
    readonly problems: readonly string[];
}
/** A reservation of one plan for one call: the exact handle release and consume use. */
export interface PlanReservation {
    readonly planId: string;
    readonly method: string;
    readonly account: string;
    readonly token: string;
}
/** A live, available plan reserved for one call, or why the id cannot commit. */
export type PlanReserve = {
    readonly ok: true;
    readonly reservation: PlanReservation;
} | PlanRefusal;
/** A reservation consumed at handler start, or why it no longer holds the plan. */
export type PlanConsume = {
    readonly ok: true;
    readonly account: string;
} | PlanRefusal;
/** The per-instance plan ledger. */
export interface PlanStore {
    /** Record the account and committing method a plan was made for, pruning expired plans first. A repeated id replaces the earlier plan. */
    record(planId: string, account: string, method: string): void;
    /** Reserve a live, available plan for `method`. A reserved or used plan is refused; the reservation is synchronous. */
    reserve(planId: string, method: string): PlanReserve;
    /** Release a reservation after a refusal before the handler runs. Another call's handle is ignored. */
    release(reservation: PlanReservation): void;
    /** Mark a reservation used immediately before its handler runs. A missing/expired plan is PLAN_INVALID; a re-recorded or used one is PLAN_USED. */
    consume(reservation: PlanReservation): PlanConsume;
    /** The number of live plans, for tests and diagnostics. */
    readonly size: number;
}
/** A plan store over a clock a test can replace. */
export declare function planStore(options?: {
    readonly now?: () => number;
    readonly ttlMs?: number;
}): PlanStore;
