import { computed, onMounted, ref } from "vue";
import {
  PRICING_PLANS,
  pricingPlansWithOverrides,
  type PlanPriceOverrideMap,
} from "../constants/pricingPlans";
import { getSupabaseBrowser, isSupabaseConfigured } from "../lib/supabase";
import { useRealtimeTableRefresh } from "./useRealtimeTableRefresh";

const PLAN_SETTING_KEYS = {
  starter: "seller_subscription_monthly_pesewas_starter",
  growth: "seller_subscription_monthly_pesewas_growth",
  pro: "seller_subscription_monthly_pesewas_pro",
} as const;

export function usePlanPricingSettings() {
  const loading = ref(false);
  const overrides = ref<PlanPriceOverrideMap>({});

  const plans = computed(() => pricingPlansWithOverrides(overrides.value));

  async function loadPlanPricingSettings() {
    if (!isSupabaseConfigured()) return;
    loading.value = true;
    try {
      const keys = Object.values(PLAN_SETTING_KEYS);
      const { data, error } = await getSupabaseBrowser()
        .from("platform_settings")
        .select("key, value")
        .in("key", keys);
      if (error || !Array.isArray(data)) return;

      const next: PlanPriceOverrideMap = {};
      for (const row of data) {
        const key = typeof row?.key === "string" ? row.key : "";
        const value = Number.parseInt(String(row?.value ?? "").trim(), 10);
        if (!Number.isFinite(value) || value <= 0) continue;
        if (key === PLAN_SETTING_KEYS.starter) next.starter = Math.round(value / 100);
        if (key === PLAN_SETTING_KEYS.growth) next.growth = Math.round(value / 100);
        if (key === PLAN_SETTING_KEYS.pro) next.pro = Math.round(value / 100);
      }
      overrides.value = next;
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => {
    void loadPlanPricingSettings();
  });

  useRealtimeTableRefresh({
    channelName: "platform-settings-plan-pricing",
    deps: () => true,
    getTables: () => [{ table: "platform_settings" }],
    onEvent: async () => {
      await loadPlanPricingSettings();
    },
  });

  return {
    loading,
    overrides,
    plans,
    basePlans: PRICING_PLANS,
    loadPlanPricingSettings,
  };
}
