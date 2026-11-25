/**
 * OpenCode 2.4 behaviour 6: a turn's first tool step can arrive before the turn start.
 *
 * A host streams as it goes, and the order is not guaranteed across the start and the first step. The log holds a step
 * until its turn's start arrives, then emits the start first and the held steps in their arrival order. A test that
 * consumes the log never loses the first step and never sees it before the turn it belongs to.
 */
export type TurnEvent = {
    readonly type: "turn.start";
    readonly turnID: string;
    readonly at: number;
} | {
    readonly type: "tool.step";
    readonly turnID: string;
    readonly step: number;
    readonly at: number;
};
/** A streaming turn log: push what arrives, take what is ready to process. */
export declare class TurnLog {
    private readonly started;
    private readonly held;
    private readonly order;
    private readonly seen;
    /** Accept one event. A start releases its turn's held steps after itself; an early step is held. */
    push(event: TurnEvent): TurnEvent[];
    /** Whatever is still held, in arrival order, for a test that ends with a turn that never started. */
    flush(): TurnEvent[];
    /** Everything pushed, in arrival order, for a diagnostic. */
    get events(): readonly TurnEvent[];
}
