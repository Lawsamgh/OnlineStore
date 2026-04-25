import { PRICING_PLANS, type PricingPlan } from "./pricingPlans";

export type PlanId = PricingPlan["id"];

const KNOWN_IDS = new Set<PlanId>(PRICING_PLANS.map((p) => p.id));

/**
 * Max storefronts per seller for each tier.
 * All plans currently allow a single storefront.
 */
export const MAX_STORES_BY_PLAN: Record<PlanId, number | null> = {
  free: 1,
  starter: 1,
  growth: 1,
  pro: 1,
};

export function isKnownPlanId(id: string | null | undefined): id is PlanId {
  return typeof id === "string" && KNOWN_IDS.has(id.trim().toLowerCase() as PlanId);
}

export function normalizeSignupPlanId(
  raw: string | null | undefined,
): PlanId | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim().toLowerCase();
  return isKnownPlanId(id) ? id : null;
}

/** Numeric cap for comparisons (`atStoreLimit`). */
export function maxStoresForPlan(planId: PlanId): number {
  const m = MAX_STORES_BY_PLAN[planId];
  return m ?? 1_000_000;
}

/** Copy for UI: numeric cap or `"unlimited"` when configured. */
export function maxStoresDisplayText(planId: PlanId): string {
  const m = MAX_STORES_BY_PLAN[planId];
  if (m == null) return "unlimited";
  return String(m);
}
