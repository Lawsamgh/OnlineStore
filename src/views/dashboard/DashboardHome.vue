<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
  watchEffect,
} from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { useAuthStore } from "../../stores/auth";
import { useUiStore } from "../../stores/ui";
import { useToastStore } from "../../stores/toast";
import { useRealtimeTableRefresh } from "../../composables/useRealtimeTableRefresh";
import { planLabelFromSignupId } from "../../lib/planLabel";
import { formatGhsWhole, PRICING_PLANS } from "../../constants/pricingPlans";
import {
  PLAN_FEATURE_LIMITS,
  resolvePricingPlanId,
} from "../../lib/planFeatureLimits";
import { normalizeSignupPlanId } from "../../constants/planEntitlements";
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
import { formatFunctionsInvokeError } from "../../lib/formatFunctionsInvokeError";
import { refreshSessionForEdgeFunctions } from "../../lib/refreshSessionForEdgeFunctions";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
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
  /** `seller_subscriptions` — subscription card for platform staff. */
  sub_pricing_plan_id: string | null;
  sub_payment_channel: string | null;
  sub_paid_amount_pesewas: number | null;
  sub_status: string | null;
  sub_current_period_end: string | null;
  sub_updated_at: string | null;
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

const planPickerOpen = ref(false);

/** Earliest `current_period_end` among active/trialing store subs (for upgrade guard). */
const dashboardPaidPlanRenewalEnd = ref<string | null>(null);

const PAID_ACCOUNT_PLAN_IDS = new Set(["starter", "growth", "pro"]);
const PLAN_UPGRADE_GUARD_DAYS = 7;

function formatSubscriptionEndLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function accountPaidPlanNotDueSoon(): boolean {
  const id = normalizeSignupPlanId(
    typeof auth.user?.user_metadata?.signup_plan === "string"
      ? auth.user.user_metadata.signup_plan
      : undefined,
  );
  if (!id || !PAID_ACCOUNT_PLAN_IDS.has(id)) return false;
  const endIso = dashboardPaidPlanRenewalEnd.value;
  if (!endIso) return false;
  const end = new Date(endIso).getTime();
  if (Number.isNaN(end)) return false;
  const cutoff = Date.now() + PLAN_UPGRADE_GUARD_DAYS * 86_400_000;
  return end > cutoff;
}

function onUpgradePlanClick() {
  if (accountPaidPlanNotDueSoon()) {
    const when = formatSubscriptionEndLabel(dashboardPaidPlanRenewalEnd.value!);
    toast.info(`You already have an active plan, which ends on ${when}.`);
    return;
  }
  openPlanPicker();
}

function openPlanPicker() {
  planPickerOpen.value = true;
}

function closePlanPicker() {
  planPickerOpen.value = false;
}

const paystackPlanVerifyBusy = ref(false);

function paystackReturnReference(): string {
  const raw = route.query.reference ?? route.query.trxref;
  const one = Array.isArray(raw) ? raw[0] : raw;
  return typeof one === "string" ? one.trim() : "";
}

/** After Paystack redirects back with `reference` / `trxref`, confirm payment and unlock the tier. */
async function consumePaystackPlanReturn() {
  const reference = paystackReturnReference();
  if (!reference.startsWith("plan_")) return;
  if (!isSupabaseConfigured() || !sessionUserId.value) return;
  if (paystackPlanVerifyBusy.value) return;

  const lockKey = `paystack_plan_verify_${reference}`;
  if (sessionStorage.getItem(lockKey) === "1") {
    await router.replace({ name: "dashboard", query: {} });
    return;
  }

  paystackPlanVerifyBusy.value = true;
  try {
    const sb = getSupabaseBrowser();
    const prep = await refreshSessionForEdgeFunctions(sb);
    if (!prep.ok) {
      toast.error(prep.message);
      await router.replace({ name: "dashboard", query: {} });
      return;
    }
    auth.syncSession(prep.session);
    const { data, error } = await sb.functions.invoke("paystack-verify-plan", {
      body: { reference },
      headers: prep.headers,
    });
    if (error) {
      const bodyErr =
        data && typeof data === "object" && "error" in data
          ? String((data as { error?: unknown }).error ?? "")
          : "";
      toast.error(
        bodyErr ||
          formatFunctionsInvokeError(error, "paystack-verify-plan") ||
          "Could not verify payment.",
      );
      await router.replace({ name: "dashboard", query: {} });
      return;
    }
    sessionStorage.setItem(lockKey, "1");
    const { data: refData, error: refErr } = await sb.auth.refreshSession();
    if (!refErr && refData.session) auth.syncSession(refData.session);
    else await auth.refreshSessionFromSupabase();
    toast.success(
      "Your seller account plan is active. Each shop you own is updated with the same plan for platform billing records.",
    );
    await router.replace({ name: "dashboard", query: {} });
  } finally {
    paystackPlanVerifyBusy.value = false;
  }
}

