import { PRICING_PLANS, type PricingPlan } from "./pricingPlans";

export type PlanId = PricingPlan["id"];

const KNOWN_IDS = new Set<PlanId>(PRICING_PLANS.map((p) => p.id));

/**
 * Max storefronts per seller for each tier.
 * Free explicitly lists one shop; Starter/Growth use a single storefront URL in
 * pricing — Growth is not a multi-shop tier here. Pro: no fixed cap.
 */
export const MAX_STORES_BY_PLAN: Record<PlanId, number | null> = {
  free: 1,
  starter: 1,
  growth: 1,
  pro: null,
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

/** Numeric cap for comparisons (`atStoreLimit`); Pro is effectively unlimited. */
export function maxStoresForPlan(planId: PlanId): number {
  const m = MAX_STORES_BY_PLAN[planId];
  return m ?? 1_000_000;
}

/** Copy for UI: `"3"` or `"unlimited"` (Pro). */
export function maxStoresDisplayText(planId: PlanId): string {
  const m = MAX_STORES_BY_PLAN[planId];
  if (m == null) return "unlimited";
  return String(m);
}
