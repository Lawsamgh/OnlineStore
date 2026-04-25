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
import {
  useUiStore,
  type SellerPlatformAnnouncementRow,
} from "../../stores/ui";
import { useToastStore } from "../../stores/toast";
import { useRealtimeTableRefresh } from "../../composables/useRealtimeTableRefresh";
import { planLabelFromSignupId } from "../../lib/planLabel";
import { formatGhsWhole } from "../../constants/pricingPlans";
import { usePlanPricingSettings } from "../../composables/usePlanPricingSettings";
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
const { plans: pricingPlans } = usePlanPricingSettings();

type SellerStoreRow = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  whatsapp_phone_e164: string | null;
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
  is_owner: boolean;
};

type CustomerOrderRow = {
  id: string;
  store_id: string;
  status: string;
  created_at: string;
  guest_name: string | null;
  guest_phone: string | null;
  customer_id: string | null;
  /** Sum of line item quantities for this order. */
  total_quantity: number;
};

const stores = ref<SellerStoreRow[]>([]);
const customerOrders = ref<CustomerOrderRow[]>([]);
const loading = ref(true);
const smsSetupInput = ref("");
const smsSetupSaving = ref(false);
const sellerVerificationStatus = ref<
  "not_submitted" | "pending" | "approved" | "rejected"
>("not_submitted");
const sellerVerificationRejectReason = ref<string | null>(null);

const stats = computed(() => ({
  total: stores.value.length,
  active: stores.value.filter((s) => s.is_active).length,
}));
const canUseRoleGatedDashboardActions = computed(
  () => auth.platformStaffRoleResolved && auth.platformAdminRole !== "none",
);
// Show "access review in progress" in Platform Insight when the seller's
// platform role has been resolved as "none" but they own at least one store.
const showAccessUnderReview = computed(
  () =>
    auth.isSignedIn &&
    auth.platformStaffRoleResolved &&
    auth.platformAdminRole === "none" &&
    stores.value.some((s) => s.is_owner),
);
const showCreateStoreCta = computed(
  () =>
    canUseRoleGatedDashboardActions.value &&
    stores.value.some((s) => s.is_owner),
);

const accountPlanLabel = computed(() => {
  const raw = auth.user?.user_metadata?.signup_plan;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const id = raw.trim().toLowerCase();
  const p = pricingPlans.value.find((x) => x.id === id);
  return p?.name ?? raw.trim();
});

const AUTO_SMS_PLAN_IDS = new Set(["starter", "growth", "pro"]);

function normalizeSmsInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 && digits.startsWith("0"))
    return `233${digits.slice(1)}`;
  if (digits.startsWith("00") && digits.length > 4) return digits.slice(2);
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

function hasValidStoredSmsPhone(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim()) return false;
  return normalizeSmsInput(raw) !== null;
}

function storeEffectivePlanId(s: SellerStoreRow): string {
  return (
    s.sub_pricing_plan_id?.trim().toLowerCase() ||
    s.signup_plan?.trim().toLowerCase() ||
    (typeof auth.user?.user_metadata?.signup_plan === "string"
      ? auth.user.user_metadata.signup_plan.trim().toLowerCase()
      : "free")
  );
}

const storesNeedingSmsSetup = computed(() =>
  stores.value.filter((s) => {
    if (!s.is_owner) return false;
    const planId = storeEffectivePlanId(s);
    if (!AUTO_SMS_PLAN_IDS.has(planId)) return false;
    return !hasValidStoredSmsPhone(s.whatsapp_phone_e164);
  }),
);

const smsReminderStore = computed(() => storesNeedingSmsSetup.value[0] ?? null);

async function saveSmsSetupFromDashboard() {
  const target = smsReminderStore.value;
  if (!target) return;
  const normalized = normalizeSmsInput(smsSetupInput.value.trim());
  if (!normalized) {
    toast.error(
      "Enter a valid SMS phone number (e.g. 0591234567 or 233591234567).",
    );
    return;
  }
  smsSetupSaving.value = true;
  const { error } = await getSupabaseBrowser()
    .from("stores")
    .update({ whatsapp_phone_e164: normalized })
    .eq("id", target.id)
    .eq("owner_id", sessionUserId.value ?? "");
  smsSetupSaving.value = false;
  if (error) {
    toast.error(error.message);
    return;
  }
  toast.success("SMS phone number saved.");
  smsSetupInput.value = "";
  await loadSellerDashboard(true);
}

