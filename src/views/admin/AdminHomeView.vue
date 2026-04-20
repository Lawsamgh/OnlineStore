<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { storeToRefs } from "pinia";
import { useRoute } from "vue-router";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { platformConsolePresenceOnlineKey } from "../../lib/consolePresenceInjection";
import { formatGhs } from "../../lib/formatMoney";
import { planLabelFromSignupId } from "../../lib/planLabel";
import { useRealtimeTableRefresh } from "../../composables/useRealtimeTableRefresh";
import { useToastStore } from "../../stores/toast";
import { useAuthStore } from "../../stores/auth";
import { useUiStore } from "../../stores/ui";
import SkeletonAdminStats from "../../components/skeleton/SkeletonAdminStats.vue";
import {
  loadKpiHistory,
  recordKpiSample,
  saveKpiHistory,
  type KpiSample,
} from "../../lib/dashboardKpiHistory";
import AdminSubscriptionCashflowChart from "../../components/admin/AdminSubscriptionCashflowChart.vue";

const DashboardKpiTimeChart = defineAsyncComponent(
  () => import("../../components/dashboard/DashboardKpiTimeChart.vue"),
);

const toast = useToastStore();
const authStore = useAuthStore();
const { sessionUserId } = storeToRefs(authStore);
const ui = useUiStore();
const route = useRoute();

const loading = ref(true);
let adminKpiSampleTimer: number | null = null;
const stats = ref({
  stores: 0,
  /** All product rows across every storefront. */
  products: 0,
  ticketsOpen: 0,
  /** Rows in `admin_roles` (super_admin + admin). */
  adminUsers: 0,
});

/** Sum of `(paid_amount_pesewas − paystack_fee_pesewas)` across stores with a payment snapshot. */
const subscriptionNetTotalPesewas = ref(0);
/** Raw rows for monthly paid vs fee aggregation (cashflow chart). */
type SubscriptionSnapRow = {
  paid_amount_pesewas: number | null;
  paystack_fee_pesewas: number | null;
  updated_at: string;
};
const subscriptionSnapRows = ref<SubscriptionSnapRow[]>([]);

/** `year` = Jan–Dec calendar year; `6m` = trailing six months. */
const subscriptionCashflowPeriod = ref<"year" | "6m">("year");

function applySellerSubscriptionBilling(
  rows: unknown[] | null,
  error: { message: string } | null,
  silent: boolean,
) {
  if (error) {
    if (!silent) toast.error(error.message);
    subscriptionNetTotalPesewas.value = 0;
    subscriptionSnapRows.value = [];
    return;
  }
  type Snap = {
    paid_amount_pesewas?: number | null;
    paystack_fee_pesewas?: number | null;
    updated_at?: string;
  };
  const list = (rows ?? []) as Snap[];
  subscriptionSnapRows.value = list
    .filter(
      (r) =>
        typeof r.updated_at === "string" &&
        !Number.isNaN(new Date(r.updated_at).getTime()),
    )
    .map((r) => ({
      paid_amount_pesewas:
        typeof r.paid_amount_pesewas === "number" &&
        Number.isFinite(r.paid_amount_pesewas)
          ? r.paid_amount_pesewas
          : null,
      paystack_fee_pesewas:
        typeof r.paystack_fee_pesewas === "number" &&
        Number.isFinite(r.paystack_fee_pesewas)
          ? r.paystack_fee_pesewas
          : null,
      updated_at: r.updated_at as string,
    }));

  const withPayment = subscriptionSnapRows.value.filter(
    (r) =>
      typeof r.paid_amount_pesewas === "number" &&
      r.paid_amount_pesewas > 0,
  );
  let totalPesewas = 0;
  for (const r of withPayment) {
    const paid = r.paid_amount_pesewas!;
    const fee =
      typeof r.paystack_fee_pesewas === "number" &&
      Number.isFinite(r.paystack_fee_pesewas)
        ? r.paystack_fee_pesewas!
        : 0;
    totalPesewas += paid - fee;
  }
  subscriptionNetTotalPesewas.value = Math.max(0, totalPesewas);
}

type SubscriptionCashflowMonth = {
  key: string;
  label: string;
  incomeGhs: number;
  feeGhs: number;
};

const subscriptionCashflowMonths = computed((): SubscriptionCashflowMonth[] => {
  const rows = subscriptionSnapRows.value;
  const period = subscriptionCashflowPeriod.value;
  const monthLabel = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short" });

  if (period === "year") {
    const y = new Date().getFullYear();
    const labels = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const acc = Array.from({ length: 12 }, (_, i) => ({
      incomeGhs: 0,
      feeGhs: 0,
    }));
    for (const r of rows) {
      const d = new Date(r.updated_at);
      if (Number.isNaN(d.getTime()) || d.getFullYear() !== y) continue;
      if (typeof r.paid_amount_pesewas !== "number" || r.paid_amount_pesewas <= 0)
        continue;
      const mi = d.getMonth();
      acc[mi]!.incomeGhs += r.paid_amount_pesewas / 100;
      const fee =
        typeof r.paystack_fee_pesewas === "number" &&
        Number.isFinite(r.paystack_fee_pesewas)
          ? r.paystack_fee_pesewas
          : 0;
      acc[mi]!.feeGhs += fee / 100;
    }
    return labels.map((label, i) => ({
      key: `${y}-${i}`,
      label,
      incomeGhs: acc[i]!.incomeGhs,
      feeGhs: acc[i]!.feeGhs,
    }));
  }

  const out: SubscriptionCashflowMonth[] = [];
  const now = new Date();
  for (let k = 5; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const y = d.getFullYear();
    const mi = d.getMonth();
    let incomeGhs = 0;
    let feeGhs = 0;
    for (const r of rows) {
      const dr = new Date(r.updated_at);
      if (
        Number.isNaN(dr.getTime()) ||
        dr.getFullYear() !== y ||
        dr.getMonth() !== mi
      )
        continue;
      if (typeof r.paid_amount_pesewas !== "number" || r.paid_amount_pesewas <= 0)
        continue;
      incomeGhs += r.paid_amount_pesewas / 100;
      const fee =
        typeof r.paystack_fee_pesewas === "number" &&
        Number.isFinite(r.paystack_fee_pesewas)
          ? r.paystack_fee_pesewas
          : 0;
      feeGhs += fee / 100;
    }
    out.push({
      key: `${y}-${mi}`,
      label: monthLabel(d),
      incomeGhs,
      feeGhs,
    });
  }
  return out;
});

type OwnerStore = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  /** Storage path in `store-logos`; optional fallback object key is `{id}/logo`. */
  logo_path: string | null;
};

type StoreFlatRow = OwnerStore & {
  owner_id: string;
  ownerName: string | null;
  ownerAvatarPath: string | null;
  /** `profiles.signup_plan`, mirrored from auth metadata. */
  ownerSignupPlan: string | null;
};

const storesFlat = ref<StoreFlatRow[]>([]);
/** `store_id` → product row count (filled after stores load). */
const productCountByStoreId = ref(new Map<string, number>());

type AdminStaffRow = {
  userId: string;
  role: string;
  displayName: string;
  avatarUrl: string | null;
  initial: string;
  /** `profiles.signup_plan` (seller tier); hidden in UI for super_admin. */
  signupPlan: string | null;
  /** `profiles.last_seen_at` — client heartbeat while staff use dashboard shell. */
  lastSeenAt: string | null;
};

const adminStaffRows = ref<AdminStaffRow[]>([]);

const platformConsolePresenceOnlineRef = inject(
  platformConsolePresenceOnlineKey,
  null,
);

/** User ids with an active `/admin` session (Supabase Realtime presence from layout). */
const platformConsolePresenceOnlineSet = computed(
  () => platformConsolePresenceOnlineRef?.value ?? new Set<string>(),
);

/** Realtime presence and/or DB heartbeat (see `useProfileLastSeenHeartbeat`). */
const LIVE_LAST_SEEN_MS = 120_000;

function isConsoleUserLive(
  userId: string,
  lastSeenAt: string | null | undefined,
): boolean {
  const raw = lastSeenAt != null ? String(lastSeenAt).trim() : "";
  if (raw !== "") {
    const t = new Date(raw).getTime();
    if (Number.isNaN(t)) {
      return platformConsolePresenceOnlineSet.value.has(userId);
    }
    if (Date.now() - t >= LIVE_LAST_SEEN_MS) {
      return false;
    }
    return true;
  }
  return platformConsolePresenceOnlineSet.value.has(userId);
}

const consoleStaffOnlineCount = computed(
  () =>
    adminStaffRows.value.filter((u) =>
      isConsoleUserLive(u.userId, u.lastSeenAt),
    ).length,
);

/** Recent profiles not yet in `admin_roles` (super admin grant picker). */
type PendingConsoleUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  initial: string;
  createdLabel: string;
};

const pendingConsoleUsers = ref<PendingConsoleUser[]>([]);

/** Tracks pending-console list length to toast when new rows appear (realtime refresh). */
const prevPendingConsoleLen = ref(-1);

