/** Marketing pricing tiers (GHS). Adjust here to change the public pricing page. */

export type PlanFeatureGroup = {
  title: string;
  lines: string[];
};

export type PricingPlan = {
  id: "free" | "starter" | "growth" | "pro";
  name: string;
  monthlyGhs: number;
  annualGhs: number;
  annualSaveGhs: number;
  /** Highlight this column (e.g. recommended tier) */
  highlighted?: boolean;
  /** Shown under the plan name so buyers know who the tier is for */
  audience?: string;
  groups: PlanFeatureGroup[];
};

export const PRICING_STORE_URL = "Public link: /your-store-slug";

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    audience:
      "Try the platform with one small shop — perfect before you commit to Starter.",
    monthlyGhs: 0,
    annualGhs: 0,
    annualSaveGhs: 0,
    groups: [
      {
        title: "Storefronts",
        lines: ["Maximum 1 store", PRICING_STORE_URL],
      },
      {
        title: "Themes",
        lines: ["Default theme only", "No customization"],
      },
      {
        title: "Products",
        lines: ["Up to 5"],
      },
      {
        title: "Orders",
        lines: ["Up to 15 / month"],
      },
      {
        title: "Images",
        lines: ["2 MB per image"],
      },
      {
        title: "Notifications",
        lines: ["Email only"],
      },
      {
        title: "Order Status",
        lines: ["Status text on orders only"],
      },
      {
        title: "Analytics",
        lines: ["Not included — Starter adds order counts"],
      },
      {
        title: "Admin users",
        lines: ["1 user"],
      },
      {
        title: "SMS",
        lines: ["Manual SMS updates"],
      },
      {
        title: "Support",
        lines: ["Help center & docs", "No guaranteed email SLA"],
      },
    ],
  },
  {
    id: "starter",
    name: "Starter",
    audience:
      "Built for small and just-starting businesses — keep costs low while you prove demand and grow your catalogue.",
    monthlyGhs: 150,
    annualGhs: 1500,
    annualSaveGhs: 300,
    groups: [
      {
        title: "Storefronts",
        lines: ["Maximum 1 store", PRICING_STORE_URL],
      },
      {
        title: "Themes",
        lines: ["1 theme only (default theme)", "No customization"],
      },
      {
        title: "Products",
        lines: ["Up to 30"],
      },
      {
        title: "Orders",
        lines: ["Up to 100 / month"],
      },
      {
        title: "Images",
        lines: ["3 MB per image"],
      },
      {
        title: "Notifications",
        lines: ["Email only"],
      },
      {
        title: "Order Status",
        lines: ["Status updates only"],
      },
      {
        title: "Analytics",
        lines: ["Orders count only"],
      },
      {
        title: "Admin users",
        lines: ["1 user"],
      },
      {
        title: "SMS",
        lines: ["SMS auto notify"],
      },
      {
        title: "Support",
        lines: ["Email only", "72-hour response"],
      },
    ],
  },
  {
    id: "growth",
    name: "Growth",
    monthlyGhs: 350,
    annualGhs: 3500,
    annualSaveGhs: 700,
    highlighted: true,
    groups: [
      {
        title: "Storefronts",
        lines: ["Maximum 1 store", PRICING_STORE_URL],
      },
      {
        title: "Themes",
        lines: ["3 themes", "Basic color customization + logo upload"],
      },
      {
        title: "Products",
        lines: ["Up to 150"],
      },
      {
        title: "Orders",
        lines: ["Up to 500 / month"],
      },
      {
        title: "Images",
        lines: ["5 MB per image"],
      },
      {
        title: "Notifications",
        lines: ["Email + SMS auto"],
      },
      {
        title: "Order Status",
        lines: ["Status updates + notes & ETA"],
      },
      {
        title: "Analytics",
        lines: ["Sales reports + charts"],
      },
      {
        title: "Admin users",
        lines: ["1 user"],
      },
      {
        title: "SMS",
        lines: ["SMS auto notify"],
      },
      {
        title: "Support",
        lines: ["Email + chat", "24-hour response"],
      },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyGhs: 650,
    annualGhs: 6500,
    annualSaveGhs: 1300,
    groups: [
      {
        title: "Storefronts",
        lines: ["Maximum 1 store", PRICING_STORE_URL],
      },
      {
        title: "Themes",
        lines: [
          "All themes",
          "Full color customization",
          "Font customization",
          "Logo upload",
        ],
      },
      {
        title: "Products",
        lines: ["Unlimited"],
      },
      {
        title: "Orders",
        lines: ["Unlimited"],
      },
      {
        title: "Images",
        lines: ["10 MB per image"],
      },
      {
        title: "Notifications",
        lines: ["Email + SMS auto alerts"],
      },
      {
        title: "Order Status",
        lines: ["Advanced status updates"],
      },
      {
        title: "Analytics",
        lines: ["Full insights + Excel export"],
      },
      {
        title: "Admin users",
        lines: ["1 user"],
      },
      {
        title: "SMS",
        lines: ["SMS auto notify"],
      },
      {
        title: "Support",
        lines: ["Priority support", "Same-day response"],
      },
    ],
  },
];

export type PaidPlanId = "starter" | "growth" | "pro";
export type PlanPriceOverrideMap = Partial<Record<PaidPlanId, number>>;

export function pricingPlansWithOverrides(
  overrides: PlanPriceOverrideMap,
): PricingPlan[] {
  const annualMonthsBilled = 10;
  const annualMonthsSaved = 2;
  return PRICING_PLANS.map((plan) => {
    if (plan.id === "free") return plan;
    const overrideMonthly = overrides[plan.id];
    if (!Number.isFinite(overrideMonthly) || (overrideMonthly ?? 0) <= 0) {
      return plan;
    }
    const monthly = Math.round(overrideMonthly!);
    const annual = monthly * annualMonthsBilled;
    const annualSave = monthly * annualMonthsSaved;
    return {
      ...plan,
      monthlyGhs: monthly,
      annualGhs: annual,
      annualSaveGhs: annualSave,
    };
  });
}

export function formatGhsWhole(amount: number): string {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