/** No `signup_plan` in metadata — Platform Insight shows "Not set" and zero quotas. */
const isSellerPlanUnset = computed(() => {
  const raw = auth.user?.user_metadata?.signup_plan;
  return typeof raw !== "string" || !raw.trim();
});

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
  if (sellerVerificationStatus.value !== "approved") {
    if (sellerVerificationStatus.value === "pending") {
      toast.info("Your account verification is pending super admin review.");
    } else if (sellerVerificationStatus.value === "rejected") {
      toast.error(
        sellerVerificationRejectReason.value
          ? `Verification was rejected: ${sellerVerificationRejectReason.value}`
          : "Verification was rejected. Please resubmit your verification documents.",
      );
    } else {
      toast.info("Complete seller verification before upgrading plan.");
    }
    return;
  }
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
    const storesSynced =
      data && typeof data === "object" && "stores_synced" in data
        ? Number((data as { stores_synced?: unknown }).stores_synced ?? 0)
        : 0;
    sessionStorage.setItem(lockKey, "1");
    const { data: refData, error: refErr } = await sb.auth.refreshSession();
    if (!refErr && refData.session) auth.syncSession(refData.session);
    else await auth.refreshSessionFromSupabase();
    if (storesSynced > 0) {
      toast.success(
        "Your seller account plan is active. Each shop you own is updated with the same plan for platform billing records.",
      );
    } else {
      toast.success(
        "Your seller account plan is active. No owned stores were found to sync yet; create a store or subscribe from a store page to write seller subscription records.",
      );
    }
    await router.replace({ name: "dashboard", query: {} });
  } finally {
    paystackPlanVerifyBusy.value = false;
  }
}