watch(
  () => pendingConsoleUsers.value.length,
  (len) => {
    if (authStore.isSuperAdmin) {
      ui.setAdminPendingConsoleGrantCount(len);
      const prev = prevPendingConsoleLen.value;
      prevPendingConsoleLen.value = len;
      if (prev >= 0 && len > prev) {
        const d = len - prev;
        toast.info(
          `${d} new account${d === 1 ? "" : "s"} may need console access — check Grant access.`,
        );
      }
    } else {
      ui.setAdminPendingConsoleGrantCount(0);
      prevPendingConsoleLen.value = -1;
    }
  },
  { immediate: true },
);

function scrollGrantAccessIntoView() {
  if (route.hash !== "#grant-access") return;
  void nextTick(() => {
    document.getElementById("grant-access")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
}

watch(
  () => [route.hash, loading.value] as const,
  ([h, ld]) => {
    if (h !== "#grant-access" || ld) return;
    scrollGrantAccessIntoView();
  },
);

type OwnerPipelineRow = {
  ownerId: string;
  ownerName: string;
  ownerAvatarUrl: string | null;
  ownerInitial: string;
  /** Display label for seller subscription tier. */
  subscriptionPlanLabel: string;
  storeCount: number;
  stores: OwnerStore[];
  /** Sum of `products` rows across this owner’s storefronts. */
  productTotal: number;
};

function profileAvatarPublicUrl(
  path: string | null | undefined,
): string | null {
  const p = path?.trim();
  if (!p || !isSupabaseConfigured()) return null;
  return getSupabaseBrowser().storage.from("profile-avatars").getPublicUrl(p)
    .data.publicUrl;
}

function ownerInitialFromName(name: string): string {
  const t = name.trim();
  if (!t || t === "Unknown seller") return "?";
  return t[0]!.toUpperCase();
}

function formatProfileCreatedLabel(iso: string | null | undefined): string {
  if (!iso || typeof iso !== "string") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function storeInitialFromName(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  return t[0]!.toUpperCase();
}

/** Public URL for a store logo (`store-logos`). Matches storefront `{storeId}/logo` when `logo_path` is empty. */
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

const ownerPipelineRows = computed((): OwnerPipelineRow[] => {
  const counts = productCountByStoreId.value;
  const byOwner = new Map<string, Omit<OwnerPipelineRow, "productTotal">>();
  for (const s of storesFlat.value) {
    const label = s.ownerName?.trim() || "Unknown seller";
    let row = byOwner.get(s.owner_id);
    if (!row) {
      row = {
        ownerId: s.owner_id,
        ownerName: label,
        ownerAvatarUrl: profileAvatarPublicUrl(s.ownerAvatarPath),
        ownerInitial: ownerInitialFromName(label),
        subscriptionPlanLabel: planLabelFromSignupId(s.ownerSignupPlan),
        storeCount: 0,
        stores: [],
      };
      byOwner.set(s.owner_id, row);
    }
    row.storeCount += 1;
    row.stores.push({
      id: s.id,
      slug: s.slug,
      name: s.name,
      is_active: s.is_active,
      logo_path: s.logo_path?.trim() || null,
    });
  }
  return [...byOwner.values()]
    .map((row) => ({
      ...row,
      productTotal: row.stores.reduce(
        (sum, st) => sum + (counts.get(st.id) ?? 0),
        0,
      ),
    }))
    .sort((a, b) =>
      a.ownerName.localeCompare(b.ownerName, undefined, {
        sensitivity: "base",
      }),
    );
});

/** Stores column: show storefront name when the owner has exactly one shop. */
function pipelineStoresCell(row: OwnerPipelineRow): string {
  if (row.storeCount === 1 && row.stores[0]) {
    return row.stores[0].name.trim() || row.stores[0].slug || "—";
  }
  return String(row.storeCount);
}

const modalOpen = ref(false);
const modalOwnerName = ref("");
const modalOwnerPlanLabel = ref("");
const modalOwnerAvatarUrl = ref<string | null>(null);
const modalOwnerInitial = ref("?");
const modalStores = ref<OwnerStore[]>([]);

const revokeConfirmUser = ref<AdminStaffRow | null>(null);
const revokeBusy = ref(false);

type ModalProductRow = {
  id: string;
  title: string;
  is_published: boolean;
  price_cents: number;
  currency: string;
};

const modalProductsByStoreId = ref<Record<string, ModalProductRow[]>>({});
const modalProductsLoading = ref(false);
/** When true/undefined for a store id, that branch is expanded. */
const modalStoreExpanded = ref<Record<string, boolean>>({});

function isModalStoreExpanded(storeId: string): boolean {
  return modalStoreExpanded.value[storeId] !== false;
}

function toggleModalStoreExpand(storeId: string) {
  const cur = modalStoreExpanded.value[storeId];
  modalStoreExpanded.value = {
    ...modalStoreExpanded.value,
    [storeId]: cur === false,
  };
}

function modalProductsForStore(storeId: string): ModalProductRow[] {
  return modalProductsByStoreId.value[storeId] ?? [];
}

const modalCatalogProductTotal = computed(() =>
  Object.values(modalProductsByStoreId.value).reduce((n, arr) => n + arr.length, 0),
);

async function loadModalStoreProducts() {
  modalProductsLoading.value = true;
  modalProductsByStoreId.value = {};
  modalStoreExpanded.value = {};
  const ids = modalStores.value.map((s) => s.id);
  if (!isSupabaseConfigured() || ids.length === 0) {
    modalProductsLoading.value = false;
    return;
  }
  try {
    const sb = getSupabaseBrowser();
    const byStore: Record<string, ModalProductRow[]> = {};
    for (const id of ids) byStore[id] = [];
    const pageSize = 500;
    let offset = 0;
    for (;;) {
      const { data, error } = await sb
        .from("products")
        .select("id, store_id, title, is_published, price_cents, currency")
        .in("store_id", ids)
        .order("title", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) {
        toast.error(error.message);
        break;
      }
      const rows = data ?? [];
      for (const r of rows as Record<string, unknown>[]) {
        const sid = String(r.store_id);
        if (!byStore[sid]) byStore[sid] = [];
        const titleRaw = r.title;
        const title =
          typeof titleRaw === "string" && titleRaw.trim()
            ? titleRaw.trim()
            : "Untitled";
        byStore[sid].push({
          id: String(r.id),
          title,
          is_published: Boolean(r.is_published),
          price_cents: Number(r.price_cents) || 0,
          currency:
            typeof r.currency === "string" && r.currency.trim()
              ? r.currency.trim()
              : "GHS",
        });
      }
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
    modalProductsByStoreId.value = byStore;
    const nextExp: Record<string, boolean> = {};
    for (const id of ids) nextExp[id] = true;
    modalStoreExpanded.value = nextExp;
  } finally {
    modalProductsLoading.value = false;
  }
}

function openOwnerStoresModal(row: OwnerPipelineRow) {
  modalOwnerName.value = row.ownerName;
  modalOwnerPlanLabel.value = row.subscriptionPlanLabel;
  modalOwnerAvatarUrl.value = row.ownerAvatarUrl;
  modalOwnerInitial.value = row.ownerInitial;
  modalStores.value = row.stores
    .slice()
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  modalOpen.value = true;
  void loadModalStoreProducts();
}

function closeOwnerStoresModal() {
  modalOpen.value = false;
  modalProductsByStoreId.value = {};
  modalStoreExpanded.value = {};
  modalProductsLoading.value = false;
}

function onOwnerModalKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    if (revokeConfirmUser.value && !revokeBusy.value) {
      e.preventDefault();
      closeRevokeConfirm();
      return;
    }
    if (modalOpen.value) {
      e.preventDefault();
      closeOwnerStoresModal();
    }
  }
}

watch([modalOpen, revokeConfirmUser], ([storesOpen, revokeOpen]) => {
  document.body.style.overflow =
    storesOpen || revokeOpen != null ? "hidden" : "";
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onOwnerModalKeydown);
  document.body.style.overflow = "";
  if (adminKpiSampleTimer != null) {
    clearInterval(adminKpiSampleTimer);
    adminKpiSampleTimer = null;
  }
});

/** Row chip colors (aligned with seller dashboard shop pipeline). */
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

/** Sum of the four headline counts (composition denominator for the row). */
const rowTotal = computed(
  () =>
    stats.value.stores +
    stats.value.products +
    stats.value.ticketsOpen +
    stats.value.adminUsers,
);

/**
 * This metric’s share of `rowTotal`. The four cards’ percentages sum to ~100%
 * (rounding). At 100%, this metric is the only non-zero contributor on the row.
 */
function shareOfCombinedPct(value: number): number {
  const t = rowTotal.value;
  if (t <= 0 || value <= 0) return 0;
  return Math.min(100, Math.round((value / t) * 100));
}

type AdminStatCardKey = "stores" | "products" | "ticketsOpen" | "adminUsers";

const adminStoresHistory = ref<KpiSample[]>([]);
const adminProductsHistory = ref<KpiSample[]>([]);
const adminTicketsHistory = ref<KpiSample[]>([]);
const adminUsersHistory = ref<KpiSample[]>([]);

function adminKpiStorageKeys(uid: string | null) {
  if (!uid) {
    return {
      stores: null as string | null,
      products: null,
      ticketsOpen: null,
      adminUsers: null,
    };
  }
  return {
    stores: `uanditech:admin-kpi:v1:stores:${uid}`,
    products: `uanditech:admin-kpi:v1:products:${uid}`,
    ticketsOpen: `uanditech:admin-kpi:v1:tickets:${uid}`,
    adminUsers: `uanditech:admin-kpi:v1:admins:${uid}`,
  };
}

function hydrateAdminKpiHistories() {
  const k = adminKpiStorageKeys(sessionUserId.value);
  adminStoresHistory.value = loadKpiHistory(k.stores);
  adminProductsHistory.value = loadKpiHistory(k.products);
  adminTicketsHistory.value = loadKpiHistory(k.ticketsOpen);
  adminUsersHistory.value = loadKpiHistory(k.adminUsers);
}

function persistAdminKpiHistories() {
  const k = adminKpiStorageKeys(sessionUserId.value);
  saveKpiHistory(k.stores, adminStoresHistory.value);
  saveKpiHistory(k.products, adminProductsHistory.value);
  saveKpiHistory(k.ticketsOpen, adminTicketsHistory.value);
  saveKpiHistory(k.adminUsers, adminUsersHistory.value);
}

function kpiPointsFor(key: AdminStatCardKey): KpiSample[] {
  switch (key) {
    case "stores":
      return adminStoresHistory.value;
    case "products":
      return adminProductsHistory.value;
    case "ticketsOpen":
      return adminTicketsHistory.value;
    case "adminUsers":
      return adminUsersHistory.value;
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

watch(sessionUserId, (uid) => {
  if (!uid) {
    adminStoresHistory.value = [];
    adminProductsHistory.value = [];
    adminTicketsHistory.value = [];
    adminUsersHistory.value = [];
    return;
  }
  hydrateAdminKpiHistories();
});

watch(
  () =>
    [
      loading.value,
      sessionUserId.value,
      stats.value.stores,
      stats.value.products,
      stats.value.ticketsOpen,
      stats.value.adminUsers,
    ] as const,
  ([ld, uid, st, prod, tix, adm]) => {
    if (ld || !uid) return;
    adminStoresHistory.value = recordKpiSample(adminStoresHistory.value, st);
    adminProductsHistory.value = recordKpiSample(
      adminProductsHistory.value,
      prod,
    );
    adminTicketsHistory.value = recordKpiSample(
      adminTicketsHistory.value,
      tix,
    );
    adminUsersHistory.value = recordKpiSample(adminUsersHistory.value, adm);
    persistAdminKpiHistories();
  },
);

const statCards = computed(() => {
  const s = stats.value;
  const ticketPill =
    s.ticketsOpen > 0
      ? {
          text: `${s.ticketsOpen} awaiting reply`,
          cls: "border-rose-200/70 bg-white/85 text-rose-700 shadow-sm ring-1 ring-rose-200/70",
        }
      : {
          text: "Queue clear",
          cls: "border-emerald-200/70 bg-white/85 text-emerald-700 shadow-sm ring-1 ring-emerald-200/70",
        };
  return [
    {
      key: "stores" as const,
      label: "Stores",
      subtitle: "Marketplace storefronts",
      value: s.stores,
      pill: "Platform-wide",
      pillClass:
        "border-emerald-200/70 bg-white/85 text-emerald-700 shadow-sm ring-1 ring-emerald-200/70",
      border: "border-violet-200/50",
      bg: "bg-[#ece8ff]",
      shadow: "shadow-[0_20px_50px_-32px_rgba(91,33,182,0.2)]",
      labelClass: "text-violet-900/75",
      subtitleClass: "text-violet-900/65",
      chart: {
        stroke: "#5b21b6",
        fill: "rgba(91,33,182,0.2)",
        axisStroke: "rgba(91,33,182,0.45)",
        gridStroke: "rgba(91,33,182,0.12)",
      },
    },
    {
      key: "products" as const,
      label: "Total products",
      subtitle: "SKUs across every storefront",
      value: s.products,
      pill: "Catalog-wide",
      pillClass:
        "border-sky-200/70 bg-white/85 text-sky-800 shadow-sm ring-1 ring-sky-200/70",
      border: "border-sky-200/50",
      bg: "bg-[#e0f2fe]",
      shadow: "shadow-[0_20px_50px_-32px_rgba(3,105,161,0.18)]",
      labelClass: "text-sky-900/75",
      subtitleClass: "text-sky-900/65",
      chart: {
        stroke: "#0369a1",
        fill: "rgba(3,105,161,0.18)",
        axisStroke: "rgba(3,105,161,0.45)",
        gridStroke: "rgba(3,105,161,0.12)",
      },
    },
    {
      key: "ticketsOpen" as const,
      label: "Open tickets",
      subtitle: "Support queue awaiting reply",
      value: s.ticketsOpen,
      pill: ticketPill.text,
      pillClass: ticketPill.cls,
      border: "border-amber-200/55",
      bg: "bg-[#fff7ed]",
      shadow: "shadow-[0_20px_50px_-32px_rgba(180,83,9,0.14)]",
      labelClass: "text-amber-950/75",
      subtitleClass: "text-amber-950/65",
      chart: {
        stroke: "#b45309",
        fill: "rgba(180,83,9,0.18)",
        axisStroke: "rgba(120,53,15,0.5)",
        gridStroke: "rgba(180,83,9,0.14)",
      },
    },
    {
      key: "adminUsers" as const,
      label: "Users",
      subtitle: "Platform console accounts",
      value: s.adminUsers,
      pill: "Admin roles",
      pillClass:
        "border-emerald-200/70 bg-white/85 text-emerald-800 shadow-sm ring-1 ring-emerald-200/70",
      border: "border-emerald-200/50",
      bg: "bg-[#ecfdf5]",
      shadow: "shadow-[0_20px_50px_-32px_rgba(5,150,105,0.16)]",
      labelClass: "text-emerald-900/75",
      subtitleClass: "text-emerald-900/65",
      chart: {
        stroke: "#047857",
        fill: "rgba(4,120,87,0.18)",
        axisStroke: "rgba(4,120,87,0.45)",
        gridStroke: "rgba(4,120,87,0.12)",
      },
    },
  ];
});

async function loadPlatformData(silent = false) {
  if (!isSupabaseConfigured()) {
    if (!silent) loading.value = false;
    return;
  }
  if (!silent) loading.value = true;
  try {
    const sb = getSupabaseBrowser();
    const [
      s,
      pr,
      t,
      adminRes,
      adminRolesListRes,
      storesRes,
      profilesRecentRes,
      subSnapRes,
    ] = await Promise.all([
      sb.from("stores").select("id", { count: "exact", head: true }),
      sb.from("products").select("id", { count: "exact", head: true }),
      sb
        .from("support_tickets")
        .select("id", { count: "exact", head: true })
        .eq("status", "open"),
      sb.from("admin_roles").select("id", { count: "exact", head: true }),
      sb.from("admin_roles").select("user_id, role").order("created_at", {
        ascending: true,
      }),
      sb
        .from("stores")
        .select(
          "id, slug, name, is_active, logo_path, owner_id, profiles!stores_owner_id_fkey(display_name, avatar_path, signup_plan)",
        )
        .order("created_at", { ascending: false }),
      sb
        .from("profiles")
        .select("id, display_name, avatar_path, created_at")
        .order("created_at", { ascending: false })
        .limit(80),
      sb
        .from("seller_subscriptions")
        .select("paid_amount_pesewas, paystack_fee_pesewas, updated_at")
        .order("updated_at", { ascending: true }),
    ]);
    applySellerSubscriptionBilling(
      subSnapRes.data as unknown[] | null,
      subSnapRes.error,
      silent,
    );
    stats.value = {
      stores: s.count ?? 0,
      products: pr.count ?? 0,
      ticketsOpen: t.count ?? 0,
      adminUsers: adminRes.error ? 0 : (adminRes.count ?? 0),
    };
    if (authStore.isPlatformStaff) {
      ui.setAdminOpenTicketCount(stats.value.ticketsOpen);
    }
    if (adminRes.error) {
      toast.error(adminRes.error.message);
    }
    let adminUserIdSet = new Set<string>();
    if (adminRolesListRes.error) {
      toast.error(adminRolesListRes.error.message);
      adminStaffRows.value = [];
    } else {
      const roleRows = (adminRolesListRes.data ?? []) as {
        user_id: string;
        role: string;
      }[];
      adminUserIdSet = new Set(
        roleRows.map((r) => r.user_id).filter(Boolean) as string[],
      );
      const ids = [...adminUserIdSet];
      const profById = new Map<
        string,
        {
          display_name: string | null;
          avatar_path: string | null;
          signup_plan: string | null;
          last_seen_at: string | null;
        }
      >();
      if (ids.length > 0) {
        const { data: plist, error: pe } = await sb
          .from("profiles")
          .select("id, display_name, avatar_path, signup_plan, last_seen_at")
          .in("id", ids);
        if (pe) {
          toast.error(pe.message);
        } else {
          for (const row of plist ?? []) {
            const id = String((row as { id: string }).id);
            profById.set(id, {
              display_name:
                (row as { display_name?: string | null }).display_name ?? null,
              avatar_path:
                (row as { avatar_path?: string | null }).avatar_path ?? null,
              signup_plan:
                (row as { signup_plan?: string | null }).signup_plan?.trim() ||
                null,
              last_seen_at:
                (row as { last_seen_at?: string | null }).last_seen_at ?? null,
            });
          }
        }
      }
      const merged: AdminStaffRow[] = roleRows.map((r) => {
        const prof = profById.get(r.user_id);
        const name = prof?.display_name?.trim() || "Unknown";
        return {
          userId: r.user_id,
          role: r.role,
          displayName: name,
          avatarUrl: profileAvatarPublicUrl(prof?.avatar_path),
          initial: ownerInitialFromName(name),
          signupPlan: prof?.signup_plan ?? null,
          lastSeenAt: prof?.last_seen_at ?? null,
        };
      });
      merged.sort((a, b) => {
        const rank = (role: string) =>
          role === "super_admin" ? 0 : role === "admin" ? 1 : 2;
        const cr = rank(a.role) - rank(b.role);
        if (cr !== 0) return cr;
        return a.displayName.localeCompare(b.displayName, undefined, {
          sensitivity: "base",
        });
      });
      adminStaffRows.value = merged;
    }

    if (profilesRecentRes.error) {
      if (!silent) toast.error(profilesRecentRes.error.message);
      pendingConsoleUsers.value = [];
    } else if (adminRolesListRes.error) {
      pendingConsoleUsers.value = [];
    } else {
      const rawList = (profilesRecentRes.data ?? []) as {
        id: string;
        display_name?: string | null;
        avatar_path?: string | null;
        created_at?: string | null;
      }[];
      const pending: PendingConsoleUser[] = [];
      for (const row of rawList) {
        const id = String(row.id);
        if (adminUserIdSet.has(id)) continue;
        const name = row.display_name?.trim() || "Unknown";
        pending.push({
          id,
          displayName: name,
          avatarUrl: profileAvatarPublicUrl(row.avatar_path),
          initial: ownerInitialFromName(name),
          createdLabel: formatProfileCreatedLabel(row.created_at),
        });
        if (pending.length >= 15) break;
      }
      pendingConsoleUsers.value = pending;
    }

    if (storesRes.error) {
      toast.error(storesRes.error.message);
      storesFlat.value = [];
      productCountByStoreId.value = new Map();
    } else {
      storesFlat.value = (storesRes.data ?? []).map(
        (raw: Record<string, unknown>) => {
          const prof = raw.profiles as {
            display_name?: string | null;
            avatar_path?: string | null;
            signup_plan?: string | null;
          } | null;
          const logoRaw = raw.logo_path;
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
            owner_id: String(raw.owner_id),
            ownerName: prof?.display_name?.trim() || null,
            ownerAvatarPath: prof?.avatar_path?.trim() || null,
            ownerSignupPlan: prof?.signup_plan?.trim() || null,
          };
        },
      );
      const storeIds = storesFlat.value.map((x) => x.id);
      if (storeIds.length === 0) {
        productCountByStoreId.value = new Map();
      } else {
        const m = new Map<string, number>();
        const pageSize = 1000;
        let offset = 0;
        let prodErr: { message: string } | null = null;
        for (;;) {
          const { data: chunk, error } = await sb
            .from("products")
            .select("store_id")
            .in("store_id", storeIds)
            .range(offset, offset + pageSize - 1);
          if (error) {
            prodErr = error;
            break;
          }
          const rows = chunk ?? [];
          for (const r of rows) {
            const sid = String((r as { store_id: string }).store_id);
            m.set(sid, (m.get(sid) ?? 0) + 1);
          }
          if (rows.length < pageSize) break;
          offset += pageSize;
        }
        if (prodErr) {
          toast.error(prodErr.message);
          productCountByStoreId.value = new Map();
        } else {
          productCountByStoreId.value = m;
        }
      }
    }
  } finally {
    if (!silent) loading.value = false;
  }
}

onMounted(() => {
  document.addEventListener("keydown", onOwnerModalKeydown);
  hydrateAdminKpiHistories();
  void loadPlatformData(false);
  adminKpiSampleTimer = window.setInterval(() => {
    if (loading.value || !sessionUserId.value) return;
    const s = stats.value;
    adminStoresHistory.value = recordKpiSample(
      adminStoresHistory.value,
      s.stores,
      { force: true },
    );
    adminProductsHistory.value = recordKpiSample(
      adminProductsHistory.value,
      s.products,
      { force: true },
    );
    adminTicketsHistory.value = recordKpiSample(
      adminTicketsHistory.value,
      s.ticketsOpen,
      { force: true },
    );
    adminUsersHistory.value = recordKpiSample(
      adminUsersHistory.value,
      s.adminUsers,
      { force: true },
    );
    persistAdminKpiHistories();
  }, 60_000);
});

useRealtimeTableRefresh({
  channelName: "admin-platform-overview",
  deps: [loading],
  debounceMs: 120,
  getTables: () => [
    { table: "stores" },
    { table: "support_tickets" },
    { table: "admin_roles" },
    { table: "profiles" },
    { table: "products" },
    { table: "seller_subscriptions" },
  ],
  onEvent: () => loadPlatformData(true),
});

function adminRoleLabel(role: string): string {
  if (role === "super_admin") return "Super admin";
  if (role === "admin") return "Admin";
  return role;
}

function adminRoleBadgeClass(role: string): string {
  if (role === "super_admin") {
    return "border-violet-200/80 bg-violet-50 text-violet-900 ring-1 ring-violet-200/60";
  }
  return "border-slate-200/80 bg-slate-100 text-slate-800 ring-1 ring-slate-200/70";
}

const grantUserIdInput = ref("");
const grantBusy = ref(false);
/** When granting from the “recent sign-ups” row buttons. */
const grantRowBusyId = ref<string | null>(null);

/** Basic UUID v1–v5 shape check (lowercase normalized). */
function parseUuidLoose(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      t,
    )
  ) {
    return null;
  }
  return t;
}

