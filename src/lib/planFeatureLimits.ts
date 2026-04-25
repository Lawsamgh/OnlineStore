import { MAX_STORES_BY_PLAN } from "../constants/planEntitlements";
import type { PricingPlan } from "../constants/pricingPlans";

const MB = 1024 * 1024;

/**
 * Max bytes for a single product cover upload in Storage (`product-images`),
 * aligned with marketing copy in `pricingPlans.ts` (2 / 3 / 5 / 10 MB).
 */
export const MAX_PRODUCT_COVER_IMAGE_BYTES_BY_PLAN: Record<
  PricingPlan["id"],
  number
> = {
  free: 2 * MB,
  starter: 3 * MB,
  growth: 5 * MB,
  pro: 10 * MB,
};

/** Quotas: `maxStores` is always `MAX_STORES_BY_PLAN` so create-store UI and dashboard stay in sync. */
export const PLAN_FEATURE_LIMITS: Record<
  PricingPlan["id"],
  {
    /** Max storefronts owned; `null` = no fixed cap (Pro). */
    maxStores: number | null;
    /** Max admin users per store, including the owner seat. */
    maxAdminUsers: number | null;
    maxProducts: number | null;
    maxOrdersPerMonth: number | null;
    /** Single product cover file size cap (matches pricing page). */
    maxProductCoverImageBytes: number;
  }
> = {
  free: {
    maxStores: MAX_STORES_BY_PLAN.free,
    maxAdminUsers: 1,
    maxProducts: 5,
    maxOrdersPerMonth: 15,
    maxProductCoverImageBytes: MAX_PRODUCT_COVER_IMAGE_BYTES_BY_PLAN.free,
  },
  starter: {
    maxStores: MAX_STORES_BY_PLAN.starter,
    maxAdminUsers: 1,
    maxProducts: 30,
    maxOrdersPerMonth: 100,
    maxProductCoverImageBytes: MAX_PRODUCT_COVER_IMAGE_BYTES_BY_PLAN.starter,
  },
  growth: {
    maxStores: MAX_STORES_BY_PLAN.growth,
    maxAdminUsers: 1,
    maxProducts: 150,
    maxOrdersPerMonth: 500,
    maxProductCoverImageBytes: MAX_PRODUCT_COVER_IMAGE_BYTES_BY_PLAN.growth,
  },
  pro: {
    maxStores: MAX_STORES_BY_PLAN.pro,
    maxAdminUsers: 1,
    maxProducts: null,
    maxOrdersPerMonth: null,
    maxProductCoverImageBytes: MAX_PRODUCT_COVER_IMAGE_BYTES_BY_PLAN.pro,
  },
};

export function resolvePricingPlanId(raw: unknown): PricingPlan["id"] {
  if (typeof raw !== "string" || !raw.trim()) return "free";
  const id = raw.trim().toLowerCase();
  if (id === "starter" || id === "growth" || id === "pro" || id === "free") {
    return id;
  }
  return "free";
}
