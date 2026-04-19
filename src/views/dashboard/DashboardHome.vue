<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onMounted,
  onUnmounted,
  ref,
  watch,
  watchEffect,
} from "vue";
import { RouterLink } from "vue-router";
import { storeToRefs } from "pinia";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { useAuthStore } from "../../stores/auth";
import { useUiStore } from "../../stores/ui";
import { useToastStore } from "../../stores/toast";
import { useRealtimeTableRefresh } from "../../composables/useRealtimeTableRefresh";
import { planLabelFromSignupId } from "../../lib/planLabel";
import { PRICING_PLANS } from "../../constants/pricingPlans";
import {
  PLAN_FEATURE_LIMITS,
  resolvePricingPlanId,
} from "../../lib/planFeatureLimits";
import SkeletonDashboardHome from "../../components/skeleton/SkeletonDashboardHome.vue";
const DashboardKpiTimeChart = defineAsyncComponent(
  () => import("../../components/dashboard/DashboardKpiTimeChart.vue"),
);
import {
  loadKpiHistory,
  recordKpiSample,
  saveKpiHistory,
  type KpiSample,
} from "../../lib/dashboardKpiHistory";

const auth = useAuthStore();
const { sessionUserId } = storeToRefs(auth);
const toast = useToastStore();
const ui = useUiStore();
const { sellerDashboardSearch } = storeToRefs(ui);

type SellerStoreRow = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  /** Storage key in `store-logos`; empty uses `{id}/logo`. */
  logo_path: string | null;
  /** `profiles.signup_plan` (seller subscription tier). */
  signup_plan: string | null;
};

const stores = ref<SellerStoreRow[]>([]);
const announcements = ref<
  { id: string; title: string; message: string; type: string }[]
>([]);
const loading = ref(true);

const stats = computed(() => ({
  total: stores.value.length,
  active: stores.value.filter((s) => s.is_active).length,
}));
const showCreateStoreCta = computed(() => auth.platformAdminRole !== "none");

const accountPlanLabel = computed(() => {
  const raw = auth.user?.user_metadata?.signup_plan;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const id = raw.trim().toLowerCase();
  const p = PRICING_PLANS.find((x) => x.id === id);
  return p?.name ?? raw.trim();
});

/** No `signup_plan` in metadata — Platform Insight shows "Not set" and zero quotas. */
const isSellerPlanUnset = computed(() => {
  const raw = auth.user?.user_metadata?.signup_plan;
  return typeof raw !== "string" || !raw.trim();
});

const upgradePricingLink = { name: "home" as const, hash: "#pricing" };

const filteredStores = computed(() => {
  const q = sellerDashboardSearch.value.trim().toLowerCase();
  if (!q) return stores.value;
  return stores.value.filter(
    (s) => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q),
  );
});

const previewStores = computed(() => filteredStores.value.slice(0, 5));

/** Totals across the signed-in seller's stores (filled in `loadSellerDashboard`). */
const planUsage = ref({ products: 0, ordersThisMonth: 0 });

const planFeatureUsageRows = computed(() => {
  const planId = resolvePricingPlanId(auth.user?.user_metadata?.signup_plan);
  const lim = PLAN_FEATURE_LIMITS[planId];
  const storeUsed = stats.value.total;
  const prodUsed = planUsage.value.products;
  const ordUsed = planUsage.value.ordersThisMonth;

  const caps = isSellerPlanUnset.value
    ? {
        maxStores: 0 as number | null,
        maxProducts: 0 as number | null,
        maxOrdersPerMonth: 0 as number | null,
      }
    : {
        maxStores: lim.maxStores,
        maxProducts: lim.maxProducts,
        maxOrdersPerMonth: lim.maxOrdersPerMonth,
      };

  function row(
    letter: string,
    label: string,
    used: number,
    max: number | null,
  ) {
    let over: boolean;
    let pct: number;
    let right: string;
    if (max === 0) {
      over = used > 0;
      pct = used > 0 ? 100 : 0;
      right = `${used.toLocaleString()} / 0`;
    } else if (max == null) {
      over = false;
      pct = Math.min(100, Math.max(8, used > 0 ? 100 : 8));
      right = `${used.toLocaleString()} · Unlimited`;
    } else {
      over = used > max;
      pct = Math.min(100, Math.round((used / Math.max(max, 1)) * 100));
      right = `${used.toLocaleString()} / ${max.toLocaleString()}`;
    }
    return { letter, label, pct, right, over };
  }

  return [
    row("S", "Storefronts", storeUsed, caps.maxStores),
    row("P", "Products (all shops)", prodUsed, caps.maxProducts),
    row("O", "Orders (this month)", ordUsed, caps.maxOrdersPerMonth),
  ];
});