async function grantPlatformAdminForId(raw: string): Promise<boolean> {
  const id = parseUuidLoose(raw);
  if (!id) {
    toast.error("Enter a valid user ID (UUID).");
    return false;
  }
  if (!isSupabaseConfigured()) return false;
  const { error } = await getSupabaseBrowser().rpc("grant_platform_admin", {
    p_target: id,
  });
  if (error) {
    toast.error(error.message);
    return false;
  }
  toast.success("Platform admin access granted.");
  return true;
}

async function submitGrantPlatformAdmin() {
  if (grantBusy.value || grantRowBusyId.value) return;
  grantBusy.value = true;
  try {
    const ok = await grantPlatformAdminForId(grantUserIdInput.value);
    if (ok) {
      grantUserIdInput.value = "";
      await loadPlatformData(true);
    }
  } finally {
    grantBusy.value = false;
  }
}

function prefillGrantUserId(id: string) {
  grantUserIdInput.value = id;
}

async function grantPendingRow(userId: string) {
  if (grantBusy.value || grantRowBusyId.value) return;
  grantRowBusyId.value = userId;
  try {
    const ok = await grantPlatformAdminForId(userId);
    if (ok) await loadPlatformData(true);
  } finally {
    grantRowBusyId.value = null;
  }
}

function openRevokeConfirm(u: AdminStaffRow) {
  if (u.role !== "admin" || !authStore.isSuperAdmin) return;
  revokeConfirmUser.value = u;
}