async function choosePlanAndDismiss(planId: string) {
  const plan = PRICING_PLANS.find((p) => p.id === planId);
  if (!plan) return;

  closePlanPicker();
  await nextTick();

  if (!isSupabaseConfigured()) {
    toast.error("Sign in is required to change your plan.");
    return;
  }
  if (!auth.user) {
    toast.error("Sign in required.");
    return;
  }

  const sb = getSupabaseBrowser();

  if (plan.id === "free") {
    const { error } = await sb.auth.updateUser({
      data: { ...auth.user.user_metadata, signup_plan: "free" },
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    await auth.refreshSessionFromSupabase();
    toast.success("You are on the Free plan.");
    await router.replace({ name: "dashboard", query: {} });
    return;
  }

  if (plan.monthlyGhs <= 0) return;

  const prep = await refreshSessionForEdgeFunctions(sb);
  if (!prep.ok) {
    toast.error(prep.message);
    return;
  }
  auth.syncSession(prep.session);
  const { data, error } = await sb.functions.invoke("paystack-init", {
    body: { plan_id: plan.id },
    headers: prep.headers,
  });
  if (error) {
    const bodyErr =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: unknown }).error ?? "")
        : "";
    toast.error(
      bodyErr ||
        formatFunctionsInvokeError(error, "paystack-init") ||
        "Could not start checkout.",
    );
    return;
  }
  const url =
    data && typeof data === "object" && "authorization_url" in data
      ? String(
          (data as { authorization_url?: unknown }).authorization_url ?? "",
        )
      : "";
  if (!url) {
    toast.error("Could not start checkout.");
    return;
  }
  window.location.assign(url);
}

watch(
  () =>
    [route.query.reference, route.query.trxref, sessionUserId.value] as const,
  () => {
    void consumePaystackPlanReturn();
  },
  { immediate: true },
);

/** Only when `signup_plan` is set — avoids marking Free as “current” when plan is “Not set”. */
const currentPlanIdForPicker = computed(() => {
  const raw = auth.user?.user_metadata?.signup_plan;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return resolvePricingPlanId(raw);
});

const planSlideIndex = ref(0);
const planSlideDragStartX = ref<number | null>(null);

const planSlideCount = PRICING_PLANS.length;

const activePlanSlide = computed(
  () => PRICING_PLANS[planSlideIndex.value] ?? PRICING_PLANS[0]!,
);

/**
 * Track is `n × 100%` of the viewport; each slide is `100/n %` of the track.
 * `translateX` % is relative to the track, so `-index × (100/n) %` moves one slide.
 */
const planSlideTransformPct = computed(
  () => (100 / planSlideCount) * planSlideIndex.value,
);

const planSlideTrackStyle = computed(() => ({
  width: `${planSlideCount * 100}%`,
  transform: `translate3d(-${planSlideTransformPct.value}%, 0, 0)`,
}));

const planSlideItemWidthPct = 100 / planSlideCount;

function syncPlanSlideToContext() {
  const cur = currentPlanIdForPicker.value;
  if (cur) {
    const idx = PRICING_PLANS.findIndex((p) => p.id === cur);
    planSlideIndex.value = idx >= 0 ? idx : 0;
    return;
  }
  const hi = PRICING_PLANS.findIndex((p) => p.highlighted);
  planSlideIndex.value = hi >= 0 ? hi : 0;
}

function planSlideGo(i: number) {
  planSlideIndex.value = Math.max(0, Math.min(planSlideCount - 1, i));
}

function planSlideNext() {
  planSlideGo(planSlideIndex.value + 1);
}

function planSlidePrev() {
  planSlideGo(planSlideIndex.value - 1);
}

function onPlanSlidePointerDown(e: PointerEvent) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const t = e.target as HTMLElement | null;
  // Clicks on "Choose …" / dots / links must not run swipe capture — capture steals
  // pointerup from the button and the click often never fires (Paystack never starts).
  if (t?.closest("button, a, input, select, textarea")) return;
  planSlideDragStartX.value = e.clientX;
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    /* older browsers */
  }
}