/** Wall-clock KPI samples (persisted ~48h per user in localStorage). */
const shopKpiHistory = ref<KpiSample[]>([]);
const liveKpiHistory = ref<KpiSample[]>([]);
const productKpiHistory = ref<KpiSample[]>([]);

function kpiStorageKeys(uid: string | null) {
  if (!uid) return { shops: null as string | null, live: null, products: null };
  return {
    shops: `uanditech:dash-kpi:v1:shops:${uid}`,
    live: `uanditech:dash-kpi:v1:live:${uid}`,
    products: `uanditech:dash-kpi:v1:products:${uid}`,
  };
}

function hydrateKpiHistories() {
  const uid = sessionUserId.value;
  const k = kpiStorageKeys(uid);
  shopKpiHistory.value = loadKpiHistory(k.shops);
  liveKpiHistory.value = loadKpiHistory(k.live);
  productKpiHistory.value = loadKpiHistory(k.products);
}

function persistKpiHistories() {
  const k = kpiStorageKeys(sessionUserId.value);
  saveKpiHistory(k.shops, shopKpiHistory.value);
  saveKpiHistory(k.live, liveKpiHistory.value);
  saveKpiHistory(k.products, productKpiHistory.value);
}

watch(sessionUserId, (uid) => {
  if (!uid) {
    shopKpiHistory.value = [];
    liveKpiHistory.value = [];
    productKpiHistory.value = [];
    return;
  }
  hydrateKpiHistories();
});

watch(
  () =>
    [
      loading.value,
      sessionUserId.value,
      stats.value.total,
      stats.value.active,
      planUsage.value.products,
    ] as const,
  ([ld, uid, total, active, products]) => {
    if (ld || !uid) return;
    shopKpiHistory.value = recordKpiSample(shopKpiHistory.value, total);
    liveKpiHistory.value = recordKpiSample(liveKpiHistory.value, active);
    productKpiHistory.value = recordKpiSample(
      productKpiHistory.value,
      products,
    );
    persistKpiHistories();
  },
);

/** Minute cadence: append samples so the time axis advances even when counts are flat. */
let kpiSampleTimer: number | null = null;

function storeInitial(name: string) {
  const t = name.trim();
  return t ? t[0]!.toUpperCase() : "?";
}

/** Public URL for store logo (`store-logos`), aligned with storefront / manage store. */
function storeLogoPublicUrl(
  storeId: string,
  logoPath: string | null | undefined,
): string | null {
  if (!storeId || !isSupabaseConfigured()) return null;
  const p = logoPath?.trim();
  const key = p && p.length > 0 ? p : `${storeId}/logo`;
  return getSupabaseBrowser().storage.from("store-logos").getPublicUrl(key).data
    .publicUrl;
}

function avatarGradient(seed: number) {
  const palettes = [
    "from-violet-400 to-indigo-500",
    "from-sky-400 to-blue-500",
    "from-teal-400 to-emerald-500",
    "from-rose-400 to-pink-500",
    "from-amber-400 to-orange-500",
  ];
  return palettes[Math.abs(seed) % palettes.length]!;
}

/** Row chip colors (hiring-pipeline style, cycles per store). */
const pipelineRowStyles = [
  {
    chip: "bg-violet-200/95 text-violet-900 ring-1 ring-violet-300/50",
    slugChip: "bg-violet-100/90 text-violet-800",
  },
  {
    chip: "bg-sky-200/95 text-sky-900 ring-1 ring-sky-300/50",
    slugChip: "bg-sky-100/90 text-sky-900",
  },
  {
    chip: "bg-rose-200/95 text-rose-900 ring-1 ring-rose-300/50",
    slugChip: "bg-rose-100/90 text-rose-900",
  },
  {
    chip: "bg-emerald-200/95 text-emerald-900 ring-1 ring-emerald-300/50",
    slugChip: "bg-emerald-100/90 text-emerald-900",
  },
] as const;