function closeRevokeConfirm() {
  if (revokeBusy.value) return;
  revokeConfirmUser.value = null;
}

async function confirmRevokeConsoleAccess() {
  const u = revokeConfirmUser.value;
  if (!u || revokeBusy.value || !isSupabaseConfigured()) return;
  revokeBusy.value = true;
  try {
    const { error } = await getSupabaseBrowser().rpc("revoke_platform_admin", {
      p_target: u.userId,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Console access removed.");
    revokeConfirmUser.value = null;
    await loadPlatformData(true);
  } finally {
    revokeBusy.value = false;
  }
}
</script>

<template>
  <div
    class="flex min-w-0 flex-col md:min-h-[calc(90dvh-9rem)] lg:min-h-[calc(90dvh-8.5rem)]"
  >
    <h1
      class="shrink-0 text-2xl font-bold tracking-tight text-zinc-900 sm:text-[1.65rem]"
    >
      Platform overview
    </h1>

    <SkeletonAdminStats v-if="loading" class="mt-6 min-h-0 md:mt-8 md:flex-1" />
    <div
      v-else
      class="mt-6 grid min-h-0 flex-1 grid-cols-1 gap-6 md:mt-8 md:grid-cols-[minmax(0,1fr)_minmax(13.5rem,18%)] md:items-stretch md:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,22%)] lg:gap-8"
    >
      <!-- Main column: stat cards + shop pipeline (always stacked here) -->
      <div
        class="flex h-full min-h-0 min-w-0 flex-col gap-6 md:min-h-0 lg:gap-8"
      >
        <ul
          class="grid min-w-0 shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 lg:gap-4"
        >
          <li
            v-for="card in statCards"
            :key="card.key"
            class="flex flex-col rounded-2xl border p-4 sm:rounded-[1.35rem] sm:p-4 lg:p-5"
            :class="[card.border, card.bg, card.shadow]"
          >
            <p
              class="text-xs font-semibold uppercase tracking-wider"
              :class="card.labelClass"
            >
              {{ card.label }}
            </p>
            <div
              class="mt-2 flex min-w-0 items-end justify-between gap-2.5 sm:mt-3 sm:gap-3"
            >
              <p
                class="min-w-0 flex-1 text-3xl font-bold tabular-nums leading-[0.95] tracking-tight text-zinc-900 sm:text-4xl sm:leading-[0.92] lg:text-[2.35rem] lg:leading-[0.92]"
              >
                {{ card.value }}
              </p>
              <div
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/85 shadow-md shadow-zinc-900/10 ring-1 ring-white/95 sm:h-14 sm:w-14 sm:rounded-[1.1rem]"
                aria-hidden="true"
              >
                <svg
                  v-if="card.key === 'stores'"
                  class="h-7 w-7 text-violet-700 sm:h-8 sm:w-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75A2.25 2.25 0 0115.75 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H15.75A2.25 2.25 0 0113.5 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25z"
                  />
                </svg>
                <svg
                  v-else-if="card.key === 'products'"
                  class="h-7 w-7 text-sky-700 sm:h-8 sm:w-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M20.25 7.5l-.625 10.5a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
                  />
                </svg>
                <svg
                  v-else-if="card.key === 'ticketsOpen'"
                  class="h-7 w-7 text-amber-700 sm:h-8 sm:w-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6M6 18v-3.75m-3 .75h18"
                  />
                </svg>
                <svg
                  v-else-if="card.key === 'adminUsers'"
                  class="h-7 w-7 text-emerald-700 sm:h-8 sm:w-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.433-2.054A4.125 4.125 0 0015 19.128zM12.378 4.376a3.375 3.375 0 114.872 4.874A3.375 3.375 0 0112.378 4.376zM6.75 8.25a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0zM9.75 15.75a3 3 0 116 0H9.75z"
                  />
                </svg>
                <svg
                  v-else
                  class="h-7 w-7 text-zinc-500 sm:h-8 sm:w-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25A2.25 2.25 0 018.25 10.5H6A2.25 2.25 0 013.75 8.25V6z"
                  />
                </svg>
              </div>
            </div>
            <p
              class="mt-2 inline-flex w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold sm:mt-2.5"
              :class="card.pillClass"
            >
              {{ card.pill }}
            </p>
            <p
              class="mt-1.5 text-xs font-medium leading-snug"
              :class="card.subtitleClass"
            >
              {{ card.subtitle }}
            </p>

            <div class="mt-auto space-y-1.5 pt-3 sm:pt-4">
              <div
                class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500"
              >
                <span>Share of row total</span>
                <span class="tabular-nums text-zinc-700">
                  {{ shareOfCombinedPct(card.value) }}% ·
                  <span
                    class="font-mono normal-case font-semibold text-zinc-600"
                    >{{ card.value }}</span
                  >
                  <span class="normal-case font-medium">/</span>
                  <span
                    class="font-mono normal-case font-semibold text-zinc-600"
                    >{{ rowTotal }}</span
                  >
                </span>
              </div>
              <p class="text-[10px] font-medium text-zinc-500">
                Live trend (48h, this browser) · hover chart for time &amp; value
              </p>
              <div
                class="h-[6.5rem] w-full shrink-0 sm:h-28 lg:h-[7.25rem]"
                :aria-label="`${card.label} count over time`"
              >
                <DashboardKpiTimeChart
                  :points="kpiPointsFor(card.key)"
                  :stroke="card.chart.stroke"
                  :fill="card.chart.fill"
                  :axis-stroke="card.chart.axisStroke"
                  :grid-stroke="card.chart.gridStroke"
                />
              </div>
              <p
                v-if="rowTotal > 0"
                class="text-[10px] leading-snug text-zinc-500"
              >
                Row total =
                <span class="font-mono font-medium text-zinc-600">{{
                  rowTotal
                }}</span>
                (stores + products + open tickets + console users). Share is
                this metric’s fraction of that sum.
              </p>
              <p v-else class="text-[10px] leading-snug text-zinc-500">
                All headline counts are zero — combined total is 0.
              </p>
            </div>
          </li>
        </ul>

        <section
          class="relative isolate w-full min-w-0 shrink-0 overflow-hidden rounded-2xl border border-white/55 bg-gradient-to-br from-white/50 via-emerald-50/[0.22] to-lime-100/[0.28] p-4 shadow-[0_24px_48px_-18px_rgba(6,95,70,0.14),inset_0_1px_0_rgba(255,255,255,0.72)] ring-1 ring-white/35 backdrop-blur-2xl sm:rounded-3xl sm:p-5"
          aria-label="Seller subscription cashflow"
          :title="`Net after fees: ${formatGhs(subscriptionNetTotalPesewas)}`"
        >
          <div
            class="pointer-events-none absolute -right-20 -top-28 h-56 w-56 rounded-full bg-lime-300/[0.22] blur-3xl"
            aria-hidden="true"
          />
          <div
            class="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-emerald-400/[0.14] blur-3xl"
            aria-hidden="true"
          />
          <div
            class="pointer-events-none absolute left-1/2 top-1/2 h-40 w-[min(100%,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-200/[0.08] blur-2xl"
            aria-hidden="true"
          />

          <div class="relative z-10">
            <div
              class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div class="min-w-0">
                <h2
                  class="text-lg font-bold tracking-tight text-zinc-900/95 drop-shadow-sm"
                >
                  Subscription cashflow
                </h2>
                <p class="mt-1 text-xs font-medium text-zinc-600/85">
                  Net balance
                </p>
                <p
                  class="mt-1 bg-gradient-to-br from-zinc-900 via-zinc-800 to-emerald-900/90 bg-clip-text text-2xl font-bold tabular-nums tracking-tight text-transparent sm:text-3xl"
                >
                  {{ formatGhs(subscriptionNetTotalPesewas) }}
                </p>
              </div>
              <div
                class="flex shrink-0 flex-col items-stretch gap-3 sm:items-end"
              >
                <div class="flex flex-wrap items-center justify-end gap-2">
                  <label class="sr-only" for="subscription-cashflow-period"
                    >Period</label
                  >
                  <select
                    id="subscription-cashflow-period"
                    v-model="subscriptionCashflowPeriod"
                    class="rounded-full border border-white/60 bg-white/35 px-3 py-2 text-xs font-semibold text-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] outline-none ring-emerald-400/0 backdrop-blur-md transition hover:bg-white/50 focus:ring-2 focus:ring-emerald-400/35"
                  >
                    <option value="year">This year</option>
                    <option value="6m">Last 6 months</option>
                  </select>
                  <span
                    class="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/45 bg-emerald-500/[0.14] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur-md"
                  >
                    <span class="relative flex h-2 w-2">
                      <span
                        class="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70"
                        aria-hidden="true"
                      />
                      <span
                        class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.65)]"
                        aria-hidden="true"
                      />
                    </span>
                    Live
                  </span>
                </div>
                <div
                  class="flex flex-wrap items-center justify-end gap-2 sm:gap-3"
                >
                  <span
                    class="inline-flex items-center gap-1.5 rounded-full border border-white/50 bg-white/25 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-sm"
                  >
                    <span
                      class="h-2.5 w-2.5 shrink-0 rounded-sm bg-gradient-to-br from-lime-300 to-lime-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ring-1 ring-lime-400/40"
                      aria-hidden="true"
                    />
                    Paid
                  </span>
                  <span
                    class="inline-flex items-center gap-1.5 rounded-full border border-white/50 bg-white/25 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-sm"
                  >
                    <span
                      class="h-2.5 w-2.5 shrink-0 rounded-sm bg-gradient-to-br from-emerald-900 to-emerald-950 shadow-[inset_0_-1px_0_rgba(0,0,0,0.35)] ring-1 ring-emerald-950/30"
                      aria-hidden="true"
                    />
                    Fees
                  </span>
                </div>
              </div>
            </div>
            <div class="mt-5">
              <AdminSubscriptionCashflowChart
                :months="subscriptionCashflowMonths"
              />
            </div>
          </div>
        </section>

        <div
          class="flex min-h-[16rem] flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-zinc-200/60 bg-white shadow-[0_28px_70px_-40px_rgba(15,23,42,0.18)] sm:min-h-[17rem] sm:rounded-3xl md:min-h-0"
        >
          <div
            class="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 sm:px-6"
          >
            <h2 class="text-lg font-bold text-zinc-900">Shop pipeline</h2>
            <button
              type="button"
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200/80 bg-zinc-50 text-lg font-bold leading-none text-zinc-400 transition hover:bg-white hover:text-zinc-600"
              aria-label="More"
            >
              ···
            </button>
          </div>

          <template v-if="ownerPipelineRows.length">
            <div
              class="min-h-0 flex-1 overflow-y-auto overflow-x-auto overscroll-y-contain"
            >
              <table
                class="min-w-full border-collapse text-left text-sm ring-1 ring-inset ring-zinc-200/90"
              >
                <thead class="sticky top-0 z-[1]">
                  <tr
                    class="border-b-2 border-zinc-200 bg-zinc-50/95 text-xs font-semibold uppercase tracking-wider text-zinc-500 backdrop-blur-sm"
                  >
                    <th
                      class="border-r border-zinc-200/90 px-5 py-3 sm:px-6 last:border-r-0"
                    >
                      Owner
                    </th>
                    <th class="border-r border-zinc-200/90 px-3 py-3">Plan</th>
                    <th class="border-r border-zinc-200/90 px-3 py-3">
                      Stores
                    </th>
                    <th class="border-r border-zinc-200/90 px-3 py-3">
                      Products
                    </th>
                    <th class="px-5 py-3 text-right sm:px-6">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in ownerPipelineRows"
                    :key="row.ownerId"
                    class="border-b border-zinc-200/70 bg-white/90 transition last:border-b-0 hover:bg-zinc-50/90"
                  >
                    <td
                      class="border-r border-zinc-200/60 px-5 py-4 font-semibold text-zinc-900 sm:px-6 last:border-r-0"
                    >
                      <div
                        class="flex min-w-0 max-w-[20rem] items-center gap-3"
                      >
                        <span
                          class="relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white shadow-sm ring-2 ring-white/90"
                        >
                          <span
                            class="absolute inset-0 flex items-center justify-center"
                            aria-hidden="true"
                            >{{ row.ownerInitial }}</span
                          >
                          <img
                            v-if="row.ownerAvatarUrl"
                            :src="row.ownerAvatarUrl"
                            alt=""
                            class="relative z-10 h-full w-full object-cover"
                            loading="lazy"
                            @error="
                              ($event.target as HTMLImageElement).classList.add(
                                'hidden',
                              )
                            "
                          />
                        </span>
                        <span class="min-w-0 truncate">{{
                          row.ownerName
                        }}</span>
                      </div>
                    </td>
                    <td
                      class="border-r border-zinc-200/60 px-3 py-4 text-sm font-medium text-zinc-800 last:border-r-0"
                    >
                      {{ row.subscriptionPlanLabel }}
                    </td>
                    <td
                      class="border-r border-zinc-200/60 px-3 py-4 text-zinc-800 last:border-r-0"
                    >
                      <span
                        v-if="row.storeCount === 1"
                        class="block max-w-[14rem] truncate font-medium text-zinc-900"
                        :title="pipelineStoresCell(row)"
                        >{{ pipelineStoresCell(row) }}</span
                      >
                      <span v-else class="tabular-nums text-zinc-700">{{
                        row.storeCount
                      }}</span>
                    </td>
                    <td
                      class="border-r border-zinc-200/60 px-3 py-4 tabular-nums text-zinc-700 last:border-r-0"
                    >
                      {{ row.productTotal.toLocaleString() }}
                    </td>
                    <td class="px-5 py-4 text-right sm:px-6">
                      <button
                        type="button"
                        class="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-teal-600 to-emerald-700 text-white shadow-[0_6px_20px_-4px_rgba(13,148,136,0.55)] ring-2 ring-teal-200/90 ring-offset-2 ring-offset-white transition hover:from-teal-500 hover:to-emerald-600 hover:shadow-[0_8px_26px_-4px_rgba(13,148,136,0.65)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 active:scale-[0.96] motion-reduce:active:scale-100 sm:h-12 sm:w-12"
                        :aria-label="`View stores for ${row.ownerName}`"
                        :title="`View stores · ${row.ownerName}`"
                        @click="openOwnerStoresModal(row)"
                      >
                        <svg
                          class="h-6 w-6 drop-shadow-sm sm:h-[1.65rem] sm:w-[1.65rem]"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          aria-hidden="true"
                        >
                          <path
                            d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18M2.25 9h1.5m2.25 0h1.5m2.25 0h1.5m2.25 0H15m3 0h1.5M5.25 19.5h13.5a.75.75 0 00.75-.75V6.75a.75.75 0 00-.75-.75H5.25a.75.75 0 00-.75.75v12a.75.75 0 00.75.75z"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <div
            v-else
            class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-14 text-center md:py-8"
          >
            <p class="text-lg font-semibold text-zinc-900">No shops yet</p>
            <p class="mt-2 text-sm text-zinc-600">
              Stores will appear here as sellers create storefronts on the
              platform.
            </p>
          </div>
        </div>
      </div>

      <!-- Console: platform staff directory -->
      <aside
        class="flex h-full min-h-0 w-full min-w-0 flex-col gap-4 rounded-[1.75rem] border border-indigo-200/45 bg-gradient-to-br from-white/95 via-indigo-50/35 to-violet-50/45 p-5 shadow-[0_20px_50px_-32px_rgba(79,70,229,0.12)] backdrop-blur-sm sm:rounded-3xl sm:p-6 md:min-h-[18rem]"
      >
        <div class="shrink-0 min-w-0">
          <p
            class="text-[11px] font-semibold uppercase tracking-wider text-indigo-900/70"
          >
            Console
          </p>
          <div
            class="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2"
          >
            <h2
              class="min-w-0 text-lg font-bold tracking-tight text-zinc-900"
            >
              Console users
            </h2>
            <div
              class="inline-flex shrink-0 items-center gap-2 rounded-full border border-indigo-200/55 bg-white/55 py-1 pl-2.5 pr-3 shadow-sm ring-1 ring-indigo-100/40 backdrop-blur-md"
              role="status"
              :aria-label="`${consoleStaffOnlineCount} of ${adminStaffRows.length} console users online`"
            >
              <span
                class="h-2 w-2 shrink-0 rounded-full shadow-inner ring-1 ring-black/5"
                :class="
                  consoleStaffOnlineCount > 0 ? 'bg-emerald-500' : 'bg-zinc-300'
                "
                aria-hidden="true"
              />
              <span
                class="whitespace-nowrap text-[13px] leading-none text-zinc-600"
              >
                <span class="font-semibold tabular-nums text-zinc-900">{{
                  consoleStaffOnlineCount
                }}</span>
                <span class="mx-0.5 font-medium text-zinc-400">/</span>
                <span class="tabular-nums text-zinc-500">{{
                  adminStaffRows.length
                }}</span>
                <span class="ml-1.5 text-[12px] font-medium text-zinc-500"
                  >online</span
                >
              </span>
            </div>
          </div>
          <p class="mt-1 text-sm leading-relaxed text-zinc-600">
            Everyone with access to this admin workspace.
          </p>
          <p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-snug text-zinc-500">
            <span class="inline-flex items-center gap-1.5">
              <span
                class="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-2 ring-white shadow-sm"
                aria-hidden="true"
              />
              Active here within ~2 min
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span
                class="h-2.5 w-2.5 shrink-0 rounded-full bg-zinc-500 ring-2 ring-white shadow-sm"
                aria-hidden="true"
              />
              Not active in that window
            </span>
          </p>
        </div>
        <ul
          class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain pr-0.5"
          role="list"
          aria-label="Platform staff"
        >
          <li
            v-for="u in adminStaffRows"
            :key="u.userId"
            class="flex min-w-0 items-center gap-3 rounded-2xl border border-white/80 bg-white/75 px-3 py-2.5 shadow-sm ring-1 ring-zinc-200/40"
          >
            <span
              class="relative inline-flex h-10 w-10 shrink-0"
              :title="
                isConsoleUserLive(u.userId, u.lastSeenAt)
                  ? 'Live — active in this app recently (realtime or heartbeat)'
                  : 'Away — not active here in the last few minutes'
              "
            >
              <span
                class="relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-xs font-bold text-white shadow-sm ring-2 ring-white/90"
              >
                <span
                  class="absolute inset-0 flex items-center justify-center"
                  aria-hidden="true"
                  >{{ u.initial }}</span
                >
                <img
                  v-if="u.avatarUrl"
                  :src="u.avatarUrl"
                  alt=""
                  class="relative z-10 h-full w-full object-cover"
                  loading="lazy"
                  @error="
                    ($event.target as HTMLImageElement).classList.add('hidden')
                  "
                />
              </span>
              <span
                class="pointer-events-none absolute -bottom-0.5 -right-0.5 z-10 h-4 w-4 rounded-full border-[3px] border-white shadow-md ring-1 ring-black/10"
                :class="
                  isConsoleUserLive(u.userId, u.lastSeenAt)
                    ? 'bg-emerald-500 shadow-emerald-900/30'
                    : 'bg-zinc-500 shadow-zinc-900/25'
                "
                aria-hidden="true"
              />
            </span>
            <div
              class="flex min-w-0 flex-1 items-center justify-between gap-3"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-zinc-900">
                  {{ u.displayName
                  }}<span class="sr-only">{{
                    isConsoleUserLive(u.userId, u.lastSeenAt)
                      ? ", active here within about two minutes."
                      : ", not active here recently."
                  }}</span>
                </p>
                <p
                  class="mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  :class="adminRoleBadgeClass(u.role)"
                >
                  {{ adminRoleLabel(u.role) }}
                </p>
              </div>
              <div
                class="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-3"
              >
                <div
                  v-if="u.role !== 'super_admin'"
                  class="text-right leading-tight"
                >
                  <p
                    class="text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                  >
                    Plan
                  </p>
                  <p class="text-sm font-bold tabular-nums text-zinc-900">
                    {{ planLabelFromSignupId(u.signupPlan) }}
                  </p>
                </div>
                <button
                  v-if="authStore.isSuperAdmin && u.role === 'admin'"
                  type="button"
                  class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rose-200/90 bg-rose-50/90 text-rose-800 shadow-sm ring-1 ring-rose-100/70 transition hover:border-rose-400/80 hover:bg-rose-100 hover:text-rose-950"
                  :aria-label="`Remove ${u.displayName} from admin workspace`"
                  :title="`Remove ${u.displayName} from the admin workspace`"
                  @click="openRevokeConfirm(u)"
                >
                  <svg
                    class="h-[18px] w-[18px]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <line x1="17" x2="23" y1="11" y2="11" />
                  </svg>
                </button>
              </div>
            </div>
          </li>
          <li
            v-if="!adminStaffRows.length"
            class="rounded-2xl border border-dashed border-zinc-200/80 bg-white/40 px-3 py-6 text-center text-xs text-zinc-500"
          >
            No console users loaded.
          </li>
        </ul>

        <div
          v-if="authStore.isSuperAdmin"
          id="grant-access"
          tabindex="-1"
          class="grant-access-panel shrink-0 overflow-hidden rounded-3xl border border-indigo-200/40 bg-gradient-to-br from-white via-indigo-50/30 to-violet-50/40 p-4 shadow-[0_16px_48px_-28px_rgba(79,70,229,0.18)] ring-1 ring-white/80 sm:p-5"
        >
          <div class="flex gap-3 border-b border-indigo-100/60 pb-4">
            <div
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-600/25"
              aria-hidden="true"
            >
              <svg
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <h3
                class="text-sm font-bold tracking-tight text-zinc-900 sm:text-[0.95rem]"
              >
                Grant access
              </h3>
              <p class="mt-1.5 text-[13px] leading-relaxed text-zinc-600">
                Console access is never automatic for new sign-ups. Choose someone
                from recent
                <span
                  class="rounded bg-violet-100/90 px-1 py-0.5 font-mono text-[11px] font-semibold text-violet-900"
                  >profiles</span
                >
                below, or paste a UUID to grant platform
                <span
                  class="rounded bg-indigo-100/90 px-1 py-0.5 text-[11px] font-semibold text-indigo-900"
                  >admin</span
                >.
              </p>
            </div>
          </div>

          <div class="mt-4 min-w-0 rounded-2xl bg-white/70 p-3 ring-1 ring-zinc-200/50 sm:p-4">
            <p
              class="text-[11px] font-bold uppercase tracking-[0.12em] text-indigo-800/70"
            >
              Recent sign-ups · no console role
            </p>
            <div
              v-if="!pendingConsoleUsers.length"
              class="mt-3 rounded-xl border border-dashed border-zinc-200/90 bg-zinc-50/80 px-4 py-5 text-center"
            >
              <p class="text-sm font-medium text-zinc-700">No candidates</p>
              <p class="mt-1.5 text-xs leading-relaxed text-zinc-500">
                No one in the latest batch needs access, or they already have a
                role.
              </p>
            </div>
            <ul
              v-else
              class="grant-pending-scroll mt-3 max-h-52 space-y-2 overflow-y-auto overscroll-y-contain pr-0.5"
              role="list"
              aria-label="Accounts without console role"
            >
              <li
                v-for="p in pendingConsoleUsers"
                :key="p.id"
                class="flex min-w-0 flex-col gap-2 rounded-xl border border-zinc-100 bg-white/95 p-2.5 shadow-sm ring-1 ring-zinc-100/80 sm:flex-row sm:items-center sm:gap-3 sm:p-3"
              >
                <div class="flex min-w-0 flex-1 items-center gap-2.5">
                  <span
                    class="relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-xs font-bold text-white shadow-md ring-2 ring-white"
                    aria-hidden="true"
                  >
                    <span
                      class="absolute inset-0 flex items-center justify-center"
                      >{{ p.initial }}</span
                    >
                    <img
                      v-if="p.avatarUrl"
                      :src="p.avatarUrl"
                      alt=""
                      class="relative z-10 h-full w-full object-cover"
                      loading="lazy"
                      @error="
                        ($event.target as HTMLImageElement).classList.add(
                          'hidden',
                        )
                      "
                    />
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-semibold text-zinc-900">
                      {{ p.displayName }}
                    </p>
                    <p class="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                      Joined {{ p.createdLabel }}
                      <span class="text-zinc-400">·</span>
                      …{{ p.id.slice(-8) }}
                    </p>
                  </div>
                </div>
                <div
                  class="flex w-full shrink-0 gap-2 sm:w-auto sm:flex-col sm:gap-1.5"
                >
                  <button
                    type="button"
                    class="flex-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-600/20 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none sm:py-1.5"
                    :disabled="
                      grantBusy ||
                      (grantRowBusyId !== null && grantRowBusyId !== p.id)
                    "
                    @click="grantPendingRow(p.id)"
                  >
                    {{ grantRowBusyId === p.id ? "Granting…" : "Grant admin" }}
                  </button>
                  <button
                    type="button"
                    class="flex-1 rounded-xl border border-zinc-200/90 bg-zinc-50/90 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none sm:py-1.5"
                    :disabled="grantBusy || grantRowBusyId !== null"
                    @click="prefillGrantUserId(p.id)"
                  >
                    Prefill UUID
                  </button>
                </div>
              </li>
            </ul>
          </div>

          <div class="mt-4">
            <label
              for="grant-user-id-input"
              class="block text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
            >
              User ID (UUID)
            </label>
            <input
              id="grant-user-id-input"
              v-model="grantUserIdInput"
              type="text"
              autocomplete="off"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              class="mt-1.5 w-full rounded-xl border border-zinc-200/90 bg-white px-3 py-2.5 font-mono text-sm text-zinc-900 shadow-inner outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200/90"
              :disabled="grantBusy || grantRowBusyId !== null"
              @keydown.enter.prevent="submitGrantPlatformAdmin"
            />
          </div>
          <button
            type="button"
            class="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:from-indigo-700 hover:to-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="grantBusy || grantRowBusyId !== null"
            @click="submitGrantPlatformAdmin"
          >
            {{ grantBusy ? "Granting…" : "Grant platform admin" }}
          </button>
        </div>
      </aside>
    </div>

    <Teleport to="body">
      <Transition name="admin-owner-stores-bg">
        <div
          v-if="modalOpen"
          class="fixed inset-0 z-[260] bg-zinc-900/50 backdrop-blur-sm"
          aria-hidden="true"
        />
      </Transition>
      <Transition name="admin-owner-stores-drawer">
        <aside
          v-if="modalOpen"
          class="owner-stores-drawer fixed inset-y-0 right-0 z-[261] flex w-full max-w-xl flex-col overflow-hidden border-l border-white/30 bg-gradient-to-b from-zinc-50/95 via-white to-indigo-50/40 shadow-[-28px_0_90px_-28px_rgba(15,23,42,0.35)] backdrop-blur-2xl sm:rounded-l-3xl sm:max-w-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="owner-stores-modal-title"
        >
          <div
            class="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200/40 bg-white/50 px-5 py-4 backdrop-blur-md sm:px-6 sm:py-5"
          >
            <div class="flex min-w-0 flex-1 items-start gap-3.5">
              <span
                class="relative flex h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 via-violet-600 to-indigo-700 text-sm font-bold text-white shadow-lg shadow-violet-500/25 ring-2 ring-white/90"
                aria-hidden="true"
              >
                <span
                  class="absolute inset-0 flex items-center justify-center"
                  >{{ modalOwnerInitial }}</span
                >
                <img
                  v-if="modalOwnerAvatarUrl"
                  :src="modalOwnerAvatarUrl"
                  alt=""
                  class="relative z-10 h-full w-full object-cover"
                  loading="lazy"
                  @error="
                    ($event.target as HTMLImageElement).classList.add('hidden')
                  "
                />
              </span>
              <div class="min-w-0 flex-1 pt-0.5">
                <h2
                  id="owner-stores-modal-title"
                  class="text-[0.95rem] font-bold leading-snug tracking-tight text-zinc-900 sm:text-base"
                >
                  Stores for this seller
                </h2>
                <p class="mt-1 truncate text-[13px] text-zinc-500">
                  {{ modalOwnerName }}
                  <span class="tabular-nums text-zinc-400">
                    · {{ modalStores.length }} shop{{
                      modalStores.length === 1 ? "" : "s"
                    }}</span
                  >
                </p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <span
                    class="inline-flex items-center rounded-full bg-violet-100/90 px-2.5 py-1 text-[11px] font-semibold text-violet-900 ring-1 ring-violet-200/60"
                  >
                    Plan · {{ modalOwnerPlanLabel }}
                  </span>
                  <span
                    v-if="!modalProductsLoading"
                    class="inline-flex items-center rounded-full bg-zinc-900/[0.06] px-2.5 py-1 text-[11px] font-semibold tabular-nums text-zinc-700 ring-1 ring-zinc-200/70"
                  >
                    {{ modalCatalogProductTotal }} product{{
                      modalCatalogProductTotal === 1 ? "" : "s"
                    }}
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100/90 text-zinc-500 ring-1 ring-zinc-200/60 transition hover:bg-zinc-200/90 hover:text-zinc-900"
              aria-label="Close"
              @click="closeOwnerStoresModal"
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
            class="owner-stores-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-5 sm:px-6 sm:py-6"
          >
            <div
              v-if="modalProductsLoading"
              class="flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/60 py-20 text-sm text-zinc-500 ring-1 ring-zinc-200/50"
              role="status"
              aria-live="polite"
            >
              <span
                class="h-9 w-9 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600"
                aria-hidden="true"
              />
              Loading catalog…
            </div>
            <ul
              v-else
              class="flex flex-col gap-4"
              role="tree"
              aria-label="Stores and catalog products"
            >
              <li
                v-for="(s, idx) in modalStores"
                :key="s.id"
                class="owner-store-tree-card overflow-hidden rounded-2xl bg-white/85 shadow-[0_12px_40px_-18px_rgba(15,23,42,0.12)] ring-1 ring-zinc-200/50 transition-[box-shadow,ring-color] duration-200 hover:shadow-[0_16px_48px_-18px_rgba(91,33,182,0.14)] hover:ring-violet-200/60"
                role="treeitem"
                :aria-expanded="isModalStoreExpanded(s.id)"
              >
                <div class="flex gap-1 p-1.5 sm:gap-2 sm:p-2">
                  <button
                    type="button"
                    class="flex w-9 shrink-0 items-center justify-center self-stretch rounded-xl text-zinc-400 transition hover:bg-violet-50 hover:text-violet-700"
                    :aria-controls="`store-branch-${s.id}`"
                    :aria-label="
                      isModalStoreExpanded(s.id)
                        ? `Collapse products for ${s.name}`
                        : `Expand products for ${s.name}`
                    "
                    @click="toggleModalStoreExpand(s.id)"
                  >
                    <svg
                      class="h-4 w-4 transition-transform duration-200 ease-out"
                      :class="isModalStoreExpanded(s.id) ? 'rotate-90' : ''"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                  <div class="min-w-0 flex-1 pr-1 pb-1 pt-0.5 sm:pr-2 sm:pb-2">
                    <div
                      class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div class="flex min-w-0 items-center gap-3">
                        <span
                          class="relative flex h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-xs font-bold text-white shadow-md shadow-indigo-500/20 ring-2 ring-white"
                          aria-hidden="true"
                        >
                          <span
                            class="absolute inset-0 flex items-center justify-center"
                            >{{ storeInitialFromName(s.name) }}</span
                          >
                          <img
                            v-if="storeLogoPublicUrl(s.id, s.logo_path)"
                            :src="storeLogoPublicUrl(s.id, s.logo_path) ?? ''"
                            alt=""
                            class="relative z-10 h-full w-full object-cover"
                            loading="lazy"
                            @error="
                              ($event.target as HTMLImageElement).classList.add(
                                'hidden',
                              )
                            "
                          />
                        </span>
                        <div class="min-w-0">
                          <p
                            class="truncate text-[15px] font-semibold tracking-tight text-zinc-900"
                            :title="s.name"
                          >
                            {{ s.name }}
                          </p>
                          <p
                            class="mt-1 inline-flex max-w-full truncate rounded-md bg-zinc-100/90 px-2 py-0.5 font-mono text-[11px] font-medium text-zinc-600"
                            :title="`/${s.slug}`"
                          >
                            /{{ s.slug }}
                          </p>
                        </div>
                      </div>
                      <div
                        class="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end"
                      >
                        <span
                          class="inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold"
                          :class="
                            s.is_active
                              ? pipelineRowTone(idx).chip
                              : 'bg-zinc-200/80 text-zinc-700 ring-1 ring-zinc-300/40'
                          "
                        >
                          {{ s.is_active ? "Live" : "Paused" }}
                        </span>
                        <span
                          class="rounded-full bg-gradient-to-r from-zinc-50 to-zinc-100/90 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-zinc-700 ring-1 ring-zinc-200/70"
                        >
                          {{ modalProductsForStore(s.id).length }} product{{
                            modalProductsForStore(s.id).length === 1 ? "" : "s"
                          }}
                        </span>
                      </div>
                    </div>
                    <ul
                      v-show="isModalStoreExpanded(s.id)"
                      :id="`store-branch-${s.id}`"
                      class="owner-store-product-list mt-4 space-y-1.5 border-t border-zinc-100/90 pt-3"
                      role="group"
                      :aria-label="`Products in ${s.name}`"
                    >
                      <li
                        v-for="p in modalProductsForStore(s.id)"
                        :key="p.id"
                        class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-violet-50/40 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                        role="none"
                      >
                        <span
                          class="min-w-0 truncate font-medium text-zinc-900"
                          :title="p.title"
                          >{{ p.title }}</span
                        >
                        <span
                          class="shrink-0 justify-self-end tabular-nums text-[13px] font-semibold text-zinc-600 sm:justify-self-auto"
                          >{{ formatGhs(p.price_cents) }}</span
                        >
                        <span
                          class="col-span-2 justify-self-start sm:col-span-1 sm:justify-self-end"
                        >
                          <span
                            class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide"
                            :class="
                              p.is_published
                                ? 'bg-emerald-500/10 text-emerald-800 ring-1 ring-emerald-300/40'
                                : 'bg-zinc-500/10 text-zinc-600 ring-1 ring-zinc-300/40'
                            "
                          >
                            {{ p.is_published ? "Published" : "Draft" }}
                          </span>
                        </span>
                      </li>
                      <li
                        v-if="modalProductsForStore(s.id).length === 0"
                        class="rounded-xl bg-zinc-50/80 px-3 py-4 text-center text-xs text-zinc-500"
                        role="presentation"
                      >
                        No products in this storefront yet.
                      </li>
                    </ul>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </aside>
      </Transition>

      <Transition name="admin-revoke-dialog">
        <div
          v-if="revokeConfirmUser"
          class="fixed inset-0 z-[270] flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            class="absolute inset-0 bg-zinc-900/50 backdrop-blur-sm"
            aria-hidden="true"
          />
          <div
            class="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-[0_24px_80px_-24px_rgba(15,23,42,0.35)] ring-1 ring-zinc-100/80 sm:p-6"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="revoke-console-title"
            aria-describedby="revoke-console-desc"
            @click.stop
          >
            <h2
              id="revoke-console-title"
              class="text-base font-bold tracking-tight text-zinc-900"
            >
              Remove console access?
            </h2>
            <p
              id="revoke-console-desc"
              class="mt-2 text-sm leading-relaxed text-zinc-600"
            >
              <span class="font-semibold text-zinc-800">{{
                revokeConfirmUser.displayName
              }}</span>
              will lose platform admin access. They can be granted again later if
              needed. Users on an auto-grant email domain may regain access on
              their next sign-in unless that domain is removed from the allow
              list.
            </p>
            <div class="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                class="inline-flex rounded-xl border border-zinc-200/90 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="revokeBusy"
                @click="closeRevokeConfirm"
              >
                Cancel
              </button>
              <button
                type="button"
                class="inline-flex rounded-xl bg-gradient-to-r from-rose-600 to-rose-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-rose-600/25 transition hover:from-rose-700 hover:to-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="revokeBusy"
                @click="confirmRevokeConsoleAccess"
              >
                {{ revokeBusy ? "Removing…" : "Remove access" }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.admin-revoke-dialog-enter-active,
.admin-revoke-dialog-leave-active {
  transition: opacity 0.2s ease;
}
.admin-revoke-dialog-enter-active > div.relative,
.admin-revoke-dialog-leave-active > div.relative {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.admin-revoke-dialog-enter-from,
.admin-revoke-dialog-leave-to {
  opacity: 0;
}
.admin-revoke-dialog-enter-from > div.relative,
.admin-revoke-dialog-leave-to > div.relative {
  transform: scale(0.96);
  opacity: 0;
}

.admin-owner-stores-bg-enter-active,
.admin-owner-stores-bg-leave-active {
  transition: opacity 0.22s ease;
}
.admin-owner-stores-bg-enter-from,
.admin-owner-stores-bg-leave-to {
  opacity: 0;
}

.admin-owner-stores-drawer-enter-active,
.admin-owner-stores-drawer-leave-active {
  transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1);
}
.admin-owner-stores-drawer-enter-from,
.admin-owner-stores-drawer-leave-to {
  transform: translateX(100%);
}

.owner-stores-scroll {
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgb(212 212 216 / 0.85) transparent;
}

.owner-stores-scroll::-webkit-scrollbar {
  width: 7px;
}

.owner-stores-scroll::-webkit-scrollbar-thumb {
  border-radius: 9999px;
  background-color: rgb(212 212 216 / 0.9);
}

.owner-stores-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.grant-pending-scroll {
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgb(199 210 254 / 0.9) transparent;
}

.grant-pending-scroll::-webkit-scrollbar {
  width: 6px;
}

.grant-pending-scroll::-webkit-scrollbar-thumb {
  border-radius: 9999px;
  background-color: rgb(199 210 254 / 0.95);
}
</style>