async function choosePlanAndDismiss(planId: string) {
  const plan = pricingPlans.value.find((p) => p.id === planId);
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
const planPickerPlans = computed(() =>
  pricingPlans.value.filter((p) => p.id !== "free"),
);

const planSlideCount = computed(() => planPickerPlans.value.length);

const activePlanSlide = computed(
  () =>
    planPickerPlans.value[planSlideIndex.value] ?? planPickerPlans.value[0]!,
);

/**
 * Track is `n × 100%` of the viewport; each slide is `100/n %` of the track.
 * `translateX` % is relative to the track, so `-index × (100/n) %` moves one slide.
 */
const planSlideTransformPct = computed(
  () => (100 / Math.max(planSlideCount.value, 1)) * planSlideIndex.value,
);

const planSlideTrackStyle = computed(() => ({
  width: `${planSlideCount.value * 100}%`,
  transform: `translate3d(-${planSlideTransformPct.value}%, 0, 0)`,
}));

const planSlideItemWidthPct = computed(
  () => 100 / Math.max(planSlideCount.value, 1),
);

function syncPlanSlideToContext() {
  const cur = currentPlanIdForPicker.value;
  if (cur) {
    const idx = planPickerPlans.value.findIndex((p) => p.id === cur);
    planSlideIndex.value = idx >= 0 ? idx : 0;
    return;
  }
  const hi = planPickerPlans.value.findIndex((p) => p.highlighted);
  planSlideIndex.value = hi >= 0 ? hi : 0;
}

function planSlideGo(i: number) {
  planSlideIndex.value = Math.max(0, Math.min(planSlideCount.value - 1, i));
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
  const p = pricingPlans.value.find((x) => x.id === id);
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

type StoreAdminMember = {
  user_id: string;
  role: "owner" | "admin";
  display_name: string | null;
  email: string | null;
  created_at: string | null;
};
const dashboardStoreAdmins = ref<StoreAdminMember[]>([]);
const dashboardStoreAdminInviteEmail = ref("");
const dashboardStoreAdminBusy = ref(false);
const dashboardStoreAdminRemovingUserId = ref<string | null>(null);

const dashboardAdminTargetStore = computed(
  () => previewStores.value[0] ?? null,
);
const dashboardMaxAdminUsers = computed(() => 1);
const dashboardAdminSeatText = computed(() => {
  const max = dashboardMaxAdminUsers.value;
  if (max == null) return `${dashboardStoreAdmins.value.length} / unlimited`;
  return `${dashboardStoreAdmins.value.length} / ${max}`;
});
const canManageDashboardStoreAdmins = computed(() => {
  return false;
});

async function loadDashboardStoreAdmins() {
  const s = dashboardAdminTargetStore.value;
  if (!s || !isSupabaseConfigured()) {
    dashboardStoreAdmins.value = [];
    return;
  }
  const { data, error } = await getSupabaseBrowser().rpc(
    "list_store_admin_members",
    { p_store_id: s.id },
  );
  if (error) {
    toast.error(error.message);
    return;
  }
  dashboardStoreAdmins.value = ((data ?? []) as Record<string, unknown>[])
    .map((row) => ({
      user_id: String(row.user_id ?? ""),
      role: (row.role === "owner"
        ? "owner"
        : "admin") as StoreAdminMember["role"],
      display_name:
        typeof row.display_name === "string" && row.display_name.trim()
          ? row.display_name.trim()
          : null,
      email:
        typeof row.email === "string" && row.email.trim()
          ? row.email.trim()
          : null,
      created_at:
        typeof row.created_at === "string" && row.created_at.trim()
          ? row.created_at.trim()
          : null,
    }))
    .filter((x) => x.user_id.length > 0);
}

async function addDashboardStoreAdminByEmail() {
  toast.info("Store teammates are disabled. Only the store owner is allowed.");
}

async function removeDashboardStoreAdmin(userId: string) {
  void userId;
  toast.info("Store teammates are disabled. Only the store owner is allowed.");
}

/** Totals across the signed-in seller's stores (filled in `loadSellerDashboard`). */
const planUsage = ref({ products: 0, ordersThisMonth: 0 });

const planFeatureUsageRows = computed(() => {
  const planId = resolvePricingPlanId(auth.user?.user_metadata?.signup_plan);
  const lim = PLAN_FEATURE_LIMITS[planId];
  const storeUsed = stats.value.total;
  const prodUsed = planUsage.value.products;
  const ordUsed = planUsage.value.ordersThisMonth;
  const adminUsed = dashboardStoreAdmins.value.length;

  const caps = isSellerPlanUnset.value
    ? {
        maxStores: 0 as number | null,
        maxAdminUsers: 0 as number | null,
        maxProducts: 0 as number | null,
        maxOrdersPerMonth: 0 as number | null,
      }
    : {
        maxStores: lim.maxStores,
        maxAdminUsers: lim.maxAdminUsers,
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
    row("A", "Admin users", adminUsed, caps.maxAdminUsers),
    row("P", "Products (all shops)", prodUsed, caps.maxProducts),
    row("O", "Orders", ordUsed, caps.maxOrdersPerMonth),
  ];
});

/** Wall-clock KPI samples (persisted ~48h per user in localStorage). */
const ordersKpiHistory = ref<KpiSample[]>([]);
const liveKpiHistory = ref<KpiSample[]>([]);
const productKpiHistory = ref<KpiSample[]>([]);

function kpiStorageKeys(uid: string | null) {
  if (!uid)
    return { orders: null as string | null, live: null, products: null };
  return {
    orders: `uanditech:dash-kpi:v1:orders:${uid}`,
    live: `uanditech:dash-kpi:v1:live:${uid}`,
    products: `uanditech:dash-kpi:v1:products:${uid}`,
  };
}

function hydrateKpiHistories() {
  const uid = sessionUserId.value;
  const k = kpiStorageKeys(uid);
  ordersKpiHistory.value = loadKpiHistory(k.orders);
  liveKpiHistory.value = loadKpiHistory(k.live);
  productKpiHistory.value = loadKpiHistory(k.products);
}

function persistKpiHistories() {
  const k = kpiStorageKeys(sessionUserId.value);
  saveKpiHistory(k.orders, ordersKpiHistory.value);
  saveKpiHistory(k.live, liveKpiHistory.value);
  saveKpiHistory(k.products, productKpiHistory.value);
}

watch(sessionUserId, (uid) => {
  if (!uid) {
    ordersKpiHistory.value = [];
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
      planUsage.value.ordersThisMonth,
    ] as const,
  ([ld, uid, _total, active, products, ordersThisMonth]) => {
    if (ld || !uid) return;
    ordersKpiHistory.value = recordKpiSample(
      ordersKpiHistory.value,
      ordersThisMonth,
    );
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

function orderBuyerLabel(row: CustomerOrderRow): string {
  const guest = row.guest_name?.trim();
  if (guest) return guest;
  if (row.customer_id?.trim()) return "Signed-in customer";
  return "Guest checkout";
}

function orderStoreLabel(storeId: string): string {
  const s = stores.value.find((x) => x.id === storeId);
  if (!s) return "Store";
  return s.name;
}

function formatOrderDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function orderStatusPillClass(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "paid":
      return "bg-emerald-200/90 text-emerald-900 ring-1 ring-emerald-300/60";
    case "pending":
      return "bg-amber-200/90 text-amber-900 ring-1 ring-amber-300/60";
    case "cancelled":
      return "bg-rose-200/90 text-rose-900 ring-1 ring-rose-300/60";
    case "shipped":
      return "bg-sky-200/90 text-sky-900 ring-1 ring-sky-300/60";
    case "delivered":
      return "bg-indigo-200/90 text-indigo-900 ring-1 ring-indigo-300/60";
    default:
      return "bg-zinc-200/90 text-zinc-800 ring-1 ring-zinc-300/60";
  }
}

async function loadSellerDashboard(silent = false) {
  if (!isSupabaseConfigured() || !sessionUserId.value) {
    ui.syncSellerPlatformAnnouncements("", []);
    if (!silent) loading.value = false;
    return;
  }
  if (!silent) loading.value = true;
  try {
    const supabase = getSupabaseBrowser();
    const uid = sessionUserId.value;
    const [storesRes, annRes, profileRes, verifRes] = await Promise.all([
      supabase
        .from("stores")
        .select(
          "id, slug, name, is_active, whatsapp_phone_e164, logo_path, owner_id, profiles!stores_owner_id_fkey(signup_plan)",
        )
        .eq("owner_id", uid)
        .order("created_at", { ascending: false }),
      supabase
        .from("announcements")
        .select("id, title, message, type, created_at")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("profiles")
        .select("seller_verification_status, seller_verification_reject_reason")
        .eq("id", uid)
        .maybeSingle(),
      // Also read seller_verifications directly — it's the source of truth
      // and its realtime events drive the dashboard refresh.
      supabase
        .from("seller_verifications")
        .select("status, reject_reason")
        .eq("seller_id", uid)
        .maybeSingle(),
    ]);
    if (storesRes.error) toast.error(storesRes.error.message);
    else {
      stores.value = ((storesRes.data ?? []) as Record<string, unknown>[]).map(
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
            whatsapp_phone_e164:
              typeof (raw as { whatsapp_phone_e164?: unknown })
                .whatsapp_phone_e164 === "string" &&
              String(
                (raw as { whatsapp_phone_e164?: unknown }).whatsapp_phone_e164,
              ).trim()
                ? String(
                    (raw as { whatsapp_phone_e164?: unknown })
                      .whatsapp_phone_e164,
                  ).trim()
                : null,
            logo_path: logoPath,
            signup_plan: prof?.signup_plan?.trim() || null,
            sub_pricing_plan_id: null,
            sub_payment_channel: null,
            sub_paid_amount_pesewas: null,
            sub_status: null,
            sub_current_period_end: null,
            sub_updated_at: null,
            is_owner:
              String((raw as { owner_id?: unknown }).owner_id ?? "") === uid,
          };
        },
      );
    }
    if (annRes.error) {
      toast.error(annRes.error.message);
      ui.syncSellerPlatformAnnouncements(uid, []);
    } else {
      const list = (annRes.data ?? []) as SellerPlatformAnnouncementRow[];
      ui.syncSellerPlatformAnnouncements(uid, list);
    }
    if (profileRes.error) {
      toast.error(profileRes.error.message);
    } else {
      // Prefer seller_verifications (realtime source of truth); fall back to profiles.
      const verifStatus =
        (verifRes.data?.status as
          | "pending"
          | "approved"
          | "rejected"
          | undefined) ??
        (profileRes.data?.seller_verification_status as
          | "not_submitted"
          | "pending"
          | "approved"
          | "rejected"
          | undefined);
      sellerVerificationStatus.value = verifStatus ?? "not_submitted";

      const verifRejectReason =
        typeof verifRes.data?.reject_reason === "string" &&
        verifRes.data.reject_reason.trim()
          ? verifRes.data.reject_reason.trim()
          : typeof profileRes.data?.seller_verification_reject_reason ===
                "string" &&
              profileRes.data.seller_verification_reject_reason.trim()
            ? profileRes.data.seller_verification_reject_reason.trim()
            : null;
      sellerVerificationRejectReason.value = verifRejectReason;
    }

    const storeIds = stores.value.map((s) => s.id);
    if (storeIds.length === 0) {
      planUsage.value = { products: 0, ordersThisMonth: 0 };
      dashboardPaidPlanRenewalEnd.value = null;
      customerOrders.value = [];
      dashboardStoreAdmins.value = [];
    } else {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const [prRes, orRes, subRes, recentOrdersRes] = await Promise.all([
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .in("store_id", storeIds),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .in("store_id", storeIds)
          .gte("created_at", monthStart.toISOString())
          .neq("status", "canceled"),
        supabase
          .from("seller_subscriptions")
          .select(
            "store_id, current_period_end, status, pricing_plan_id, payment_channel, paid_amount_pesewas, updated_at",
          )
          .in("store_id", storeIds),
        supabase
          .from("orders")
          .select(
            "id, store_id, status, created_at, guest_name, guest_phone, customer_id, order_items(quantity)",
          )
          .in("store_id", storeIds)
          .order("created_at", { ascending: false }),
      ]);
      if (prRes.error) toast.error(prRes.error.message);
      if (orRes.error) toast.error(orRes.error.message);
      if (recentOrdersRes.error) toast.error(recentOrdersRes.error.message);
      else {
        customerOrders.value = (recentOrdersRes.data ?? []).map((r) => {
          const rawItems = (r as { order_items?: unknown }).order_items;
          const itemRows = Array.isArray(rawItems)
            ? rawItems
            : rawItems && typeof rawItems === "object"
              ? [rawItems]
              : [];
          let totalQty = 0;
          for (const row of itemRows) {
            const q =
              row &&
              typeof row === "object" &&
              "quantity" in row &&
              typeof (row as { quantity: unknown }).quantity === "number"
                ? (row as { quantity: number }).quantity
                : 0;
            totalQty += Number.isFinite(q) ? q : 0;
          }
          return {
            id: String(r.id),
            store_id: String(r.store_id ?? ""),
            status:
              typeof r.status === "string" && r.status.trim()
                ? r.status.trim()
                : "pending",
            created_at:
              typeof r.created_at === "string" && r.created_at.trim()
                ? r.created_at.trim()
                : "",
            guest_name:
              typeof r.guest_name === "string" && r.guest_name.trim()
                ? r.guest_name.trim()
                : null,
            guest_phone:
              typeof r.guest_phone === "string" && r.guest_phone.trim()
                ? r.guest_phone.trim()
                : null,
            customer_id:
              typeof r.customer_id === "string" && r.customer_id.trim()
                ? r.customer_id.trim()
                : null,
            total_quantity: totalQty,
          };
        });
      }
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
      await loadDashboardStoreAdmins();
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
    ordersKpiHistory.value = recordKpiSample(
      ordersKpiHistory.value,
      planUsage.value.ordersThisMonth,
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
      // seller_verifications: watch for admin approve/reject so the banner
      // updates in real-time without the seller needing to refresh.
      // (We still omit `profiles` because last_seen_at heartbeat would
      // cause continuous full-dashboard refetches.)
      { table: "seller_verifications", filter: `seller_id=eq.${uid}` },
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
            <div class="flex items-start justify-between gap-3">
              <p
                class="text-xs font-semibold uppercase tracking-wider text-violet-900/75"
              >
                Total orders
              </p>
              <span
                class="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/90 text-violet-700 ring-1 ring-violet-200/80 shadow-sm"
                aria-hidden="true"
              >
                <svg
                  class="h-7 w-7"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M9 14.25H7.5a2.25 2.25 0 0 1-2.25-2.25V5.25A2.25 2.25 0 0 1 7.5 3h9A2.25 2.25 0 0 1 18.75 5.25V7.5m-9.75 6.75h7.5A2.25 2.25 0 0 1 18.75 16.5v2.25A2.25 2.25 0 0 1 16.5 21h-7.5A2.25 2.25 0 0 1 6.75 18.75V16.5A2.25 2.25 0 0 1 9 14.25ZM9 6h6m-6 3h3"
                  />
                </svg>
              </span>
            </div>
            <p
              class="mt-2 text-3xl font-bold tabular-nums tracking-tight text-zinc-900 sm:text-[2rem]"
            >
              +{{ planUsage.ordersThisMonth }}
            </p>
            <p
              class="mt-3 inline-flex w-fit rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-violet-800 shadow-sm ring-1 ring-violet-200/80"
            >
              This month
            </p>
            <p class="mt-2 text-xs font-medium text-violet-900/65">
              Orders placed across your storefronts
            </p>
            <div
              class="relative mt-auto h-36 w-full shrink-0 pt-6 sm:h-40 sm:pt-7 lg:h-44"
            >
              <DashboardKpiTimeChart
                :points="ordersKpiHistory"
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
            <div class="flex items-start justify-between gap-3">
              <p
                class="text-xs font-semibold uppercase tracking-wider text-sky-900/75"
              >
                Live shops
              </p>
              <span
                class="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/90 text-sky-700 ring-1 ring-sky-200/80 shadow-sm"
                aria-hidden="true"
              >
                <svg
                  class="h-7 w-7"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M3.75 21h16.5M5.25 21V9.75A2.25 2.25 0 0 1 7.5 7.5h2.25A2.25 2.25 0 0 1 12 9.75V21m0-6h6V8.25A2.25 2.25 0 0 0 15.75 6h-1.5M8.25 12h.008v.008H8.25V12zm0 3h.008v.008H8.25V15z"
                  />
                </svg>
              </span>
            </div>
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
            <div class="flex items-start justify-between gap-3">
              <p
                class="text-xs font-semibold uppercase tracking-wider text-pink-900/75"
              >
                All products
              </p>
              <span
                class="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/90 text-pink-700 ring-1 ring-pink-200/80 shadow-sm"
                aria-hidden="true"
              >
                <svg
                  class="h-7 w-7"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M21 7.5 12 3 3 7.5m18 0V16.5L12 21m9-13.5L12 12m0 9V12m0 0L3 7.5m5.25 3.375 3.75 2.25 3.75-2.25"
                  />
                </svg>
              </span>
            </div>
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
            v-if="smsReminderStore"
            class="rounded-[1.75rem] border border-amber-200/70 bg-gradient-to-br from-amber-50/95 to-white p-5 shadow-[0_18px_45px_-28px_rgba(245,158,11,0.28)]"
          >
            <div class="flex items-start gap-3">
              <span
                class="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 ring-1 ring-amber-200/80"
              >
                <svg
                  class="h-4.5 w-4.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M14.25 17.25a2.25 2.25 0 11-4.5 0m7.5-6v-2.25a5.25 5.25 0 10-10.5 0v2.25l-1.5 2.25h13.5l-1.5-2.25z"
                  />
                </svg>
              </span>
              <div class="min-w-0 flex-1">
                <p
                  class="text-xs font-semibold uppercase tracking-wider text-amber-800"
                >
                  SMS reminder
                </p>
                <p class="mt-1 text-sm font-semibold text-zinc-900">
                  Set SMS number to enable auto notifications
                </p>
                <p class="mt-1 text-xs text-zinc-700">
                  {{ smsReminderStore.name }} is on a plan with SMS order
                  notifications, but no SMS phone number is configured yet.
                </p>
                <div class="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    v-model="smsSetupInput"
                    type="tel"
                    placeholder="e.g. 0591234567 or 233591234567"
                    class="min-w-[15rem] flex-1 rounded-xl border border-amber-300/70 bg-white px-3 py-2 text-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                    :disabled="smsSetupSaving"
                  />
                  <button
                    type="button"
                    class="rounded-xl bg-amber-500 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-50"
                    :disabled="smsSetupSaving"
                    @click="saveSmsSetupFromDashboard"
                  >
                    {{ smsSetupSaving ? "Saving..." : "Save number" }}
                  </button>
                </div>
                <p class="mt-2 text-[11px] text-amber-900/80">
                  This number is used for seller SMS order notifications.
                </p>
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-6">
            <div
              id="seller-customer-orders"
              class="order-2 flex max-h-[min(36rem,65vh)] scroll-mt-24 flex-col overflow-hidden rounded-[1.75rem] border border-zinc-200/60 bg-white shadow-[0_28px_70px_-40px_rgba(15,23,42,0.18)]"
            >
              <div
                class="flex shrink-0 items-center justify-between border-b border-zinc-100 px-5 py-4 sm:px-6"
              >
                <h2 class="text-lg font-bold text-zinc-900">
                  Orders from Customers
                </h2>
                <span
                  class="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-full bg-orange-500 px-3 py-1.5 text-sm font-bold tabular-nums text-white shadow-md ring-2 ring-orange-300/70 ring-offset-2 ring-offset-white sm:min-h-10 sm:min-w-10 sm:px-3.5 sm:text-base"
                  aria-label="Number of orders shown"
                >
                  {{ customerOrders.length }}
                </span>
              </div>

              <template v-if="customerOrders.length">
                <div
                  class="min-h-0 flex-1 overflow-y-auto overflow-x-auto overscroll-y-contain"
                >
                  <table class="min-w-full text-left text-sm">
                    <thead
                      class="sticky top-0 z-[1] shadow-[0_1px_0_0_rgba(228,228,231,0.9)]"
                    >
                      <tr
                        class="border-b border-zinc-100 bg-zinc-50/95 text-xs font-semibold uppercase tracking-wider text-zinc-500 backdrop-blur-sm"
                      >
                        <th class="px-5 py-3.5 sm:px-6">Customer</th>
                        <th class="hidden px-3 py-3.5 sm:table-cell">Store</th>
                        <th class="px-3 py-3.5 text-right tabular-nums">Qty</th>
                        <th class="hidden px-3 py-3.5 sm:table-cell">Phone</th>
                        <th class="px-3 py-3.5">Status</th>
                        <th class="px-5 py-3.5 text-right sm:px-6">Ordered</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-zinc-100">
                      <tr
                        v-for="ord in customerOrders"
                        :key="ord.id"
                        class="bg-white/90 transition hover:bg-zinc-50/90"
                      >
                        <td
                          class="px-5 py-5 font-semibold text-zinc-900 sm:px-6"
                        >
                          <span class="block max-w-[16rem] truncate">
                            {{ orderBuyerLabel(ord) }}
                          </span>
                        </td>
                        <td
                          class="hidden px-3 py-5 text-zinc-700 sm:table-cell"
                        >
                          <span class="block max-w-[13rem] truncate">
                            {{ orderStoreLabel(ord.store_id) }}
                          </span>
                        </td>
                        <td
                          class="px-3 py-5 text-right text-sm font-semibold tabular-nums text-zinc-800"
                        >
                          {{ ord.total_quantity.toLocaleString() }}
                        </td>
                        <td
                          class="hidden max-w-[10rem] px-3 py-5 text-sm text-zinc-700 sm:table-cell"
                        >
                          <span
                            class="block truncate"
                            :title="ord.guest_phone ?? ''"
                          >
                            {{ ord.guest_phone ?? "—" }}
                          </span>
                        </td>
                        <td class="px-3 py-5">
                          <span
                            class="inline-flex rounded-lg px-3 py-1.5 text-xs font-semibold"
                            :class="orderStatusPillClass(ord.status)"
                          >
                            {{ ord.status.replace(/_/g, " ") }}
                          </span>
                        </td>
                        <td
                          class="px-5 py-5 text-right text-xs font-medium tabular-nums text-zinc-600 sm:px-6"
                        >
                          {{ formatOrderDate(ord.created_at) }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </template>

              <div v-else class="px-6 py-12 text-center">
                <p class="text-sm font-semibold text-zinc-900">
                  No customer orders yet
                </p>
                <p class="mt-2 text-sm text-zinc-600">
                  Orders will appear here when customers place checkout
                  requests.
                </p>
              </div>
            </div>

            <div
              class="order-1 h-[13.5rem] overflow-hidden rounded-[1.75rem] border border-zinc-200/60 bg-white shadow-[0_28px_70px_-40px_rgba(15,23,42,0.18)]"
            >
              <div
                class="flex items-center border-b border-zinc-100 px-5 py-4 sm:px-6"
              >
                <h2 class="text-lg font-bold text-zinc-900">Shop pipeline</h2>
              </div>

              <template v-if="filteredStores.length">
                <div class="h-[calc(100%-4.625rem)] overflow-auto">
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
                              v-if="canUseRoleGatedDashboardActions"
                              :to="`/${s.slug}`"
                              class="inline-flex rounded-full border border-zinc-200/90 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:border-sky-200 hover:text-sky-800"
                            >
                              View
                            </RouterLink>
                            <RouterLink
                              v-if="canUseRoleGatedDashboardActions"
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
            <!-- Verified badge -->
            <div
              v-if="sellerVerificationStatus === 'approved'"
              class="inline-flex items-center gap-1.5 rounded-2xl border border-emerald-200/80 bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-800 shadow-sm ring-1 ring-emerald-100"
            >
              <svg
                class="h-3.5 w-3.5 text-emerald-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.745 3.745 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.745 3.745 0 0 1 3.296-1.043A3.745 3.745 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.745 3.745 0 0 1 3.296 1.043 3.745 3.745 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z"
                />
              </svg>
              Verified
            </div>
            <button
              v-if="canUseRoleGatedDashboardActions"
              type="button"
              class="inline-flex items-center rounded-2xl border border-indigo-200/90 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-900 shadow-sm ring-1 ring-indigo-100 transition hover:border-indigo-300 hover:bg-indigo-50/60"
              @click="onUpgradePlanClick"
            >
              {{ isSellerPlanUnset ? "Choose plan" : "Upgrade plan" }}
            </button>
          </div>

          <!-- Verification status banners -->
          <div
            v-if="sellerVerificationStatus === 'pending'"
            class="mt-3 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-3"
          >
            <svg
              class="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
            <p class="text-xs font-medium leading-relaxed text-amber-900">
              Your identity verification is <strong>under review</strong>.
              You'll be notified once a super admin approves it. Plan upgrades
              unlock after approval.
            </p>
          </div>

          <div
            v-else-if="sellerVerificationStatus === 'rejected'"
            class="mt-3 rounded-xl border border-rose-200 bg-rose-50/80 px-3.5 py-3"
          >
            <div class="flex items-start gap-3">
              <svg
                class="mt-0.5 h-4 w-4 shrink-0 text-rose-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
              <div class="min-w-0 flex-1">
                <p class="text-xs font-bold text-rose-900">
                  Verification rejected
                </p>
                <p
                  v-if="sellerVerificationRejectReason"
                  class="mt-0.5 text-xs text-rose-800"
                >
                  Reason: {{ sellerVerificationRejectReason }}
                </p>
                <p v-else class="mt-0.5 text-xs text-rose-700">
                  Please correct your documents and resubmit.
                </p>
              </div>
            </div>
            <button
              type="button"
              class="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-rose-700"
              @click="ui.openCreateStoreModal()"
            >
              <svg
                class="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
              Resubmit Verification
            </button>
          </div>

          <div
            v-else-if="sellerVerificationStatus === 'not_submitted'"
            class="mt-3 flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3"
          >
            <svg
              class="mt-0.5 h-4 w-4 shrink-0 text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
              />
            </svg>
            <p class="text-xs font-medium text-zinc-700">
              Complete mandatory identity verification to unlock plan upgrades.
            </p>
          </div>

          <!-- Access review in progress (role not yet assigned) -->
          <div
            v-if="showAccessUnderReview"
            class="mt-3 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/80 px-3.5 py-3"
          >
            <svg
              class="mt-0.5 h-4 w-4 shrink-0 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
            <div class="min-w-0 flex-1">
              <p class="text-xs font-bold text-red-900">
                Access review in progress
              </p>
              <p class="mt-0.5 text-xs leading-relaxed text-red-700">
                We will grant you admin access after reviewing your application.
                Kindly hold on — it should take less than 3 hours.
              </p>
            </div>
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
                  : 'flex h-[16vh] flex-col overflow-hidden rounded-[1.75rem] border border-zinc-200/50 bg-[#f3f3f7] p-5 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.1)] sm:rounded-3xl sm:p-6'
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
                        <div
                          v-if="canUseRoleGatedDashboardActions"
                          class="flex shrink-0 gap-1"
                        >
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

            <div
              v-if="auth.isPlatformStaff"
              class="flex flex-col overflow-hidden rounded-[1.75rem] border border-zinc-200/50 bg-[#f3f3f7] p-5 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.1)] sm:rounded-3xl sm:p-6"
            >
              <div class="shrink-0">
                <h3 class="text-base font-bold tracking-tight text-zinc-900">
                  Store admins
                </h3>
                <p class="mt-1 text-xs text-zinc-500">
                  Manage admin users for
                  {{
                    dashboardAdminTargetStore
                      ? dashboardAdminTargetStore.name
                      : "your store"
                  }}.
                </p>
              </div>
              <div class="mt-3 flex items-center justify-between gap-2">
                <p
                  class="text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
                >
                  Seats
                </p>
                <span class="text-xs font-bold tabular-nums text-zinc-700">{{
                  dashboardAdminSeatText
                }}</span>
              </div>

              <div
                class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
                v-if="canManageDashboardStoreAdmins"
              >
                <input
                  v-model="dashboardStoreAdminInviteEmail"
                  type="email"
                  autocomplete="email"
                  placeholder="teammate@email.com"
                  class="w-full rounded-xl border border-zinc-300/80 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
                />
                <button
                  type="button"
                  class="inline-flex shrink-0 items-center justify-center rounded-xl bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-45"
                  :disabled="
                    dashboardStoreAdminBusy || !dashboardAdminTargetStore
                  "
                  @click="addDashboardStoreAdminByEmail"
                >
                  Add admin
                </button>
              </div>

              <ul
                v-if="dashboardStoreAdmins.length"
                class="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200/70 bg-white/95"
              >
                <li
                  v-for="member in dashboardStoreAdmins"
                  :key="`${member.user_id}-${member.role}`"
                  class="flex items-center justify-between gap-2 px-3 py-2.5"
                >
                  <div class="min-w-0">
                    <p class="truncate text-sm font-semibold text-zinc-900">
                      {{
                        member.display_name || member.email || member.user_id
                      }}
                    </p>
                    <p class="truncate text-[11px] text-zinc-500">
                      {{ member.email || "No email available" }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <span
                      class="inline-flex rounded-full border border-zinc-200/90 bg-zinc-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600"
                    >
                      {{ member.role }}
                    </span>
                    <button
                      v-if="member.role === 'admin'"
                      type="button"
                      class="inline-flex items-center justify-center rounded-lg border border-rose-200/90 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:pointer-events-none disabled:opacity-45"
                      :disabled="
                        dashboardStoreAdminRemovingUserId === member.user_id
                      "
                      @click="removeDashboardStoreAdmin(member.user_id)"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              </ul>
              <p v-else class="mt-4 text-xs text-zinc-500">
                No extra admins yet.
              </p>

              <p class="mt-4 text-xs text-zinc-500">
                Store teammate access is disabled. Only the store owner can
                manage this store.
              </p>
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
            class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-zinc-50/80"
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
                    v-for="(p, i) in planPickerPlans"
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

            <div
              class="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-3 sm:px-6 sm:pb-24 sm:pt-4"
            >
              <div
                class="plan-slide-viewport relative isolate w-full overflow-x-hidden overflow-y-auto rounded-2xl border border-zinc-200/90 bg-white shadow-sm"
                @pointerdown="onPlanSlidePointerDown"
                @pointerup="onPlanSlidePointerUp"
                @pointercancel="onPlanSlidePointerCancel"
              >
                <div
                  class="plan-slide-track flex min-h-[min(26rem,50dvh)] sm:min-h-[min(30rem,54dvh)]"
                  :style="planSlideTrackStyle"
                >
                  <article
                    v-for="(plan, slideIdx) in planPickerPlans"
                    :key="plan.id"
                    class="box-border flex min-h-[min(26rem,50dvh)] shrink-0 flex-col overflow-visible sm:min-h-[min(30rem,54dvh)]"
                    :data-plan-slide="slideIdx"
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
                    <div class="flex min-h-0 flex-1 flex-col overflow-hidden p-5 sm:p-6">
                      <div
                        class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain pb-4"
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
                          class="max-h-[22rem] touch-pan-y divide-y divide-zinc-100 overflow-y-auto overscroll-y-contain rounded-xl border border-zinc-100 bg-zinc-50/80 sm:max-h-[26rem]"
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
                        v-if="plan.monthlyGhs === 0"
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
                      </div>
                    </div>
                  </article>
                </div>
              </div>
            </div>

            <div
              class="absolute inset-x-0 bottom-0 z-20 shrink-0 border-t border-zinc-200/80 bg-white px-4 py-3 sm:px-6"
            >
              <button
                type="button"
                class="w-full rounded-full py-3 text-center text-sm font-semibold transition active:scale-[0.99]"
                :class="
                  activePlanSlide.highlighted
                    ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                    : 'border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50'
                "
                @click="choosePlanAndDismiss(activePlanSlide.id)"
              >
                Choose {{ activePlanSlide.name }}
              </button>
            </div>

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
