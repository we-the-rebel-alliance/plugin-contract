/**
 * The plan store: every plan records the account it was made for, so a commit runs as that account (contract §6).
 *
 * A plan is a dry-run; its `planId` is answered by a planning method and carried to its commit. The account is part of
 * the plan's meaning: a personal plan must not be committed as work just because work is the first declared alias. The
 * store is scoped to one plugin instance and kept in memory; a plan expires after {@link PLAN_TTL_MS} and an unknown or
 * expired `planId` is `PLAN_INVALID`.
 */
import type { Checked } from "../internal/checked.ts"

/** How long a plan may be committed after it was made (15 minutes). */
export const PLAN_TTL_MS = 15 * 60_000

/** One plan's account and expiry. */
interface StoredPlan {
  readonly account: string
  readonly expires: number
}

/** The per-instance plan ledger. A `planId` for an unknown or expired plan is refused. */
export interface PlanStore {
  /** Record the account a plan was made for. A repeated id replaces the earlier plan. */
  record(planId: string, account: string): void
  /** The account of a live plan, or a problem naming an unknown or expired plan. */
  accountOf(planId: string): Checked<string>
}

/** A plan store over a clock a test can replace. */
export function planStore(options: { readonly now?: () => number; readonly ttlMs?: number } = {}): PlanStore {
  const now = options.now ?? Date.now
  const ttl = options.ttlMs ?? PLAN_TTL_MS
  const plans = new Map<string, StoredPlan>()
  return {
    record(planId, account) {
      plans.set(planId, { account, expires: now() + ttl })
    },
    accountOf(planId) {
      const plan = plans.get(planId)
      if (plan === undefined) return { ok: false, problems: [`there is no plan '${planId}'; plan again and commit with the planId it answers`] }
      if (plan.expires <= now()) {
        plans.delete(planId)
        return { ok: false, problems: [`the plan '${planId}' has expired; plan again and commit with the new planId`] }
      }
      return { ok: true, value: plan.account }
    },
  }
}
