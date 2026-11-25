/**
 * The plan store: every plan records the account and the method that commits it, and a planId commits once (contract §6).
 *
 * A plan is a dry-run; its `planId` is answered by a planning method and carried to exactly one commit. The account is
 * part of the plan's meaning: a personal plan must not be committed as work just because work is the first alias. The
 * method is part of it too: a planId for one commit method is refused by another. The store is scoped to one plugin
 * instance and kept in memory; a plan expires after {@link PLAN_TTL_MS}. Unknown and expired ids are `PLAN_INVALID`; a
 * second commit with a reserved or used id is `PLAN_USED`.
 *
 * A commit **reserves** the plan synchronously before any permission ask or grant check, so two concurrent commits
 * cannot both run. A refusal before the handler releases the reservation and leaves the plan committable; the handler's
 * start **consumes** it, so a handler that fails after starting still used the plan because its side effect may have
 * happened. A reservation handle carries its own token, so releasing one call can never release another call's work.
 */
import { randomUUID } from "node:crypto"

/** How long a plan may be committed after it was made (15 minutes). */
export const PLAN_TTL_MS = 15 * 60_000

/** One plan's account, committing method, expiry, and reservation/use state. */
interface StoredPlan {
  readonly account: string
  readonly method: string
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

/** A reservation of one plan for one call: the exact handle release and consume use. */
export interface PlanReservation {
  readonly planId: string
  readonly method: string
  readonly account: string
  readonly token: string
}

/** A live, available plan reserved for one call, or why the id cannot commit. */
export type PlanReserve = { readonly ok: true; readonly reservation: PlanReservation } | PlanRefusal

/** The per-instance plan ledger. */
export interface PlanStore {
  /** Record the account and committing method a plan was made for, pruning expired plans first. A repeated id replaces the earlier plan. */
  record(planId: string, account: string, method: string): void
  /** Reserve a live, available plan for `method`. A reserved or used plan is refused; the reservation is synchronous. */
  reserve(planId: string, method: string): PlanReserve
  /** Release a reservation after a refusal before the handler runs. Another call's handle is ignored. */
  release(reservation: PlanReservation): void
  /** Mark a reservation used immediately before its handler runs. Another call's handle is ignored. */
  consume(reservation: PlanReservation): void
  /** The number of live plans, for tests and diagnostics. */
  readonly size: number
}

/** A plan store over a clock a test can replace. */
export function planStore(options: { readonly now?: () => number; readonly ttlMs?: number } = {}): PlanStore {
  const now = options.now ?? Date.now
  const ttl = options.ttlMs ?? PLAN_TTL_MS
  const plans = new Map<string, StoredPlan>()
  const prune = () => {
    const at = now()
    for (const [id, plan] of plans) if (plan.expires <= at) plans.delete(id)
  }
  const same = (plan: StoredPlan, reservation: PlanReservation): boolean => plan.reserved === reservation.token && !plan.used
  return {
    record(planId, account, method) {
      prune()
      plans.set(planId, { account, method, expires: now() + ttl, reserved: undefined, used: false })
    },
    reserve(planId, method) {
      prune()
      const plan = plans.get(planId)
      if (plan === undefined) return { ok: false, code: "PLAN_INVALID", problems: [`there is no plan '${planId}'; plan again and commit with the planId it answers`] }
      if (plan.used || plan.reserved !== undefined) return { ok: false, code: "PLAN_USED", problems: [`the plan '${planId}' is already reserved or used; plan again to make a new one`] }
      if (plan.method !== method) return { ok: false, code: "PLAN_INVALID", problems: [`the plan '${planId}' commits ${plan.method}, not ${method}`] }
      const reservation: PlanReservation = { planId, method, account: plan.account, token: randomUUID() }
      plan.reserved = reservation.token
      return { ok: true, reservation }
    },
    release(reservation) {
      const plan = plans.get(reservation.planId)
      if (plan !== undefined && same(plan, reservation)) plan.reserved = undefined
    },
    consume(reservation) {
      const plan = plans.get(reservation.planId)
      if (plan !== undefined && same(plan, reservation)) {
        plan.used = true
        plan.reserved = undefined
      }
    },
    get size() {
      prune()
      return plans.size
    },
  }
}
