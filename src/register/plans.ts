/**
 * The plan store: the register mints every plan id, and a plan commits once (contract §6 and §8).
 *
 * A plan is a dry-run; its `planId` is minted here with 16 random bytes, never by the handler, and carried to exactly
 * one commit. The account is part of the plan's meaning: a personal plan must not be committed as work just because
 * work is the first declared alias. The committing method is part of it too: a planId for one commit method is refused
 * by another. The store keeps the handler's full answer, so the commit handler receives the plan as `call.plan`. The
 * store is scoped to one plugin instance and kept in memory; a plan expires after {@link PLAN_TTL_MS}, and a planId
 * from before a reload is unknown to the new instance. Unknown and expired ids are `PLAN_INVALID`; a second commit with
 * a reserved or used id is `PLAN_USED`.
 *
 * A commit **reserves** the plan synchronously before any permission ask or grant check, so two concurrent commits
 * cannot both run. A refusal before the handler releases the reservation and leaves the plan committable; the handler's
 * start **consumes** it, so a handler that fails after starting still used the plan because its side effect may have
 * happened. A reservation handle carries its own token, so releasing one call can never release another call's work.
 */
import { randomBytes, randomUUID } from "node:crypto"

/** How long a plan may be committed after it was made (15 minutes). */
export const PLAN_TTL_MS = 15 * 60_000

/** The bytes in every minted plan id: 128 random bits, so a person's consent binds to a value nobody can guess. */
export const PLAN_ID_BYTES = 16

/** A fresh plan id: 16 random bytes as base64url, the value a commit and its grant are bound to. */
export function mintPlanId(): string {
  return randomBytes(PLAN_ID_BYTES).toString("base64url")
}

/** One plan's account, committing method, the handler's full answer, expiry, and reservation/use state. */
interface StoredPlan {
  readonly account: string
  readonly method: string
  readonly answer: unknown
  readonly expires: number
  reserved: string | undefined
  used: boolean
}

/** A plan lookup that failed with the contract code the caller reports. */
export interface PlanRefusal {
  readonly ok: false
  readonly code: "PLAN_INVALID" | "PLAN_USED"
  readonly problems: readonly string[]
}

/** A reservation of one plan for one call: the exact handle release and consume use, and the handler's answer. */
export interface PlanReservation {
  readonly planId: string
  readonly method: string
  readonly account: string
  /** The plan handler's full answer, which the commit handler receives as `call.plan`. */
  readonly answer: unknown
  readonly token: string
}

/** A live, available plan reserved for one call, or why the id cannot commit. */
export type PlanReserve = { readonly ok: true; readonly reservation: PlanReservation } | PlanRefusal

/** A reservation consumed at handler start: the plan's account and the handler's full answer, or why it is refused. */
export type PlanConsume = { readonly ok: true; readonly account: string; readonly answer: unknown } | PlanRefusal

/** The per-instance plan ledger. */
export interface PlanStore {
  /**
   * Keep the handler's full answer for a new plan and return the unguessable id the register mints for it. A minted id
   * that is already live is never reused: the store mints again.
   */
  record(answer: unknown, account: string, method: string): string
  /** Reserve a live, available plan for `method`. A reserved or used plan is refused; the reservation is synchronous. */
  reserve(planId: string, method: string): PlanReserve
  /** Release a reservation after a refusal before the handler runs. Another call's handle is ignored. */
  release(reservation: PlanReservation): void
  /** Mark a reservation used immediately before its handler runs, answering its account and the plan's answer. */
  consume(reservation: PlanReservation): PlanConsume
  /** The number of live plans, for tests and diagnostics. */
  readonly size: number
}

/** A plan store over a clock and a minter a test can replace; the real minter is {@link mintPlanId}. */
export function planStore(options: { readonly now?: () => number; readonly ttlMs?: number; readonly mint?: () => string } = {}): PlanStore {
  const now = options.now ?? Date.now
  const ttl = options.ttlMs ?? PLAN_TTL_MS
  const mint = options.mint ?? mintPlanId
  const plans = new Map<string, StoredPlan>()
  const prune = () => {
    const at = now()
    for (const [id, plan] of plans) if (plan.expires <= at) plans.delete(id)
  }
  const same = (plan: StoredPlan, reservation: PlanReservation): boolean => plan.reserved === reservation.token && !plan.used
  return {
    record(answer, account, method) {
      prune()
      let planId = mint()
      // 128 random bits never collide in practice; a store whose minter repeats itself must not replace a live plan.
      while (plans.has(planId)) planId = mint()
      plans.set(planId, { account, method, answer, expires: now() + ttl, reserved: undefined, used: false })
      return planId
    },
    reserve(planId, method) {
      prune()
      const plan = plans.get(planId)
      if (plan === undefined) return { ok: false, code: "PLAN_INVALID", problems: [`there is no plan '${planId}'; plan again and commit with the planId it answers`] }
      if (plan.used || plan.reserved !== undefined) return { ok: false, code: "PLAN_USED", problems: [`the plan '${planId}' is already reserved or used; plan again to make a new one`] }
      if (plan.method !== method) return { ok: false, code: "PLAN_INVALID", problems: [`the plan '${planId}' commits ${plan.method}, not ${method}`] }
      const reservation: PlanReservation = { planId, method, account: plan.account, answer: plan.answer, token: randomUUID() }
      plan.reserved = reservation.token
      return { ok: true, reservation }
    },
    release(reservation) {
      const plan = plans.get(reservation.planId)
      if (plan !== undefined && same(plan, reservation)) plan.reserved = undefined
    },
    consume(reservation) {
      const plan = plans.get(reservation.planId)
      if (plan === undefined) {
        prune()
        return { ok: false, code: "PLAN_INVALID", problems: [`there is no plan '${reservation.planId}'; plan again and commit with the new planId`] }
      }
      if (plan.expires <= now()) {
        plans.delete(reservation.planId)
        return { ok: false, code: "PLAN_INVALID", problems: [`the plan '${reservation.planId}' expired before its handler started; plan again`] }
      }
      prune()
      if (plan.used) return { ok: false, code: "PLAN_USED", problems: [`the plan '${reservation.planId}' was already used; plan again`] }
      if (plan.reserved !== reservation.token) return { ok: false, code: "PLAN_USED", problems: [`the plan '${reservation.planId}' is no longer reserved by this call; plan again`] }
      plan.used = true
      plan.reserved = undefined
      return { ok: true, account: plan.account, answer: plan.answer }
    },
    get size() {
      prune()
      return plans.size
    },
  }
}