function onPlanSlidePointerUp(e: PointerEvent) {
  const start = planSlideDragStartX.value;
  planSlideDragStartX.value = null;
  try {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  } catch {
    /* noop */
  }
  if (start == null) return;
  const dx = e.clientX - start;
  if (dx < -40) planSlideNext();
  else if (dx > 40) planSlidePrev();
}

function onPlanSlidePointerCancel() {
  planSlideDragStartX.value = null;
}

function onPlanPickerDocKeydown(e: KeyboardEvent) {
  if (!planPickerOpen.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closePlanPicker();
    return;
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    planSlidePrev();
    return;
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    planSlideNext();
  }
}

watch(planPickerOpen, async (open) => {
  document.body.style.overflow = open ? "hidden" : "";
  if (open) {
    document.addEventListener("keydown", onPlanPickerDocKeydown);
    await nextTick();
    syncPlanSlideToContext();
  } else {
    document.removeEventListener("keydown", onPlanPickerDocKeydown);
  }
});

const filteredStores = computed(() => {
  const q = sellerDashboardSearch.value.trim().toLowerCase();
  if (!q) return stores.value;
  return stores.value.filter(
    (s) => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q),
  );
});

const previewStores = computed(() => filteredStores.value.slice(0, 5));

/**
 * Stable key for Realtime resubscribe scope only — **not** the full `stores`
 * array. Watching `stores` directly re-fired after every silent refetch
 * (same shop IDs), tearing down channels and amplifying flicker.
 */
const dashboardRealtimeScopeKey = computed(() => {
  const uid = sessionUserId.value ?? "";
  if (!uid) return "";
  const ids = stores.value
    .map((s) => s.id)
    .slice()
    .sort()
    .join("\0");
  return `${uid}\0${ids}`;
});

/** Avoids Storefronts vs Subscriptions flash before `admin_roles` is read. */
const sellerSideCardRoleReady = computed(
  () => !auth.isSignedIn || auth.platformStaffRoleResolved,
);

function adminStorePlanLabel(s: SellerStoreRow): string {
  const id = s.sub_pricing_plan_id;
  if (!id) return "—";
  const p = PRICING_PLANS.find((x) => x.id === id);
  return p?.name ?? id;
}

