/**
 * The plan store: every plan records the account and the method that commits it, and a planId commits once (contract §6).
 *
 * A plan is a dry-run; its `planId` is answered by a planning method and carried to exactly one commit. The account is
 * part of the plan's meaning: a personal plan must not be committed as work just because work is the first alias. The
 * method is part of it too: a planId for one commit method is refused by another. The store is scoped to one plugin
 * instance and kept in memory; a plan expires after {@link PLAN_TTL_MS}. Unknown and expired ids are `PLAN_INVALID`;
 * a second commit with a used id is `PLAN_USED`.
 */
import type { Checked } from "../internal/checked.ts"

/** How long a plan may be committed after it was made (15 minutes). */
export const PLAN_TTL_MS = 15 * 60_000

/** One plan's account, committing method, expiry and whether it was spent. */
interface StoredPlan {
  readonly account: string
  readonly method: string
  readonly expires: number
  used: boolean
}

/** A plan lookup that failed with the contract code the caller reports. */
export interface PlanRefusal {
  readonly ok: false
  readonly code: "PLAN_INVALID" | "PLAN_USED"
  readonly problems: readonly string[]
}

/** The account of a live, unused plan, or why the id cannot commit. */
export type PlanLookup = Checked<string> & ({ readonly ok: true } | PlanRefusal)

/** The per-instance plan ledger. */
export interface PlanStore {
  /** Record the account and committing method a plan was made for, pruning expired plans first. A repeated id replaces the earlier plan. */
  record(planId: string, account: string, method: string): void
  /** Take a live, unused plan for `method`; it cannot be taken again. */
  take(planId: string, method: string): PlanLookup
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
  return {
    record(planId, account, method) {
      prune()
      plans.set(planId, { account, method, expires: now() + ttl, used: false })
    },
    take(planId, method) {
      prune()
      const plan = plans.get(planId)
      if (plan === undefined) return { ok: false, code: "PLAN_INVALID", problems: [`there is no plan '${planId}'; plan again and commit with the planId it answers`] }
      if (plan.used) return { ok: false, code: "PLAN_USED", problems: [`the plan '${planId}' was already used; plan again to make a new one`] }
      if (plan.method !== method) {
        return { ok: false, code: "PLAN_INVALID", problems: [`the plan '${planId}' commits ${plan.method}, not ${method}`] }
      }
      plan.used = true
      return { ok: true, value: plan.account }
    },
    get size() {
      prune()
      return plans.size
    },
  }
}
