import { PRICING_PLANS } from "../constants/pricingPlans";

/** Human-readable plan name for `signup_plan` / `profiles.signup_plan` ids. */
export function planLabelFromSignupId(
  raw: string | null | undefined,
): string {
  if (raw == null || typeof raw !== "string") return "—";
  const id = raw.trim().toLowerCase();
  if (!id) return "—";
  const p = PRICING_PLANS.find((x) => x.id === id);
  return p?.name ?? raw.trim();
}
