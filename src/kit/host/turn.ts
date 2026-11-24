/**
 * The sixth OpenCode 2.4 behaviour: a turn's first tool step can arrive before the turn start.
 *
 * A host streams as it goes, and the order is not guaranteed across the start and the first step. The log holds a step
 * until its turn's start arrives, then emits the start first and the held steps in their arrival order. A test that
 * consumes the log never loses the first step, and never sees it before the turn it belongs to.
 *
 * The two event names map to OpenCode 2.4's `session.execution.started` (a turn begins) and `session.tool.called` (a
 * step of it); the log reads only the turn key and the arrival time a host test already has.
 */
export type TurnEvent =
  | { readonly type: "turn.start"; readonly turnID: string; readonly at: number }
  | { readonly type: "tool.step"; readonly turnID: string; readonly step: number; readonly at: number }

/** A streaming turn log: push what arrives, take what is ready to process. */
export class TurnLog {
  private readonly started = new Set<string>()
  private readonly held = new Map<string, TurnEvent[]>()
  private readonly order: string[] = []
  private readonly seen: TurnEvent[] = []

  /**
   * Accept one event. A start releases its turn's held steps after itself; a step before its start is held and releases
   * nothing yet.
   */
  push(event: TurnEvent): TurnEvent[] {
    this.seen.push(event)
    if (event.type === "tool.step" && !this.started.has(event.turnID)) {
      const held = this.held.get(event.turnID) ?? []
      held.push(event)
      this.held.set(event.turnID, held)
      if (!this.order.includes(event.turnID)) this.order.push(event.turnID)
      return []
    }
    if (event.type === "turn.start" && !this.started.has(event.turnID)) {
      this.started.add(event.turnID)
      const held = this.held.get(event.turnID) ?? []
      this.held.delete(event.turnID)
      return [event, ...held]
    }
    return [event]
  }

  /** Whatever is still held, in arrival order, for a test that ends with a turn that never started. */
  flush(): TurnEvent[] {
    const held = this.order.flatMap((turn) => this.held.get(turn) ?? [])
    this.held.clear()
    this.order.length = 0
    return held
  }

  /** Everything pushed, in arrival order, for a diagnostic. */
  get events(): readonly TurnEvent[] {
    return this.seen
  }
}