function pipelineRowTone(idx: number) {
  return pipelineRowStyles[idx % pipelineRowStyles.length]!;
}

async function loadSellerDashboard(silent = false) {
  if (!isSupabaseConfigured() || !sessionUserId.value) {
    if (!silent) loading.value = false;
    return;
  }
  if (!silent) loading.value = true;
  try {
    const supabase = getSupabaseBrowser();
    const uid = sessionUserId.value;
    const [storesRes, annRes] = await Promise.all([
      supabase
        .from("stores")
        .select(
          "id, slug, name, is_active, logo_path, profiles!stores_owner_id_fkey(signup_plan)",
        )
        .eq("owner_id", uid)
        .order("created_at", { ascending: false }),
      supabase
        .from("announcements")
        .select("id, title, message, type")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    if (storesRes.error) toast.error(storesRes.error.message);
    else {
      stores.value = (storesRes.data ?? []).map(
        (raw: Record<string, unknown>) => {
          const prof = raw.profiles as { signup_plan?: string | null } | null;
          const logoRaw = (raw as { logo_path?: unknown }).logo_path;
          const logoPath =
            typeof logoRaw === "string" && logoRaw.trim() ? logoRaw.trim() : null;
          return {
            id: String(raw.id),
            slug: String(raw.slug),
            name: String(raw.name),
            is_active: Boolean(raw.is_active),
            logo_path: logoPath,
            signup_plan: prof?.signup_plan?.trim() || null,
          };
        },
      );
    }
    if (annRes.error) toast.error(annRes.error.message);
    else if (annRes.data) {
      announcements.value = annRes.data as typeof announcements.value;
    }

    const storeIds = stores.value.map((s) => s.id);
    if (storeIds.length === 0) {
      planUsage.value = { products: 0, ordersThisMonth: 0 };
    } else {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const [prRes, orRes] = await Promise.all([
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .in("store_id", storeIds),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .in("store_id", storeIds)
          .gte("created_at", monthStart.toISOString()),
      ]);
      if (prRes.error) toast.error(prRes.error.message);
      if (orRes.error) toast.error(orRes.error.message);
      planUsage.value = {
        products: prRes.count ?? 0,
        ordersThisMonth: orRes.count ?? 0,
      };
    }
  } finally {
    if (!silent) loading.value = false;
  }
}

onMounted(() => {
  hydrateKpiHistories();
  void loadSellerDashboard(false);
  kpiSampleTimer = window.setInterval(() => {
    if (loading.value || !sessionUserId.value) return;
    shopKpiHistory.value = recordKpiSample(
      shopKpiHistory.value,
      stats.value.total,
      { force: true },
    );
    liveKpiHistory.value = recordKpiSample(
      liveKpiHistory.value,
      stats.value.active,
      { force: true },
    );
    productKpiHistory.value = recordKpiSample(
      productKpiHistory.value,
      planUsage.value.products,
      { force: true },
    );
    persistKpiHistories();
  }, 60_000);
});

useRealtimeTableRefresh({
  channelName: () => `seller-home-${sessionUserId.value ?? ""}`,
  deps: [sessionUserId, stores],
  getTables: () => {
    const uid = sessionUserId.value;
    if (!uid) return [];
    const specs: { table: string; filter?: string }[] = [
      { table: "stores", filter: `owner_id=eq.${uid}` },
      { table: "announcements", filter: "is_active=eq.true" },
      { table: "profiles", filter: `id=eq.${uid}` },
    ];
    for (const s of stores.value) {
      specs.push(
        { table: "products", filter: `store_id=eq.${s.id}` },
        { table: "orders", filter: `store_id=eq.${s.id}` },
      );
    }
    return specs;
  },
  onEvent: () => loadSellerDashboard(true),
});

const overviewTagline = computed(() => {
  const n = stats.value.total;
  if (n === 0) {
    return "Create your first storefront to get a shareable link and catalog.";
  }
  return `You have ${n} shop${n === 1 ? "" : "s"} — pipeline, metrics, and plan usage in view.`;
});

watchEffect(() => {
  ui.sellerOverviewTagline = overviewTagline.value;
});

onUnmounted(() => {
  ui.sellerOverviewTagline = "";
  if (kpiSampleTimer != null) {
    clearInterval(kpiSampleTimer);
    kpiSampleTimer = null;
  }
});
</script>

<template>
  <!-- Reference: ~75% main (cards + pipeline) | ~25% stacked insight cards -->
  <div
    class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(16.5rem,26%)] lg:items-start lg:gap-8 xl:gap-10"
  >
    <SkeletonDashboardHome v-if="loading" />
    <template v-else>
      <div class="min-w-0 space-y-8">
        <div class="grid gap-4 sm:grid-cols-3 sm:gap-5">
          <div
            class="flex min-h-[18.5rem] flex-col rounded-[1.75rem] border border-violet-200/50 bg-[#ece8ff] p-6 pb-8 shadow-[0_20px_50px_-32px_rgba(91,33,182,0.2)] sm:min-h-[20.5rem] sm:rounded-3xl sm:p-7 sm:pb-9 lg:min-h-[22rem]"
          >
            <p
              class="text-xs font-semibold uppercase tracking-wider text-violet-900/75"
            >
              Total shops
            </p>
            <p
              class="mt-2 text-3xl font-bold tabular-nums tracking-tight text-zinc-900 sm:text-[2rem]"
            >
              +{{ stats.total }}
            </p>
            <p
              class="mt-3 inline-flex w-fit rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-violet-800 shadow-sm ring-1 ring-violet-200/80"
            >
              Live · 48h · saved locally
            </p>
            <p class="mt-2 text-xs font-medium text-violet-900/65">
              Storefronts on your account
            </p>
            <div
              class="relative mt-auto h-36 w-full shrink-0 pt-6 sm:h-40 sm:pt-7 lg:h-44"
            >
              <DashboardKpiTimeChart
                :points="shopKpiHistory"
                stroke="#5b21b6"
                fill="rgba(91,33,182,0.2)"
                axis-stroke="rgba(91,33,182,0.45)"
                grid-stroke="rgba(91,33,182,0.12)"
              />
            </div>
          </div>
          <div
            class="flex min-h-[18.5rem] flex-col rounded-[1.75rem] border border-sky-200/50 bg-[#e0f2fe] p-6 pb-8 shadow-[0_20px_50px_-32px_rgba(3,105,161,0.18)] sm:min-h-[20.5rem] sm:rounded-3xl sm:p-7 sm:pb-9 lg:min-h-[22rem]"
          >
            <p
              class="text-xs font-semibold uppercase tracking-wider text-sky-900/75"
            >
              Live shops
            </p>
            <p
              class="mt-2 text-3xl font-bold tabular-nums tracking-tight text-zinc-900 sm:text-[2rem]"
            >
              +{{ stats.active }}
            </p>
            <p
              class="mt-3 inline-flex w-fit rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-sky-800 shadow-sm ring-1 ring-sky-200/80"
            >
              Live · 48h · saved locally
            </p>
            <p class="mt-2 text-xs font-medium text-sky-900/65">
              Published &amp; accepting orders
            </p>
            <div
              class="relative mt-auto h-36 w-full shrink-0 pt-6 sm:h-40 sm:pt-7 lg:h-44"
            >
              <DashboardKpiTimeChart
                :points="liveKpiHistory"
                stroke="#0369a1"
                fill="rgba(3,105,161,0.18)"
                axis-stroke="rgba(3,105,161,0.45)"
                grid-stroke="rgba(3,105,161,0.12)"
              />
            </div>
          </div>
          <div
            class="flex min-h-[18.5rem] flex-col rounded-[1.75rem] border border-pink-200/50 bg-[#fce7f3] p-6 pb-8 shadow-[0_20px_50px_-32px_rgba(190,24,93,0.16)] sm:min-h-[20.5rem] sm:rounded-3xl sm:p-7 sm:pb-9 lg:min-h-[22rem]"
          >
            <p
              class="text-xs font-semibold uppercase tracking-wider text-pink-900/75"
            >
              All products
            </p>
            <p
              class="mt-2 text-3xl font-bold tabular-nums tracking-tight text-zinc-900 sm:text-[2rem]"
            >
              +{{ planUsage.products }}
            </p>
            <p
              class="mt-3 inline-flex w-fit rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-pink-800 shadow-sm ring-1 ring-pink-200/80"
            >
              Live · 48h · saved locally
            </p>
            <p class="mt-2 text-xs font-medium text-pink-900/65">
              Total SKUs across every storefront
            </p>
            <div
              class="relative mt-auto h-36 w-full shrink-0 pt-6 sm:h-40 sm:pt-7 lg:h-44"
            >
              <DashboardKpiTimeChart
                :points="productKpiHistory"
                stroke="#9d174d"
                fill="rgba(157,23,77,0.18)"
                axis-stroke="rgba(157,23,77,0.45)"
                grid-stroke="rgba(157,23,77,0.12)"
              />
            </div>
          </div>
        </div>

        <div class="space-y-6">
          <div
            v-if="announcements.length"
            class="rounded-[1.75rem] border border-violet-200/50 bg-gradient-to-br from-violet-50/90 to-white/80 p-6 shadow-[0_24px_60px_-32px_rgba(109,40,217,0.15)]"
          >
            <p
              class="text-xs font-semibold uppercase tracking-wider text-violet-800"
            >
              Platform news
            </p>
            <div class="mt-4 space-y-3">
              <div
                v-for="a in announcements"
                :key="a.id"
                class="rounded-2xl border border-violet-100/90 bg-white/70 px-4 py-3"
              >
                <p class="font-semibold text-zinc-900">{{ a.title }}</p>
                <p
                  class="mt-1 text-sm leading-relaxed text-zinc-600 whitespace-pre-wrap"
                >
                  {{ a.message }}
                </p>
              </div>
            </div>
          </div>

          <div
            class="h-[60vh] overflow-hidden rounded-[1.75rem] border border-zinc-200/60 bg-white shadow-[0_28px_70px_-40px_rgba(15,23,42,0.18)]"
          >
            <div
              class="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 sm:px-6"
            >
              <h2 class="text-lg font-bold text-zinc-900">Shop pipeline</h2>
              <button
                type="button"
                class="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200/80 bg-zinc-50 text-lg font-bold leading-none text-zinc-400 transition hover:bg-white hover:text-zinc-600"
                aria-label="More"
              >
                ···
              </button>
            </div>

            <template v-if="filteredStores.length">
              <div class="overflow-x-auto">
                <table class="min-w-full text-left text-sm">
                  <thead>
                    <tr
                      class="border-b border-zinc-100 bg-zinc-50/80 text-xs font-semibold uppercase tracking-wider text-zinc-500"
                    >
                      <th class="px-5 py-3 sm:px-6">Shop</th>
                      <th class="hidden px-3 py-3 sm:table-cell">Slug</th>
                      <th class="px-3 py-3">Plan</th>
                      <th class="px-3 py-3">Status</th>
                      <th class="px-5 py-3 text-right sm:px-6">Actions</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-zinc-100">
                    <tr
                      v-for="(s, idx) in filteredStores"
                      :key="s.id"
                      class="bg-white/90 transition hover:bg-zinc-50/90"
                    >
                      <td class="px-5 py-4 sm:px-6">
                        <div class="flex min-w-0 items-center gap-3">
                          <div
                            class="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-100 shadow-sm"
                          >
                            <span
                              class="absolute inset-0 z-0 flex items-center justify-center bg-gradient-to-br text-xs font-bold text-white shadow-inner ring-1 ring-white/40"
                              :class="avatarGradient(s.name.length + idx)"
                              >{{ storeInitial(s.name) }}</span
                            >
                            <img
                              v-if="
                                s.logo_path?.trim() &&
                                storeLogoPublicUrl(s.id, s.logo_path)
                              "
                              :src="storeLogoPublicUrl(s.id, s.logo_path)!"
                              alt=""
                              class="relative z-10 h-full w-full object-cover"
                              loading="lazy"
                              @error="
                                ($event.target as HTMLImageElement).style.display =
                                  'none'
                              "
                            />
                          </div>
                          <span
                            class="min-w-0 truncate font-semibold text-zinc-900"
                            >{{ s.name }}</span
                          >
                        </div>
                      </td>
                      <td class="hidden px-3 py-4 sm:table-cell">
                        <span
                          class="inline-flex max-w-[11rem] truncate rounded-lg px-2.5 py-1 font-mono text-xs font-medium"
                          :class="pipelineRowTone(idx).slugChip"
                        >
                          /{{ s.slug }}
                        </span>
                      </td>
                      <td class="px-3 py-4 text-sm font-medium text-zinc-800">
                        {{ planLabelFromSignupId(s.signup_plan) }}
                      </td>
                      <td class="px-3 py-4">
                        <span
                          class="inline-flex min-w-[4.5rem] justify-center rounded-lg px-3 py-1.5 text-xs font-semibold tabular-nums"
                          :class="
                            s.is_active
                              ? pipelineRowTone(idx).chip
                              : 'bg-zinc-200/90 text-zinc-700 ring-1 ring-zinc-300/50'
                          "
                        >
                          {{ s.is_active ? "Live" : "Paused" }}
                        </span>
                      </td>
                      <td class="px-5 py-4 text-right sm:px-6">
                        <div class="flex flex-wrap justify-end gap-2">
                          <RouterLink
                            :to="`/${s.slug}`"
                            class="inline-flex rounded-full border border-zinc-200/90 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:border-sky-200 hover:text-sky-800"
                          >
                            View
                          </RouterLink>
                          <RouterLink
                            :to="`/dashboard/stores/${s.id}`"
                            class="inline-flex rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white shadow-md transition hover:bg-zinc-800"
                          >
                            Manage
                          </RouterLink>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>

            <div v-else-if="!stores.length" class="px-6 py-14 text-center">
              <p class="text-lg font-semibold text-zinc-900">No shops yet</p>
              <p class="mt-2 text-sm text-zinc-600">
                Spin up your first storefront — it only takes a minute.
              </p>
              <button
                v-if="showCreateStoreCta"
                type="button"
                class="mt-8 inline-flex rounded-full bg-zinc-900 px-8 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-zinc-800"
                @click="ui.openCreateStoreModal()"
              >
                Create store
              </button>
            </div>

            <div
              v-else-if="stores.length && !filteredStores.length"
              class="px-6 py-10 text-center text-sm text-zinc-500"
            >
              No shops match “{{ sellerDashboardSearch }}”.
            </div>
          </div>
        </div>
      </div>

      <div class="flex min-w-0 flex-col gap-5 lg:sticky lg:top-2 lg:self-start">
        <div
          class="flex min-h-[18.5rem] flex-col rounded-[1.75rem] border border-zinc-200/50 bg-[#f6f6fa] p-5 pb-8 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.1)] sm:min-h-[20.5rem] sm:rounded-3xl sm:p-6 sm:pb-9 lg:min-h-[22rem]"
        >
          <div class="flex shrink-0 items-center justify-between gap-3">
            <div>
              <h3 class="text-base font-bold tracking-tight text-zinc-900">
                Platform Insight
              </h3>
              <p class="mt-1 text-xs text-zinc-500">
                Your usage vs the limits included in your current plan.
              </p>
            </div>
            <button
              type="button"
              class="flex h-9 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-200/80 bg-white text-sm font-bold leading-none text-zinc-400 shadow-sm transition hover:border-zinc-300 hover:text-zinc-600"
              aria-label="More options"
            >
              ···
            </button>
          </div>

          <div class="mt-4 flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">
            <div
              class="inline-flex items-center gap-2 rounded-2xl border border-zinc-200/80 bg-white/90 px-3 py-1.5 text-[11px] shadow-sm ring-1 ring-zinc-200/50"
            >
              <span class="font-semibold uppercase tracking-wide text-zinc-500"
                >Current plan</span
              >
              <span class="font-bold text-zinc-900">{{
                accountPlanLabel ?? "Not set"
              }}</span>
            </div>
            <RouterLink
              :to="upgradePricingLink"
              class="inline-flex items-center rounded-2xl border border-indigo-200/90 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-900 shadow-sm ring-1 ring-indigo-100 transition hover:border-indigo-300 hover:bg-indigo-50/60"
            >
              {{ isSellerPlanUnset ? "Choose plan" : "Upgrade plan" }}
            </RouterLink>
          </div>

          <ul class="mt-auto space-y-4 pt-5">
            <li v-for="row in planFeatureUsageRows" :key="row.label">
              <div class="flex items-center gap-3">
                <span
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-xs font-bold text-zinc-700 shadow-sm ring-1 ring-zinc-200/60"
                  >{{ row.letter }}</span
                >
                <div class="min-w-0 flex-1">
                  <div
                    class="flex items-center justify-between gap-2 text-sm font-semibold text-zinc-900"
                  >
                    <span class="truncate">{{ row.label }}</span>
                    <span
                      class="max-w-[11rem] shrink-0 text-right text-[11px] font-semibold tabular-nums sm:max-w-none sm:text-xs"
                      :class="
                        row.over ? 'text-amber-700' : 'text-zinc-600'
                      "
                      :title="row.right"
                      >{{ row.right }}</span
                    >
                  </div>
                  <div
                    class="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200/90"
                  >
                    <div
                      class="h-full rounded-full transition-all"
                      :class="
                        row.over
                          ? 'bg-amber-500'
                          : 'bg-zinc-800'
                      "
                      :style="{ width: `${row.pct}%` }"
                    />
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <div
          class="flex h-[60vh] flex-col overflow-hidden rounded-[1.75rem] border border-zinc-200/50 bg-[#f3f3f7] p-5 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.1)] sm:rounded-3xl sm:p-6"
        >
          <div class="shrink-0">
            <h3 class="text-base font-bold tracking-tight text-zinc-900">
              Storefronts
            </h3>
            <p class="mt-1 text-xs text-zinc-500">
              Recent shops — open the live link or jump into the workspace.
            </p>
          </div>

          <div
            class="mt-5 min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-0.5"
          >
            <ul v-if="previewStores.length" class="space-y-5">
            <li
              v-for="(s, idx) in previewStores"
              :key="s.id"
              class="flex gap-3"
            >
              <div
                class="relative flex h-11 w-11 shrink-0 overflow-hidden rounded-full border border-zinc-200/70 bg-zinc-100 shadow-md ring-2 ring-white"
              >
                <span
                  class="absolute inset-0 z-0 flex items-center justify-center bg-gradient-to-br text-sm font-bold text-white"
                  :class="avatarGradient(idx + s.name.length)"
                  >{{ storeInitial(s.name) }}</span
                >
                <img
                  v-if="
                    s.logo_path?.trim() &&
                    storeLogoPublicUrl(s.id, s.logo_path)
                  "
                  :src="storeLogoPublicUrl(s.id, s.logo_path)!"
                  alt=""
                  class="relative z-10 h-full w-full object-cover"
                  loading="lazy"
                  @error="
                    ($event.target as HTMLImageElement).style.display = 'none'
                  "
                />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="truncate font-bold text-zinc-900">
                      {{ s.name }}
                    </p>
                    <p class="mt-0.5 truncate font-mono text-xs text-zinc-500">
                      /{{ s.slug }}
                    </p>
                  </div>
                  <div class="flex shrink-0 gap-1">
                    <RouterLink
                      :to="`/${s.slug}`"
                      class="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300/80 bg-white text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-800"
                      title="Open live shop"
                    >
                      <svg
                        class="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="1.75"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.608-1.29.608H5.25c-.621 0-1.125-.504-1.125-1.125V6.75zM18 9.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm-12 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
                        />
                      </svg>
                    </RouterLink>
                    <RouterLink
                      :to="`/dashboard/stores/${s.id}`"
                      class="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300/80 bg-white text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-800"
                      title="Manage store"
                    >
                      <svg
                        class="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="1.75"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                        />
                      </svg>
                    </RouterLink>
                  </div>
                </div>
                <span
                  class="mt-2 inline-flex rounded-full bg-zinc-800 px-3 py-1 text-[11px] font-semibold text-white"
                >
                  {{ s.is_active ? "Live" : "Paused" }}
                </span>
              </div>
            </li>
            </ul>
            <p v-else class="text-sm text-zinc-500">
              Create a store to see it listed here.
            </p>
          </div>

          <div
            class="mt-6 shrink-0 rounded-2xl border border-zinc-200/50 bg-white/70 px-4 py-3"
          >
            <p class="text-xs font-semibold text-zinc-800">Quick checklist</p>
            <ul
              class="mt-2 space-y-2 text-[11px] leading-relaxed text-zinc-600"
            >
              <li class="flex gap-2">
                <span class="text-teal-600" aria-hidden="true">✓</span>
                Short slug, clear store name.
              </li>
              <li class="flex gap-2">
                <span class="text-teal-600" aria-hidden="true">✓</span>
                Publish products when ready.
              </li>
              <li class="flex gap-2">
                <span class="text-teal-600" aria-hidden="true">✓</span>
                Share your public shop link.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