function adminStorePaymentChannelLabel(s: SellerStoreRow): string {
  const ch = s.sub_payment_channel;
  if (!ch?.trim()) return "—";
  return ch
    .split(/_+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function adminStoreHasSubscriptionSnapshot(s: SellerStoreRow): boolean {
  return Boolean(
    s.sub_pricing_plan_id?.trim() ||
    s.sub_payment_channel?.trim() ||
    (s.sub_paid_amount_pesewas != null &&
      Number.isFinite(s.sub_paid_amount_pesewas)),
  );
}

const subscriptionLedgerIconGradients = [
  "from-zinc-800 to-zinc-600",
  "from-slate-900 to-zinc-700",
  "from-neutral-800 to-stone-600",
  "from-zinc-900 to-neutral-700",
] as const;

function subscriptionLedgerIconWrapClass(idx: number): string {
  const g =
    subscriptionLedgerIconGradients[
      idx % subscriptionLedgerIconGradients.length
    ]!;
  return `bg-gradient-to-br ${g}`;
}

function formatSubscriptionLedgerDate(iso: string | null | undefined): string {
  if (!iso || typeof iso !== "string") return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

type SubscriptionLedgerRow = {
  id: string;
  iconLetter: string;
  iconClass: string;
  title: string;
  subtitle: string;
  amount: string;
  amountPositive: boolean;
};

const adminSubscriptionLedgerRows = computed((): SubscriptionLedgerRow[] => {
  return previewStores.value.map((s, idx) => {
    const planLabel = adminStorePlanLabel(s);
    const channelShown = adminStorePaymentChannelLabel(s);
    const dateStr = formatSubscriptionLedgerDate(
      s.sub_updated_at || s.sub_current_period_end,
    );
    const subtitleParts: string[] = [];
    if (channelShown !== "—") subtitleParts.push(channelShown);
    if (dateStr) subtitleParts.push(`Updated ${dateStr}`);
    let title: string;
    if (s.sub_pricing_plan_id) {
      title = planLabel;
    } else if (adminStoreHasSubscriptionSnapshot(s)) {
      title =
        s.sub_status === "active" || s.sub_status === "trialing"
          ? "Platform subscription"
          : "Subscription";
    } else {
      title = "No Paystack record";
    }
    const subtitle =
      subtitleParts.length > 0
        ? subtitleParts.join(" · ")
        : adminStoreHasSubscriptionSnapshot(s)
          ? "Add plan metadata on next checkout verify"
          : "Run checkout to create a subscription row";

    const pesewas = s.sub_paid_amount_pesewas;
    const hasAmount = pesewas != null && Number.isFinite(pesewas);
    const amountFmt = hasAmount
      ? new Intl.NumberFormat("en-GH", {
          style: "currency",
          currency: "GHS",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(pesewas / 100)
      : "";
    const amount = hasAmount ? `+${amountFmt}` : "—";

    const initialSource =
      s.sub_pricing_plan_id && planLabel !== "—" ? planLabel : title;
    const iconLetter =
      initialSource.length && initialSource !== "—"
        ? initialSource.charAt(0).toUpperCase()
        : "S";

    return {
      id: s.id,
      iconLetter,
      iconClass: subscriptionLedgerIconWrapClass(idx),
      title,
      subtitle,
      amount,
      amountPositive: hasAmount,
    };
  });
});

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
            typeof logoRaw === "string" && logoRaw.trim()
              ? logoRaw.trim()
              : null;
          return {
            id: String(raw.id),
            slug: String(raw.slug),
            name: String(raw.name),
            is_active: Boolean(raw.is_active),
            logo_path: logoPath,
            signup_plan: prof?.signup_plan?.trim() || null,
            sub_pricing_plan_id: null,
            sub_payment_channel: null,
            sub_paid_amount_pesewas: null,
            sub_status: null,
            sub_current_period_end: null,
            sub_updated_at: null,
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
      dashboardPaidPlanRenewalEnd.value = null;
    } else {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const [prRes, orRes, subRes] = await Promise.all([
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .in("store_id", storeIds),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .in("store_id", storeIds)
          .gte("created_at", monthStart.toISOString()),
        supabase
          .from("seller_subscriptions")
          .select(
            "store_id, current_period_end, status, pricing_plan_id, payment_channel, paid_amount_pesewas, updated_at",
          )
          .in("store_id", storeIds),
      ]);
      if (prRes.error) toast.error(prRes.error.message);
      if (orRes.error) toast.error(orRes.error.message);
      planUsage.value = {
        products: prRes.count ?? 0,
        ordersThisMonth: orRes.count ?? 0,
      };
      if (subRes.error) {
        dashboardPaidPlanRenewalEnd.value = null;
        stores.value = stores.value.map((s) => ({
          ...s,
          sub_pricing_plan_id: null,
          sub_payment_channel: null,
          sub_paid_amount_pesewas: null,
          sub_status: null,
          sub_current_period_end: null,
          sub_updated_at: null,
        }));
      } else {
        type SubRow = {
          store_id?: string;
          current_period_end?: string | null;
          status?: string | null;
          pricing_plan_id?: string | null;
          payment_channel?: string | null;
          paid_amount_pesewas?: number | null;
          updated_at?: string | null;
        };
        const rows = (subRes.data ?? []) as SubRow[];
        let minEnd: string | null = null;
        const billingByStore = new Map<
          string,
          {
            sub_pricing_plan_id: string | null;
            sub_payment_channel: string | null;
            sub_paid_amount_pesewas: number | null;
            sub_status: string | null;
            sub_current_period_end: string | null;
            sub_updated_at: string | null;
          }
        >();
        for (const row of rows) {
          const st = typeof row.status === "string" ? row.status.trim() : "";
          if (st === "active" || st === "trialing") {
            const end =
              typeof row.current_period_end === "string"
                ? row.current_period_end
                : null;
            if (end && (!minEnd || new Date(end) < new Date(minEnd))) {
              minEnd = end;
            }
          }
          const sid = typeof row.store_id === "string" ? row.store_id : "";
          if (!sid) continue;
          const planRaw = row.pricing_plan_id;
          const planId =
            typeof planRaw === "string" && planRaw.trim()
              ? planRaw.trim().toLowerCase()
              : null;
          const chRaw = row.payment_channel;
          const channel =
            typeof chRaw === "string" && chRaw.trim()
              ? chRaw.trim().toLowerCase()
              : null;
          const paid =
            typeof row.paid_amount_pesewas === "number" &&
            Number.isFinite(row.paid_amount_pesewas)
              ? row.paid_amount_pesewas
              : null;
          const endRaw = row.current_period_end;
          const periodEnd =
            typeof endRaw === "string" && endRaw.trim() ? endRaw.trim() : null;
          const upRaw = row.updated_at;
          const updatedAt =
            typeof upRaw === "string" && upRaw.trim() ? upRaw.trim() : null;
          billingByStore.set(sid, {
            sub_pricing_plan_id: planId,
            sub_payment_channel: channel,
            sub_paid_amount_pesewas: paid,
            sub_status: st || null,
            sub_current_period_end: periodEnd,
            sub_updated_at: updatedAt,
          });
        }
        dashboardPaidPlanRenewalEnd.value = minEnd;
        stores.value = stores.value.map((s) => {
          const b = billingByStore.get(s.id);
          return {
            ...s,
            sub_pricing_plan_id: b?.sub_pricing_plan_id ?? null,
            sub_payment_channel: b?.sub_payment_channel ?? null,
            sub_paid_amount_pesewas: b?.sub_paid_amount_pesewas ?? null,
            sub_status: b?.sub_status ?? null,
            sub_current_period_end: b?.sub_current_period_end ?? null,
            sub_updated_at: b?.sub_updated_at ?? null,
          };
        });
      }
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
  deps: [dashboardRealtimeScopeKey],
  debounceMs: 900,
  getTables: () => {
    const uid = sessionUserId.value;
    if (!uid) return [];
    const specs: { table: string; filter?: string }[] = [
      { table: "stores", filter: `owner_id=eq.${uid}` },
      { table: "announcements", filter: "is_active=eq.true" },
      // Omit `profiles`: `last_seen_at` heartbeat would refetch the whole
      // dashboard on an interval unrelated to shops or subscriptions.
    ];
    for (const s of stores.value) {
      specs.push(
        { table: "products", filter: `store_id=eq.${s.id}` },
        { table: "orders", filter: `store_id=eq.${s.id}` },
        { table: "seller_subscriptions", filter: `store_id=eq.${s.id}` },
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
  document.removeEventListener("keydown", onPlanPickerDocKeydown);
  if (planPickerOpen.value) {
    document.body.style.overflow = "";
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
            class="h-[54vh] overflow-hidden rounded-[1.75rem] border border-zinc-200/60 bg-white shadow-[0_28px_70px_-40px_rgba(15,23,42,0.18)]"
          >
            <div
              class="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 sm:px-6"
            >
              <h2 class="text-lg font-bold text-zinc-900">Shop pipeline</h2>
              <button
                type="button"
                class="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200/80 bg-zinc-50 text-zinc-600 transition hover:bg-white hover:text-zinc-800"
                aria-label="Chat"
              >
                <svg
                  class="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.75"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
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
                                (
                                  $event.target as HTMLImageElement
                                ).style.display = 'none'
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
            <button
              type="button"
              class="inline-flex items-center rounded-2xl border border-indigo-200/90 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-900 shadow-sm ring-1 ring-indigo-100 transition hover:border-indigo-300 hover:bg-indigo-50/60"
              @click="onUpgradePlanClick"
            >
              {{ isSellerPlanUnset ? "Choose plan" : "Upgrade plan" }}
            </button>
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
                      :class="row.over ? 'text-amber-700' : 'text-zinc-600'"
                      :title="row.right"
                      >{{ row.right }}</span
                    >
                  </div>
                  <div
                    class="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200/90"
                  >
                    <div
                      class="h-full rounded-full transition-all"
                      :class="row.over ? 'bg-amber-500' : 'bg-zinc-800'"
                      :style="{ width: `${row.pct}%` }"
                    />
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <template v-if="sellerSideCardRoleReady">
          <div
            :class="auth.isPlatformStaff ? 'flex min-h-0 flex-col gap-5' : ''"
          >
            <div
              :class="
                auth.isPlatformStaff
                  ? 'flex max-h-[min(38vh,22rem)] min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-zinc-200/50 bg-[#f3f3f7] p-5 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.1)] sm:rounded-3xl sm:p-6'
                  : 'flex h-[60vh] flex-col overflow-hidden rounded-[1.75rem] border border-zinc-200/50 bg-[#f3f3f7] p-5 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.1)] sm:rounded-3xl sm:p-6'
              "
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
                          ($event.target as HTMLImageElement).style.display =
                            'none'
                        "
                      />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                          <p class="truncate font-bold text-zinc-900">
                            {{ s.name }}
                          </p>
                          <p
                            class="mt-0.5 truncate font-mono text-xs text-zinc-500"
                          >
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
                v-if="auth.isPlatformStaff"
                class="mt-4 shrink-0 rounded-xl border border-zinc-200/60 bg-white/60 px-3 py-2 text-[11px] leading-snug text-zinc-500"
              >
                Paystack subscription rows for your shops are in the
                <span class="font-semibold text-zinc-700">Subscriptions</span>
                card below.
              </div>
            </div>

            <div
              v-if="auth.isPlatformStaff"
              class="flex flex-col overflow-hidden rounded-[1.75rem] border border-zinc-200/50 bg-[#f3f3f7] p-5 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.1)] sm:rounded-3xl sm:p-6"
            >
              <div class="shrink-0">
                <h3 class="text-base font-bold tracking-tight text-zinc-900">
                  Subscriptions
                </h3>
                <p class="mt-1 text-xs text-zinc-500">
                  <span class="font-medium text-zinc-600"
                    >seller_subscriptions</span
                  >
                  — latest Paystack fields per shop (matches your search, up to
                  five).
                </p>
              </div>

              <div
                class="mt-5 max-h-[min(70dvh,28rem)] overflow-y-auto overscroll-y-contain pr-0.5"
              >
                <ul
                  v-if="adminSubscriptionLedgerRows.length"
                  class="divide-y divide-zinc-200/60 overflow-hidden rounded-2xl border border-zinc-200/70 bg-white/90 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset] ring-1 ring-zinc-100/90"
                >
                  <li
                    v-for="row in adminSubscriptionLedgerRows"
                    :key="row.id"
                    class="group flex items-center gap-3 px-3 py-3.5 transition-colors hover:bg-sky-50/40 sm:gap-4 sm:px-4"
                  >
                    <div
                      class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-md ring-1 ring-black/10"
                      :class="row.iconClass"
                    >
                      {{ row.iconLetter }}
                    </div>
                    <div class="min-w-0 flex-1">
                      <p
                        class="truncate text-[0.9375rem] font-semibold leading-snug tracking-tight text-zinc-900"
                      >
                        {{ row.title }}
                      </p>
                      <p class="mt-0.5 truncate text-xs text-zinc-500">
                        {{ row.subtitle }}
                      </p>
                    </div>
                    <div
                      class="shrink-0 text-right text-[0.9375rem] font-bold tabular-nums tracking-tight"
                      :class="
                        row.amountPositive ? 'text-sky-600' : 'text-zinc-400'
                      "
                    >
                      {{ row.amount }}
                    </div>
                  </li>
                </ul>
                <div
                  v-else
                  class="rounded-2xl border border-dashed border-zinc-300/90 bg-zinc-50/90 px-4 py-10 text-center"
                >
                  <p class="text-sm font-medium text-zinc-600">
                    No storefronts yet
                  </p>
                  <p class="mt-1 text-xs text-zinc-500">
                    Subscription rows appear here after you create a shop.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>

  <Teleport to="body">
    <Transition name="dash-plan-picker">
      <div
        v-if="planPickerOpen"
        class="fixed inset-0 z-[340] flex items-center justify-center p-3 sm:p-5"
        role="presentation"
      >
        <div
          class="absolute inset-0 bg-zinc-900/50 backdrop-blur-sm"
          aria-hidden="true"
        />
        <div
          class="relative z-10 flex max-h-[min(94dvh,64rem)] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-zinc-200/90 bg-white shadow-[0_28px_90px_-28px_rgba(15,23,42,0.45)] ring-1 ring-zinc-900/[0.04] sm:max-w-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dash-plan-picker-title"
        >
          <div
            class="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200/80 bg-white px-4 py-4 sm:px-6 sm:py-5"
          >
            <div class="min-w-0">
              <h2
                id="dash-plan-picker-title"
                class="text-lg font-bold tracking-tight text-zinc-900 sm:text-xl"
              >
                Plans &amp; pricing
              </h2>
              <p class="mt-1 text-sm leading-relaxed text-zinc-600">
                Swipe or use arrows and dots. Keys: ← → · Esc closes.
              </p>
            </div>
            <button
              type="button"
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200/90 bg-white text-zinc-500 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
              aria-label="Close"
              @click="closePlanPicker"
            >
              <svg
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div
            class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-zinc-50/80"
          >
            <div
              class="shrink-0 border-b border-zinc-200/80 bg-white px-4 py-4 sm:px-6"
            >
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-zinc-50 text-zinc-700 shadow-sm transition hover:border-indigo-200 hover:bg-white hover:text-indigo-900 disabled:pointer-events-none disabled:opacity-30"
                  aria-label="Previous plan"
                  :disabled="planSlideIndex <= 0"
                  @click="planSlidePrev"
                >
                  <svg
                    class="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M15.75 19.5L8.25 12l7.5-7.5"
                    />
                  </svg>
                </button>
                <div
                  class="flex min-w-0 flex-1 justify-center gap-1.5 sm:gap-2"
                  role="tablist"
                  aria-label="Pricing plans"
                >
                  <button
                    v-for="(p, i) in PRICING_PLANS"
                    :key="`dot-${p.id}`"
                    type="button"
                    role="tab"
                    :aria-selected="i === planSlideIndex"
                    :aria-label="`Show ${p.name} plan`"
                    class="h-2 rounded-full transition-all duration-300 ease-out"
                    :class="
                      i === planSlideIndex
                        ? 'w-7 bg-indigo-600 shadow-sm sm:w-9'
                        : 'w-2 bg-zinc-300 hover:bg-zinc-400'
                    "
                    @click="planSlideGo(i)"
                  />
                </div>
                <button
                  type="button"
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-zinc-50 text-zinc-700 shadow-sm transition hover:border-indigo-200 hover:bg-white hover:text-indigo-900 disabled:pointer-events-none disabled:opacity-30"
                  aria-label="Next plan"
                  :disabled="planSlideIndex >= planSlideCount - 1"
                  @click="planSlideNext"
                >
                  <svg
                    class="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M8.25 4.5l7.5 7.5-7.5 7.5"
                    />
                  </svg>
                </button>
              </div>
              <p
                class="mt-3 text-center text-[11px] font-medium uppercase tracking-wider text-zinc-400"
                aria-live="polite"
              >
                Plan {{ planSlideIndex + 1 }} of {{ planSlideCount }}
              </p>
              <p
                class="mt-1 truncate text-center text-lg font-bold tracking-tight text-zinc-900"
              >
                {{ activePlanSlide.name }}
              </p>
            </div>

            <div class="min-h-0 flex-1 px-4 pb-5 pt-3 sm:px-6 sm:pb-6 sm:pt-4">
              <div
                class="plan-slide-viewport relative isolate w-full overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm"
                @pointerdown="onPlanSlidePointerDown"
                @pointerup="onPlanSlidePointerUp"
                @pointercancel="onPlanSlidePointerCancel"
              >
                <div
                  class="plan-slide-track flex min-h-[min(32rem,58dvh)] sm:min-h-[min(36rem,60dvh)]"
                  :style="planSlideTrackStyle"
                >
                  <article
                    v-for="(plan, slideIdx) in PRICING_PLANS"
                    :key="plan.id"
                    class="box-border flex min-h-[min(32rem,58dvh)] shrink-0 flex-col overflow-hidden sm:min-h-[min(36rem,60dvh)]"
                    :style="{ width: `${planSlideItemWidthPct}%` }"
                    :class="[
                      plan.id === currentPlanIdForPicker
                        ? 'ring-2 ring-inset ring-indigo-400/45'
                        : plan.highlighted
                          ? 'ring-2 ring-inset ring-lime-400/50'
                          : '',
                      slideIdx !== planSlideIndex ? 'pointer-events-none' : '',
                    ]"
                  >
                    <div
                      class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain p-5 sm:p-6"
                    >
                      <div
                        class="flex flex-wrap items-start justify-between gap-2"
                      >
                        <p
                          class="text-[11px] font-bold uppercase tracking-wide text-zinc-500"
                        >
                          {{ plan.name }}
                        </p>
                        <span
                          v-if="plan.id === currentPlanIdForPicker"
                          class="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-900"
                        >
                          Current
                        </span>
                        <span
                          v-else-if="plan.highlighted"
                          class="rounded-full bg-lime-300/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-900"
                        >
                          Popular
                        </span>
                      </div>
                      <p
                        v-if="plan.audience"
                        class="text-sm leading-relaxed text-zinc-600"
                      >
                        {{ plan.audience }}
                      </p>
                      <p class="flex flex-wrap items-baseline gap-1.5">
                        <span
                          v-if="plan.monthlyGhs === 0"
                          class="text-3xl font-semibold tracking-tight text-zinc-950"
                        >
                          Free
                        </span>
                        <template v-else>
                          <span
                            class="text-3xl font-semibold tabular-nums tracking-tight text-zinc-950"
                          >
                            {{ formatGhsWhole(plan.monthlyGhs) }}
                          </span>
                          <span class="text-sm font-medium text-zinc-500"
                            >/ month</span
                          >
                        </template>
                      </p>
                      <div class="min-h-0 flex-1 border-t border-zinc-100 pt-4">
                        <p
                          class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500"
                        >
                          What's included
                        </p>
                        <div
                          class="max-h-[14rem] touch-pan-y divide-y divide-zinc-100 overflow-y-auto overscroll-y-contain rounded-xl border border-zinc-100 bg-zinc-50/80 sm:max-h-[17rem]"
                        >
                          <div
                            v-for="group in plan.groups"
                            :key="`${plan.id}-${group.title}`"
                            class="px-3 py-2 sm:px-3.5 sm:py-2.5"
                          >
                            <template v-if="group.lines.length === 1">
                              <div
                                class="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                              >
                                <h4
                                  class="shrink-0 text-[10px] font-bold uppercase tracking-wide text-zinc-800"
                                >
                                  {{ group.title }}
                                </h4>
                                <p
                                  class="min-w-0 text-xs font-medium leading-relaxed text-zinc-700 sm:text-right"
                                >
                                  {{ group.lines[0] }}
                                </p>
                              </div>
                            </template>
                            <template v-else>
                              <h4
                                class="text-[10px] font-bold uppercase tracking-wide text-zinc-800"
                              >
                                {{ group.title }}
                              </h4>
                              <ul
                                class="mt-1.5 space-y-1 text-xs leading-relaxed text-zinc-700"
                              >
                                <li
                                  v-for="(line, idx) in group.lines"
                                  :key="idx"
                                  class="flex gap-2"
                                >
                                  <span
                                    class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-600"
                                    aria-hidden="true"
                                  />
                                  <span class="min-w-0">{{ line }}</span>
                                </li>
                              </ul>
                            </template>
                          </div>
                        </div>
                      </div>
                      <footer
                        v-if="plan.monthlyGhs > 0"
                        class="rounded-xl border border-zinc-200/80 bg-zinc-50 p-3.5 sm:p-4"
                      >
                        <p
                          class="text-[10px] font-bold uppercase tracking-wide text-zinc-600"
                        >
                          Billed annually
                        </p>
                        <p
                          class="mt-0.5 text-base font-semibold tabular-nums text-zinc-950"
                        >
                          {{ formatGhsWhole(plan.annualGhs) }}
                          <span class="text-xs font-medium text-zinc-500"
                            >/ yr</span
                          >
                        </p>
                        <p class="text-xs font-medium text-emerald-700">
                          Save {{ formatGhsWhole(plan.annualSaveGhs) }}
                        </p>
                      </footer>
                      <footer
                        v-else
                        class="rounded-xl border border-zinc-200/80 bg-zinc-100/70 p-3.5 sm:p-4"
                      >
                        <p
                          class="text-[10px] font-bold uppercase tracking-wide text-zinc-600"
                        >
                          Billing
                        </p>
                        <p class="mt-0.5 text-xs leading-relaxed text-zinc-700">
                          Always free — upgrade when you need more capacity.
                        </p>
                      </footer>
                      <button
                        type="button"
                        class="mt-auto w-full rounded-full py-3 text-center text-sm font-semibold transition active:scale-[0.99]"
                        :class="
                          plan.highlighted
                            ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                            : 'border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50'
                        "
                        @click="choosePlanAndDismiss(plan.id)"
                      >
                        Choose {{ plan.name }}
                      </button>
                    </div>
                  </article>
                </div>
              </div>
            </div>

            <p
              class="shrink-0 border-t border-zinc-200/80 bg-white px-4 py-4 text-center text-xs leading-relaxed text-zinc-500 sm:px-6 sm:py-4"
            >
              <RouterLink
                :to="upgradePricingLink"
                class="font-semibold text-indigo-700 underline-offset-2 hover:underline"
                @click="closePlanPicker"
              >
                Full pricing on the marketing site
              </RouterLink>
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dash-plan-picker-enter-active,
.dash-plan-picker-leave-active {
  transition: opacity 0.2s ease;
}
.dash-plan-picker-enter-active > div.relative,
.dash-plan-picker-leave-active > div.relative {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}
.dash-plan-picker-enter-from,
.dash-plan-picker-leave-to {
  opacity: 0;
}
.dash-plan-picker-enter-from > div.relative,
.dash-plan-picker-leave-to > div.relative {
  transform: scale(0.98);
  opacity: 0;
}

.plan-slide-track {
  transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .plan-slide-track {
    transition-duration: 0.01ms !important;
  }
}
</style>
