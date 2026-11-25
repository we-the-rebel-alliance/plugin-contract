/** How long a plan may be committed after it was made (15 minutes). */
export declare const PLAN_TTL_MS: number;
/** The bytes in every minted plan id: 128 random bits, so a person's consent binds to a value nobody can guess. */
export declare const PLAN_ID_BYTES = 16;
/** The most bytes of JSON one stored plan may take: 64 KB, the manifest's default `maxBytes` and the host's RPC cap. */
export declare const PLAN_MAX_BYTES = 65536;
/** A fresh plan id: 16 random bytes as base64url, the value a commit and its grant are bound to. */
export declare function mintPlanId(): string;
/** A plan lookup that failed with the contract code the caller reports. */
export interface PlanRefusal {
    readonly ok: false;
    readonly code: "PLAN_INVALID" | "PLAN_USED";
    readonly problems: readonly string[];
}
/** A reservation of one plan for one call: the exact handle release and consume use, and the handler's answer. */
export interface PlanReservation {
    readonly planId: string;
    readonly method: string;
    readonly account: string;
    /** The plan handler's full answer, which the commit handler receives as `call.plan`. */
    readonly answer: unknown;
    readonly token: string;
}
/** A recorded plan's minted id, or why the handler's answer cannot be stored. */
export type PlanRecord = {
    readonly ok: true;
    readonly planId: string;
} | PlanRefusal;
/** A live, available plan reserved for one call, or why the id cannot commit. */
export type PlanReserve = {
    readonly ok: true;
    readonly reservation: PlanReservation;
} | PlanRefusal;
/** A reservation consumed at handler start: the plan's account and the handler's full answer, or why it is refused. */
export type PlanConsume = {
    readonly ok: true;
    readonly account: string;
    readonly answer: unknown;
} | PlanRefusal;
/** The per-instance plan ledger. */
export interface PlanStore {
    /**
     * Keep a copy of the handler's full answer for a new plan and return the unguessable id the register mints for it. A
     * minted id that is already live is never reused: the store mints again. An answer that cannot be copied, or whose
     * JSON is over {@link PLAN_MAX_BYTES}, is refused with `PLAN_INVALID` and nothing is stored.
     */
    record(answer: unknown, account: string, method: string): PlanRecord;
    /** Reserve a live, available plan for `method`. A reserved or used plan is refused; the reservation is synchronous. */
    reserve(planId: string, method: string): PlanReserve;
    /** Release a reservation after a refusal before the handler runs. Another call's handle is ignored. */
    release(reservation: PlanReservation): void;
    /** Mark a reservation used immediately before its handler runs, answering its account and the plan's answer. */
    consume(reservation: PlanReservation): PlanConsume;
    /** The number of live plans, for tests and diagnostics. */
    readonly size: number;
}
/** A plan store over a clock and a minter a test can replace; the real minter is {@link mintPlanId}. */
export declare function planStore(options?: {
    readonly now?: () => number;
    readonly ttlMs?: number;
    readonly mint?: () => string;
}): PlanStore;
