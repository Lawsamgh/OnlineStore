<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { formatGhs } from "../../lib/formatMoney";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";
import {
  normalizeSignupPlanId,
  type PlanId,
} from "../../constants/planEntitlements";
import { formatGhsWhole } from "../../constants/pricingPlans";
import { usePlanPricingSettings } from "../../composables/usePlanPricingSettings";
import { planLabelFromSignupId } from "../../lib/planLabel";
import {
  PLAN_FEATURE_LIMITS,
  resolvePricingPlanId,
} from "../../lib/planFeatureLimits";
import {
  allowedThemeIdsForPlan,
  resolveThemeFont,
  resolveThemePreset,
} from "../../constants/storeThemes";
import { useRealtimeTableRefresh } from "../../composables/useRealtimeTableRefresh";
import { formatFunctionsInvokeError } from "../../lib/formatFunctionsInvokeError";
import { refreshSessionForEdgeFunctions } from "../../lib/refreshSessionForEdgeFunctions";
import { clearBodyScrollLock, setBodyScrollLocked } from "../../lib/bodyScrollLock";
import SkeletonStoreManage from "../../components/skeleton/SkeletonStoreManage.vue";
import ProductCategoryDropdown from "../../components/store/ProductCategoryDropdown.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { sessionUserId, isPlatformStaff, user, isSuperAdmin } =
  storeToRefs(auth);
const toast = useToastStore();
const { plans: pricingPlans } = usePlanPricingSettings();

const storeId = computed(() => String(route.params.storeId ?? ""));

type ManageTab = "products" | "orders" | "support";
const TAB_STORAGE_PREFIX = "uanditech:store-manage:tab:";

function normalizeManageTab(v: unknown): ManageTab {
  return v === "orders" || v === "support" ? v : "products";
}

function tabStorageKey(): string {
  const sid = storeId.value.trim();
  return `${TAB_STORAGE_PREFIX}${sid || "default"}`;
}

const tab = ref<ManageTab>("products");
const loading = ref(true);

const store = ref<{
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  theme_id: string;
  theme_primary_color: string | null;
  theme_accent_color: string | null;
  theme_bg_color: string | null;
  theme_surface_color: string | null;
  theme_text_color: string | null;
  theme_font_family: string | null;
  whatsapp_phone_e164: string | null;
  owner_id: string;
  logo_path: string | null;
} | null>(null);

const products = ref<
  {
    id: string;
    title: string;
    description: string | null;
    category_id: string | null;
    category_name: string | null;
    price_cents: number;
    is_published: boolean;
    image_paths: string[];
    created_at: string;
  }[]
>([]);

const productCategories = ref<{ id: string; name: string }[]>([]);

const orders = ref<
  {
    id: string;
    order_ref: string | null;
    status: string;
    created_at: string;
    customer_id: string | null;
    guest_name: string | null;
    guest_email: string | null;
    guest_phone: string | null;
    delivery_address: string | null;
    order_items?: {
      title_snapshot: string;
      quantity: number;
      unit_price_cents: number;
    }[];
  }[]
>([]);
const selectedOrderId = ref<string | null>(null);
const selectedOrder = computed(
  () => orders.value.find((o) => o.id === selectedOrderId.value) ?? null,
);
const orderSearch = ref("");
const orderSortMode = ref<"newest" | "status">("newest");
const ORDER_STATUS_SORT_RANK: Record<string, number> = {
  pending: 0,
  confirmed: 1,
  preparing: 2,
  out_for_delivery: 3,
  delivered: 4,
  canceled: 5,
};
const filteredOrders = computed(() => {
  const q = orderSearch.value.trim().toLowerCase();
  const searched = !q
    ? orders.value
    : orders.value.filter((ord) => {
    const hay = [
      ord.id,
      ord.order_ref ?? "",
      ord.guest_name ?? "",
      ord.guest_email ?? "",
      ord.guest_phone ?? "",
      ord.delivery_address ?? "",
      ord.status,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });

  if (orderSortMode.value === "newest") return searched;

  return [...searched].sort((a, b) => {
    const rankA = ORDER_STATUS_SORT_RANK[a.status] ?? 99;
    const rankB = ORDER_STATUS_SORT_RANK[b.status] ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return (
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  });
});
const selectedOrderItems = computed(() => {
  const raw = selectedOrder.value?.order_items;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it) => ({
      title:
        typeof it?.title_snapshot === "string" && it.title_snapshot.trim()
          ? it.title_snapshot.trim()
          : "Item",
      quantity: Number(it?.quantity) || 0,
      unitPriceCents: Number(it?.unit_price_cents) || 0,
    }))
    .filter((it) => it.quantity > 0);
});

const newTitle = ref("");
const newDesc = ref("");
/** Selected `product_categories.id` when adding a product (empty = none). */
const newCategoryId = ref("");
const newPrice = ref("");
const newPublished = ref(true);
const productBusy = ref(false);
/** While saving inline category for a product row. */
const categoryBusyId = ref<string | null>(null);
const newCategoryName = ref("");
const categoryAddBusy = ref(false);
const deleteCategoryBusyId = ref<string | null>(null);
const addProductModalOpen = ref(false);
const deleteProductTargetId = ref<string | null>(null);
const deleteProductBusy = ref(false);

type PaidStoreFeePlanId = Extract<PlanId, "starter" | "growth" | "pro">;

const storeFeePlanModalOpen = ref(false);
const selectedStoreFeePlan = ref<PaidStoreFeePlanId>("starter");

const storeFeePlanChoices = computed(() =>
  pricingPlans.value.filter((p) => p.monthlyGhs > 0),
);

const deleteProductTarget = computed(() => {
  const id = deleteProductTargetId.value;
  if (!id) return null;
  return products.value.find((p) => p.id === id) ?? null;
});

/** Products with no category (for sidebar nudge). */
const uncategorizedProductCount = computed(
  () => products.value.filter((p) => !p.category_id).length,
);

const productsPriceTotalCents = computed(() =>
  products.value.reduce((sum, p) => sum + (Number(p.price_cents) || 0), 0),
);

const productsPublishedCount = computed(
  () => products.value.filter((p) => p.is_published).length,
);

const productsDraftCount = computed(
  () => products.value.filter((p) => !p.is_published).length,
);

/** Picked cover file + object name under `product-images` (DB stores `objectName` only). */
const pendingCoverImage = ref<{ file: File; objectName: string } | null>(null);
const coverImageFileInputRef = ref<HTMLInputElement | null>(null);
const coverDropActive = ref(false);
const coverPreviewUrl = ref<string | null>(null);
const storeOwnerSignupPlan = ref<string | null>(null);

const sellerPlanId = computed(() =>
  resolvePricingPlanId(
    sellerSubscription.value?.pricing_plan_id ??
      storeOwnerSignupPlan.value ??
      user.value?.user_metadata?.signup_plan,
  ),
);

const maxProductCoverImageBytes = computed(
  () => PLAN_FEATURE_LIMITS[sellerPlanId.value].maxProductCoverImageBytes,
);

const maxProductCoverImageLabel = computed(() => {
  const b = maxProductCoverImageBytes.value;
  const mb = b / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb} MB` : `${mb.toFixed(1)} MB`;
});

const addProductImageKey = computed(() => {
  if (!store.value || !pendingCoverImage.value) return "";
  return `${store.value.id}/${pendingCoverImage.value.objectName}`;
});

const COVER_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

function extFromImageFile(file: File): string {
  const t = file.type;
  if (t === "image/png") return "png";
  if (t === "image/webp") return "webp";
  if (t === "image/gif") return "gif";
  if (t === "image/jpeg" || t === "image/jpg") return "jpg";
  const m = file.name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1]!.toLowerCase().slice(0, 8) : "jpg";
}

function randomHexSuffix(): string {
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => x.toString(16).padStart(2, "0")).join("");
}

function tryApplyCoverImageFile(file: File): boolean {
  if (!file.type.startsWith("image/")) {
    toast.error("Please choose an image file.");
    return false;
  }
  const allowed = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ]);
  if (!allowed.has(file.type)) {
    toast.error("Use JPEG, PNG, WebP, or GIF.");
    return false;
  }
  const maxB = maxProductCoverImageBytes.value;
  if (file.size > maxB) {
    toast.error(
      `This file is too large. Your plan allows up to ${maxProductCoverImageLabel.value} per cover image.`,
    );
    return false;
  }
  pendingCoverImage.value = {
    file,
    objectName: `cover-${Date.now()}-${randomHexSuffix()}.${extFromImageFile(file)}`,
  };
  return true;
}

function onAddProductCoverFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  input.value = "";
  if (!file) return;
  tryApplyCoverImageFile(file);
}

function openCoverImagePicker() {
  coverImageFileInputRef.value?.click();
}

function onCoverDragOver(ev: DragEvent) {
  ev.preventDefault();
  coverDropActive.value = true;
}

function onCoverDragLeave(ev: DragEvent) {
  const el = ev.currentTarget as HTMLElement | null;
  const rel = ev.relatedTarget as Node | null;
  if (el && rel && el.contains(rel)) return;
  coverDropActive.value = false;
}

function onCoverDrop(ev: DragEvent) {
  ev.preventDefault();
  coverDropActive.value = false;
  const file = ev.dataTransfer?.files?.[0] ?? null;
  if (file) tryApplyCoverImageFile(file);
}

watch(pendingCoverImage, () => {
  if (coverPreviewUrl.value) {
    URL.revokeObjectURL(coverPreviewUrl.value);
    coverPreviewUrl.value = null;
  }
  const p = pendingCoverImage.value;
  if (p) coverPreviewUrl.value = URL.createObjectURL(p.file);
});

function clearPendingCoverImage() {
  pendingCoverImage.value = null;
}

/**
 * Parse price from the modal field. `type="number"` often yields an empty model
 * with comma decimals or partial input; treat comma as decimal when no dot.
 */
function parseGhsInput(raw: string): number | null {
  let s = raw
    .trim()
    .replace(/[\u00a0\u200b-\u200d\ufeff]/g, "")
    .replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const canSubmitAddProduct = computed(() => {
  const price = parseGhsInput(newPrice.value);
  return (
    !!store.value &&
    !!user.value?.id &&
    newTitle.value.trim().length > 0 &&
    price !== null &&
    price >= 0 &&
    !productBusy.value
  );
});

function resetAddProductForm() {
  newTitle.value = "";
  newDesc.value = "";
  newCategoryId.value = "";
  newPrice.value = "";
  pendingCoverImage.value = null;
  newPublished.value = true;
}

function openAddProductModal() {
  if (!canUseRoleGatedStoreActions.value) {
    toast.info("Actions are unavailable until your role is set.");
    return;
  }
  resetAddProductForm();
  addProductModalOpen.value = true;
}

function closeAddProductModal() {
  addProductModalOpen.value = false;
  resetAddProductForm();
}

function onStoreManageDocKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (deleteProductTargetId.value && !deleteProductBusy.value) {
    e.preventDefault();
    closeDeleteProductDialog();
    return;
  }
  if (storeFeePlanModalOpen.value && !payBusy.value) {
    e.preventDefault();
    closeStoreFeePlanModal();
    return;
  }
  if (addProductModalOpen.value) {
    e.preventDefault();
    closeAddProductModal();
  }
}

function openDeleteProductDialog(productId: string) {
  if (!canUseRoleGatedStoreActions.value) {
    toast.info("Actions are unavailable until your role is set.");
    return;
  }
  deleteProductTargetId.value = productId;
}

function closeDeleteProductDialog() {
  if (deleteProductBusy.value) return;
  deleteProductTargetId.value = null;
}

async function confirmDeleteProduct() {
  const id = deleteProductTargetId.value;
  if (!id) return;
  deleteProductBusy.value = true;
  const supabase = getSupabaseBrowser();
  const target = deleteProductTarget.value;
  const sid = store.value?.id ?? null;
  try {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (sid && target?.image_paths?.length) {
      const keys = target.image_paths
        .map((p) => (typeof p === "string" ? p.trim() : ""))
        .filter(Boolean)
        .map((p) => (p.includes("/") ? p : `${sid}/${p}`));
      if (keys.length > 0) {
        const { error: remErr } = await supabase.storage
          .from("product-images")
          .remove(keys);
        if (remErr) {
          console.warn(
            "[confirmDeleteProduct] storage remove:",
            remErr.message,
          );
        }
      }
    }
    deleteProductTargetId.value = null;
    toast.success("Product removed.");
    void loadAll({ silent: true });
  } finally {
    deleteProductBusy.value = false;
  }
}

watch(
  [addProductModalOpen, deleteProductTargetId, storeFeePlanModalOpen],
  ([open, delId, feeOpen]) => {
    setBodyScrollLocked(
      "store-manage-overlays",
      Boolean(open || delId || feeOpen),
    );
    if (open) {
      void nextTick(() => {
        document.getElementById("modal-add-product-title")?.focus();
      });
    }
  },
);

watch(store, (s) => {
  if (!s) {
    if (addProductModalOpen.value) {
      addProductModalOpen.value = false;
      resetAddProductForm();
    }
    if (deleteProductTargetId.value) deleteProductTargetId.value = null;
    storeFeePlanModalOpen.value = false;
    clearBodyScrollLock("store-manage-overlays");
  }
});

onBeforeUnmount(() => {
  clearBodyScrollLock("store-manage-overlays");
  document.removeEventListener("keydown", onStoreManageDocKeydown);
  if (coverPreviewUrl.value) {
    URL.revokeObjectURL(coverPreviewUrl.value);
    coverPreviewUrl.value = null;
  }
});

const payBusy = ref(false);
const paystackStoreVerifyBusy = ref(false);

const sellerSubscription = ref<{
  status: string;
  current_period_end: string | null;
  pricing_plan_id: string | null;
} | null>(null);

function paystackReturnReference(): string {
  const raw = route.query.reference ?? route.query.trxref;
  const one = Array.isArray(raw) ? raw[0] : raw;
  return typeof one === "string" ? one.trim() : "";
}

/** After Paystack redirects back to this store page, verify payment and upsert `seller_subscriptions`. */
async function consumePaystackStoreReturn() {
  const reference = paystackReturnReference();
  if (!reference.startsWith("sub_")) {
    return;
  }
  if (!isSupabaseConfigured() || !sessionUserId.value || !storeId.value) {
    return;
  }
  if (paystackStoreVerifyBusy.value) {
    return;
  }

  const lockKey = `paystack_store_verify_${reference}`;
  if (sessionStorage.getItem(lockKey) === "1") {
    await router.replace({
      name: "dashboard-store",
      params: { storeId: storeId.value },
      query: {},
    });
    return;
  }

  paystackStoreVerifyBusy.value = true;
  try {
    const sb = getSupabaseBrowser();
    const prep = await refreshSessionForEdgeFunctions(sb);
    if (!prep.ok) {
      toast.error(prep.message);
      await router.replace({
        name: "dashboard-store",
        params: { storeId: storeId.value },
        query: {},
      });
      return;
    }
    auth.syncSession(prep.session);
    const { data, error } = await sb.functions.invoke(
      "paystack-verify-store-subscription",
      {
        body: { reference, store_id: storeId.value },
        headers: prep.headers,
      },
    );
    if (error) {
      const bodyErr =
        data && typeof data === "object" && "error" in data
          ? String((data as { error?: unknown }).error ?? "")
          : "";
      toast.error(
        bodyErr ||
          formatFunctionsInvokeError(
            error,
            "paystack-verify-store-subscription",
          ) ||
          "Could not verify payment.",
      );
      await router.replace({
        name: "dashboard-store",
        params: { storeId: storeId.value },
        query: {},
      });
      return;
    }
    sessionStorage.setItem(lockKey, "1");
    toast.success("Store subscription recorded.");
    await router.replace({
      name: "dashboard-store",
      params: { storeId: storeId.value },
      query: {},
    });
    const sb2 = getSupabaseBrowser();
    const { data: refData, error: refErr } = await sb2.auth.refreshSession();
    if (!refErr && refData.session) auth.syncSession(refData.session);
    else await auth.refreshSessionFromSupabase();
    await loadAll({ silent: true });
  } finally {
    paystackStoreVerifyBusy.value = false;
  }
}

watch(
  () =>
    [
      route.query.reference,
      route.query.trxref,
      storeId.value,
      sessionUserId.value,
    ] as const,
  () => {
    void consumePaystackStoreReturn();
  },
  { immediate: true },
);

function formatSubscriptionPeriodEnd(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}
const logoBusy = ref(false);
const storeStatusBusy = ref(false);
const storeStatusConfirmOpen = ref(false);
const pendingStoreActiveState = ref<boolean | null>(null);
const logoUploadInputRef = ref<HTMLInputElement | null>(null);
const themeIdInput = ref("default");
const themePrimaryInput = ref("");
const themeAccentInput = ref("");
const themeBgInput = ref("");
const themeSurfaceInput = ref("");
const themeTextInput = ref("");
const themeFontInput = ref("system");

const hasSelectedPlan = computed(
  () =>
    normalizeSignupPlanId(
      typeof user.value?.user_metadata?.signup_plan === "string"
        ? user.value.user_metadata.signup_plan
        : undefined,
    ) !== null,
);

const isStoreOwner = computed(
  () =>
    !!store.value &&
    !!sessionUserId.value &&
    store.value.owner_id === sessionUserId.value,
);
const canUseRoleGatedStoreActions = computed(() =>
  Boolean(store.value && sessionUserId.value),
);

/** Owners need a chosen plan (or super admin) before changing the shop logo. */
const canUploadStoreLogo = computed(
  () => isStoreOwner.value && (hasSelectedPlan.value || isSuperAdmin.value),
);

function normalizeDbErrorMessage(error: { message?: string } | null): string {
  return String(error?.message ?? "").trim();
}

function isSubscriptionPolicyBlockMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("row-level security policy") ||
    m.includes("store subscription expired")
  );
}

function publishBlockedMessage(): string {
  return "Subscription expired. Renew your plan to publish products. You can still save drafts.";
}

function activationBlockedMessage(): string {
  return "Subscription expired. Renew your plan to activate your store link.";
}

const allowedStoreThemeIds = computed(() =>
  allowedThemeIdsForPlan(sellerPlanId.value),
);

const storeLogoPublicUrl = computed(() => {
  if (!store.value || !isSupabaseConfigured()) return null;
  const id = store.value.id;
  const p = store.value.logo_path?.trim();
  const key = p && p.length > 0 ? p : `${id}/logo`;
  return getSupabaseBrowser().storage.from("store-logos").getPublicUrl(key).data
    .publicUrl;
});

function openStoreLogoPicker() {
  if (!canUploadStoreLogo.value) {
    if (isStoreOwner.value && !hasSelectedPlan.value && !isSuperAdmin.value) {
      toast.info(
        "Select a subscription plan on your dashboard before uploading a store logo.",
      );
    }
    return;
  }
  logoUploadInputRef.value?.click();
}

async function onStoreLogoFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  input.value = "";
  if (!file || !store.value) return;
  if (!canUploadStoreLogo.value) {
    toast.info(
      "Select a subscription plan on your dashboard before uploading a store logo.",
    );
    return;
  }
  if (!file.type.startsWith("image/")) {
    toast.error("Please choose an image file.");
    return;
  }
  const allowed = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ]);
  if (!allowed.has(file.type)) {
    toast.error("Use JPEG, PNG, WebP, or GIF.");
    return;
  }
  const maxBytes = 2 * 1024 * 1024;
  if (file.size > maxBytes) {
    toast.error("Logo must be 2 MB or smaller.");
    return;
  }
  const storagePath = `${store.value.id}/logo`;
  logoBusy.value = true;
  const supabase = getSupabaseBrowser();
  const { error: upErr } = await supabase.storage
    .from("store-logos")
    .upload(storagePath, file, { upsert: true, contentType: file.type });
  if (upErr) {
    logoBusy.value = false;
    toast.error(upErr.message);
    return;
  }
  const { error: dbErr } = await supabase
    .from("stores")
    .update({ logo_path: storagePath })
    .eq("id", store.value.id);
  logoBusy.value = false;
  if (dbErr) {
    toast.error(dbErr.message);
    return;
  }
  store.value = { ...store.value, logo_path: storagePath };
  toast.success("Store logo updated.");
}

function syncThemeInputsFromStore() {
  const s = store.value;
  if (!s) return;
  const allowed = allowedStoreThemeIds.value;
  const fallbackThemeId = resolveThemePreset(s.theme_id).id;
  const themeId = allowed.includes(fallbackThemeId as (typeof allowed)[number])
    ? fallbackThemeId
    : (allowed[0] ?? "default");
  themeIdInput.value = themeId;
  themePrimaryInput.value = s.theme_primary_color ?? "";
  themeAccentInput.value = s.theme_accent_color ?? "";
  themeBgInput.value = s.theme_bg_color ?? "";
  themeSurfaceInput.value = s.theme_surface_color ?? "";
  themeTextInput.value = s.theme_text_color ?? "";
  themeFontInput.value = resolveThemeFont(s.theme_font_family).id;
}

function openStoreLinkStatusModal() {
  if (!store.value || storeStatusBusy.value) return;
  pendingStoreActiveState.value = !store.value.is_active;
  storeStatusConfirmOpen.value = true;
}

function closeStoreLinkStatusModal() {
  if (storeStatusBusy.value) return;
  storeStatusConfirmOpen.value = false;
  pendingStoreActiveState.value = null;
}

async function confirmStoreLinkStatusChange() {
  if (
    !store.value ||
    storeStatusBusy.value ||
    pendingStoreActiveState.value == null
  )
    return;
  const nextActive = pendingStoreActiveState.value;
  storeStatusBusy.value = true;
  const supabase = getSupabaseBrowser();
  const { error } = await supabase
    .from("stores")
    .update({ is_active: nextActive })
    .eq("id", store.value.id);
  storeStatusBusy.value = false;
  if (error) {
    const msg = normalizeDbErrorMessage(error);
    if (nextActive && isSubscriptionPolicyBlockMessage(msg)) {
      toast.error(activationBlockedMessage());
    } else {
      toast.error(msg || "Could not update store status.");
    }
    return;
  }
  storeStatusConfirmOpen.value = false;
  pendingStoreActiveState.value = null;
  store.value = { ...store.value, is_active: nextActive };
  toast.success(nextActive ? "Store link activated." : "Store link paused.");
  if (nextActive && tab.value === "orders") {
    await loadAll({ silent: true });
  }
}

const tickets = ref<
  {
    id: string;
    subject: string;
    message: string;
    status: string;
    created_at: string;
  }[]
>([]);
const ticketSubject = ref("");
const ticketMessage = ref("");
const ticketBusy = ref(false);
const supportTicketModalOpen = ref(false);
const storeAdmins = ref<
  {
    user_id: string;
    role: "owner" | "admin";
    display_name: string | null;
    email: string | null;
    created_at: string | null;
  }[]
>([]);

async function loadStoreAdmins(targetStoreId?: string) {
  void targetStoreId;
  if (!store.value) {
    storeAdmins.value = [];
    return;
  }
  storeAdmins.value = [
    {
      user_id: store.value.owner_id,
      role: "owner",
      display_name: null,
      email: null,
      created_at: null,
    },
  ];
}

function openSupportTicketModal() {
  supportTicketModalOpen.value = true;
}

function closeSupportTicketModal() {
  if (ticketBusy.value) return;
  supportTicketModalOpen.value = false;
}

const ticketsOpenCount = computed(
  () =>
    tickets.value.filter((t) => (t.status || "").toLowerCase() === "open")
      .length,
);

const ticketsClosedCount = computed(
  () =>
    tickets.value.filter((t) => (t.status || "").toLowerCase() === "closed")
      .length,
);

function ticketStatusBadgeClass(status: string): string {
  const s = (status || "").toLowerCase();
  const base =
    "inline-flex shrink-0 items-center justify-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize tabular-nums ring-1";
  if (s === "open") {
    return `${base} bg-amber-50 text-amber-950 ring-amber-200/85`;
  }
  if (s === "closed") {
    return `${base} bg-zinc-100 text-zinc-700 ring-zinc-200/80`;
  }
  return `${base} bg-violet-50 text-violet-900 ring-violet-200/80`;
}

function formatOrderListDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function formatOrderMasterDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfTarget = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
  ).getTime();
  const dayDiff = Math.round((startOfToday - startOfTarget) / 86_400_000);
  const timeLabel = new Intl.DateTimeFormat(undefined, {
    timeStyle: "short",
  }).format(d);
  if (dayDiff === 0) return `Today, ${timeLabel}`;
  if (dayDiff === 1) return `Yesterday, ${timeLabel}`;
  if (dayDiff > 1 && dayDiff < 7) {
    const weekday = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
    }).format(d);
    return `${weekday}, ${timeLabel}`;
  }
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(d);
  return `${dateLabel}, ${timeLabel}`;
}

function orderShortId(id: string): string {
  const t = id.replace(/-/g, "");
  return t.length >= 10 ? `${t.slice(0, 6)}…${t.slice(-4)}` : id;
}

function orderDisplayRef(ord: (typeof orders.value)[0]): string {
  const ref = ord.order_ref?.trim();
  if (ref) return ref;
  return orderShortId(ord.id);
}

function orderTotalCents(ord: (typeof orders.value)[0]): number {
  const items = Array.isArray(ord.order_items) ? ord.order_items : [];
  return items.reduce((sum, item) => {
    const qty = Number(item?.quantity) || 0;
    const unit = Number(item?.unit_price_cents) || 0;
    return sum + qty * unit;
  }, 0);
}

/** DD/MM/YYYY for product table "Listed" column. */
function formatProductTableDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function orderStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

const ALLOWED_ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "canceled"],
  confirmed: ["preparing", "canceled"],
  preparing: ["out_for_delivery", "canceled"],
  out_for_delivery: ["delivered", "canceled"],
  delivered: [],
  canceled: [],
};

function nextOrderProgressStatus(status: string): string | null {
  const allowed = ALLOWED_ORDER_STATUS_TRANSITIONS[status] ?? [];
  return allowed.find((s) => s !== "canceled") ?? null;
}

function canCancelOrderStatus(status: string): boolean {
  return (ALLOWED_ORDER_STATUS_TRANSITIONS[status] ?? []).includes("canceled");
}

function orderProgressActionLabel(status: string): string {
  const next = nextOrderProgressStatus(status);
  if (!next) {
    if (status === "canceled") return "Order canceled";
    if (status === "delivered") return "Delivered";
    return "No further action";
  }
  if (next === "confirmed") return "Confirm order";
  if (next === "preparing") return "Start preparing";
  if (next === "out_for_delivery") return "Send out for delivery";
  if (next === "delivered") return "Mark delivered";
  return `Move to ${orderStatusLabel(next)}`;
}

function orderCustomerTitle(ord: (typeof orders.value)[0]): string {
  const guest = ord.guest_name?.trim();
  if (guest) return guest;
  if (ord.customer_id) return "Customer checkout";
  return "Guest checkout";
}

function orderCustomerInitials(ord: (typeof orders.value)[0]): string {
  const raw = orderCustomerTitle(ord).trim();
  if (!raw) return "GC";
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return "GC";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[1]?.[0] ?? "") : "";
  const initials = `${first}${second}`.toUpperCase();
  return initials || "GC";
}

/** Public URL for first product image in `product-images` (same key shape as storefront). */
function productCoverPublicUrl(path: string | undefined): string | null {
  if (!path?.trim() || !store.value?.id || !isSupabaseConfigured()) return null;
  const p = path.trim();
  if (p.startsWith("http")) return p;
  return getSupabaseBrowser()
    .storage.from("product-images")
    .getPublicUrl(`${store.value.id}/${p}`).data.publicUrl;
}

async function loadAll(opts?: { silent?: boolean }) {
  const silent = opts?.silent ?? false;
  if (!silent) {
    loading.value = true;
    store.value = null;
    storeOwnerSignupPlan.value = null;
    sellerSubscription.value = null;
    productCategories.value = [];
    storeAdmins.value = [];
  }
  if (!isSupabaseConfigured() || !sessionUserId.value || !storeId.value) {
    if (!silent) loading.value = false;
    return;
  }
  const supabase = getSupabaseBrowser();
  try {
    const { data: s, error: se } = await supabase
      .from("stores")
      .select(
        "id, slug, name, is_active, theme_id, theme_primary_color, theme_accent_color, theme_bg_color, theme_surface_color, theme_text_color, theme_font_family, whatsapp_phone_e164, owner_id, logo_path, profiles!stores_owner_id_fkey(signup_plan)",
      )
      .eq("id", storeId.value)
      .maybeSingle();
    if (se || !s) {
      toast.error(se?.message ?? "Store not found.");
      if (!silent) store.value = null;
      storeOwnerSignupPlan.value = null;
      productCategories.value = [];
      return;
    }
    if (s.owner_id !== sessionUserId.value && !isPlatformStaff.value) {
      const { data: canManage, error: canManageErr } = await supabase.rpc(
        "auth_is_store_admin",
        { p_store_id: s.id },
      );
      if (canManageErr || !canManage) {
        toast.error("You do not manage this store.");
        store.value = null;
        storeOwnerSignupPlan.value = null;
        productCategories.value = [];
        return;
      }
    }
    store.value = {
      id: s.id,
      slug: s.slug,
      name: s.name,
      is_active: Boolean(s.is_active),
      theme_id:
        typeof s.theme_id === "string" && s.theme_id.trim()
          ? s.theme_id.trim()
          : "default",
      theme_primary_color:
        typeof s.theme_primary_color === "string" &&
        s.theme_primary_color.trim()
          ? s.theme_primary_color.trim()
          : null,
      theme_accent_color:
        typeof s.theme_accent_color === "string" && s.theme_accent_color.trim()
          ? s.theme_accent_color.trim()
          : null,
      theme_bg_color:
        typeof s.theme_bg_color === "string" && s.theme_bg_color.trim()
          ? s.theme_bg_color.trim()
          : null,
      theme_surface_color:
        typeof s.theme_surface_color === "string" &&
        s.theme_surface_color.trim()
          ? s.theme_surface_color.trim()
          : null,
      theme_text_color:
        typeof s.theme_text_color === "string" && s.theme_text_color.trim()
          ? s.theme_text_color.trim()
          : null,
      theme_font_family:
        typeof s.theme_font_family === "string" && s.theme_font_family.trim()
          ? s.theme_font_family.trim()
          : null,
      whatsapp_phone_e164: s.whatsapp_phone_e164,
      owner_id: s.owner_id,
      logo_path: s.logo_path?.trim() || null,
    };
    syncThemeInputsFromStore();
    storeOwnerSignupPlan.value =
      (s as { profiles?: { signup_plan?: string | null } | null }).profiles
        ?.signup_plan ?? null;

    const { data: subRow } = await supabase
      .from("seller_subscriptions")
      .select("status, current_period_end, pricing_plan_id")
      .eq("store_id", s.id)
      .maybeSingle();
    sellerSubscription.value = subRow
      ? {
          status: String(subRow.status ?? "inactive"),
          current_period_end:
            typeof subRow.current_period_end === "string"
              ? subRow.current_period_end
              : null,
          pricing_plan_id:
            typeof subRow.pricing_plan_id === "string" &&
            subRow.pricing_plan_id.trim()
              ? subRow.pricing_plan_id.trim()
              : null,
        }
      : null;

    const [{ data: catRows, error: catErr }, { data: p, error: pErr }] =
      await Promise.all([
        supabase
          .from("product_categories")
          .select("id, name")
          .eq("store_id", s.id)
          .order("name", { ascending: true }),
        supabase
          .from("products")
          .select(
            "id, title, description, price_cents, is_published, image_paths, category_id, created_at, product_categories ( name )",
          )
          .eq("store_id", s.id)
          .order("created_at", { ascending: false }),
      ]);
    if (catErr) toast.error(catErr.message);
    productCategories.value = (catRows ?? [])
      .map((row) => {
        const r = row as { id?: unknown; name?: unknown };
        const name = typeof r.name === "string" ? r.name.trim() : "";
        if (!name) return null;
        return { id: String(r.id), name };
      })
      .filter((x): x is { id: string; name: string } => x !== null);
    if (pErr) toast.error(pErr.message);
    products.value = (p ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const rel = r.product_categories as { name?: string } | null | undefined;
      const categoryName =
        rel &&
        typeof rel === "object" &&
        typeof rel.name === "string" &&
        rel.name.trim()
          ? rel.name.trim()
          : null;
      const categoryId =
        typeof r.category_id === "string" && r.category_id.trim()
          ? r.category_id.trim()
          : null;
      const createdAt =
        typeof r.created_at === "string" && r.created_at.trim()
          ? r.created_at.trim()
          : "";
      return {
        id: String(r.id),
        title: String(r.title),
        description:
          typeof r.description === "string" && r.description.trim()
            ? r.description.trim()
            : null,
        category_id: categoryId,
        category_name: categoryName,
        price_cents: Number(r.price_cents) || 0,
        is_published: Boolean(r.is_published),
        image_paths: Array.isArray(r.image_paths)
          ? (r.image_paths as string[])
          : [],
        created_at: createdAt,
      };
    });

    const { data: o } = await supabase
      .from("orders")
      .select(
        "id, order_ref, status, created_at, guest_name, guest_email, guest_phone, delivery_address, customer_id, order_items(title_snapshot, quantity, unit_price_cents)",
      )
      .eq("store_id", s.id)
      .order("created_at", { ascending: false })
      .limit(50);
    orders.value = (o ?? []) as typeof orders.value;
    if (!orders.value.length) {
      selectedOrderId.value = null;
    } else if (
      !selectedOrderId.value ||
      !orders.value.some((ord) => ord.id === selectedOrderId.value)
    ) {
      selectedOrderId.value = orders.value[0]!.id;
    }

    const { data: tk } = await supabase
      .from("support_tickets")
      .select("id, subject, message, status, created_at")
      .eq("store_id", s.id)
      .order("created_at", { ascending: false })
      .limit(30);
    tickets.value = (tk ?? []) as typeof tickets.value;
    await loadStoreAdmins(s.id);
  } finally {
    if (!silent) loading.value = false;
  }
}

onMounted(() => {
  tab.value = normalizeManageTab(localStorage.getItem(tabStorageKey()));
  document.addEventListener("keydown", onStoreManageDocKeydown);
  void loadAll();
});
watch(storeId, () => {
  tab.value = normalizeManageTab(localStorage.getItem(tabStorageKey()));
  void loadAll();
});
watch(sellerPlanId, () => {
  syncThemeInputsFromStore();
});
watch(
  () => route.query.panel,
  async (panel) => {
    if (panel !== "theme") return;
    await nextTick();
    document.getElementById("store-theme-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  },
  { immediate: true },
);
watch(tab, (next) => {
  localStorage.setItem(tabStorageKey(), next);
});

useRealtimeTableRefresh({
  channelName: () => `store-manage-${storeId.value}`,
  deps: [storeId, sessionUserId, isPlatformStaff],
  getTables: () => {
    const id = storeId.value;
    if (!id) return [];
    return [
      { table: "stores", filter: `id=eq.${id}` },
      { table: "store_admins", filter: `store_id=eq.${id}` },
      { table: "products", filter: `store_id=eq.${id}` },
      { table: "product_categories", filter: `store_id=eq.${id}` },
      { table: "orders", filter: `store_id=eq.${id}` },
      { table: "support_tickets", filter: `store_id=eq.${id}` },
      { table: "seller_subscriptions", filter: `store_id=eq.${id}` },
    ];
  },
  onEvent: () => loadAll({ silent: true }),
});

async function addProduct() {
  if (!canUseRoleGatedStoreActions.value) {
    toast.info("Actions are unavailable until your role is set.");
    return;
  }
  if (!store.value || !sessionUserId.value) return;
  const price = parseGhsInput(newPrice.value);
  if (!newTitle.value.trim() || price === null || price < 0) {
    toast.error("Enter title and a valid price (GHS).");
    return;
  }
  const cents = Math.round(price * 100);
  productBusy.value = true;
  try {
    const supabase = getSupabaseBrowser();
    let paths: string[] = [];
    if (pendingCoverImage.value && store.value) {
      const { file, objectName } = pendingCoverImage.value;
      if (file.size > maxProductCoverImageBytes.value) {
        toast.error(
          `Image exceeds your plan limit (${maxProductCoverImageLabel.value}). Choose a smaller file.`,
        );
        return;
      }
      const storagePath = `${store.value.id}/${objectName}`;
      const { error: upErr } = await supabase.storage
        .from("product-images")
        .upload(storagePath, file, {
          upsert: false,
          contentType: file.type || "image/jpeg",
        });
      if (upErr) {
        toast.error(upErr.message);
        return;
      }
      paths = [objectName];
    }
    const cid =
      typeof newCategoryId.value === "string" && newCategoryId.value.trim()
        ? newCategoryId.value.trim()
        : null;
    const { error } = await supabase.from("products").insert({
      store_id: store.value.id,
      title: newTitle.value.trim(),
      description: newDesc.value.trim() || null,
      category_id: cid,
      price_cents: cents,
      image_paths: paths,
      is_published: newPublished.value,
    });
    if (error) {
      const msg = normalizeDbErrorMessage(error);
      if (newPublished.value && isSubscriptionPolicyBlockMessage(msg)) {
        toast.error(publishBlockedMessage());
      } else {
        toast.error(msg || "Could not add product.");
      }
      return;
    }
    closeAddProductModal();
    toast.success("Product added.");
    void loadAll({ silent: true });
  } finally {
    productBusy.value = false;
  }
}

async function togglePublish(p: (typeof products.value)[0]) {
  if (!canUseRoleGatedStoreActions.value) {
    toast.info("Actions are unavailable until your role is set.");
    return;
  }
  const supabase = getSupabaseBrowser();
  const nextPublished = !p.is_published;
  const { error } = await supabase
    .from("products")
    .update({ is_published: nextPublished })
    .eq("id", p.id);
  if (error) {
    const msg = normalizeDbErrorMessage(error);
    if (nextPublished && isSubscriptionPolicyBlockMessage(msg)) {
      toast.error(publishBlockedMessage());
      return;
    }
    toast.error(msg || "Could not update product status.");
  } else {
    p.is_published = nextPublished;
    toast.success(
      nextPublished ? "Product published." : "Product unpublished.",
    );
    // Silent reload: no full-page skeleton (unlike `loadAll()`). Realtime also
    // triggers the same once `products` is in `supabase_realtime` (migration).
    void loadAll({ silent: true });
  }
}

async function saveProductCategoryId(
  p: (typeof products.value)[0],
  categoryId: string | null,
) {
  if (!canUseRoleGatedStoreActions.value) {
    toast.info("Actions are unavailable until your role is set.");
    return;
  }
  const next =
    typeof categoryId === "string" && categoryId.trim()
      ? categoryId.trim()
      : null;
  if (next === p.category_id) return;
  categoryBusyId.value = p.id;
  const supabase = getSupabaseBrowser();
  const { error } = await supabase
    .from("products")
    .update({ category_id: next })
    .eq("id", p.id);
  categoryBusyId.value = null;
  if (error) {
    toast.error(error.message);
    await loadAll({ silent: true });
    return;
  }
  p.category_id = next;
  p.category_name =
    productCategories.value.find((c) => c.id === next)?.name ?? null;
}

async function addStoreCategory() {
  if (!canUseRoleGatedStoreActions.value) {
    toast.info("Actions are unavailable until your role is set.");
    return;
  }
  if (!store.value) return;
  const name = newCategoryName.value.trim();
  if (!name) {
    toast.info("Enter a category name.");
    return;
  }
  categoryAddBusy.value = true;
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.from("product_categories").insert({
    store_id: store.value.id,
    name,
  });
  categoryAddBusy.value = false;
  if (error) {
    toast.error(error.message);
    return;
  }
  newCategoryName.value = "";
  toast.success("Category added.");
  await loadAll({ silent: true });
}

async function deleteStoreCategory(categoryId: string) {
  if (!canUseRoleGatedStoreActions.value) {
    toast.info("Actions are unavailable until your role is set.");
    return;
  }
  if (deleteCategoryBusyId.value) return;
  const cat = productCategories.value.find((c) => c.id === categoryId);
  const label = cat?.name?.trim() || "this category";
  const ok = window.confirm(
    `Remove “${label}”? Any products using it will have no category selected.`,
  );
  if (!ok) return;
  deleteCategoryBusyId.value = categoryId;
  const supabase = getSupabaseBrowser();
  const { error } = await supabase
    .from("product_categories")
    .delete()
    .eq("id", categoryId);
  deleteCategoryBusyId.value = null;
  if (error) {
    toast.error(error.message);
    return;
  }
  toast.success("Category removed.");
  await loadAll({ silent: true });
}

async function setOrderStatus(orderId: string, status: string) {
  const current = selectedOrder.value?.status;
  if (current && current === status) return;
  const supabase = getSupabaseBrowser();
  const { error } = await supabase
    .from("orders")
    .update({ status })
    .eq("id", orderId);
  if (error) toast.error(error.message);
  else {
    toast.success("Order status updated.");
    const { data: notifyData, error: notifyErr } =
      await supabase.functions.invoke("notify-order-status", {
        body: { order_id: orderId, status },
      });
    if (notifyErr) {
      toast.info(
        `Status updated, but customer notification may have failed: ${formatFunctionsInvokeError(
          notifyErr,
          "notify-order-status",
        )}`,
      );
    } else if (notifyData && typeof notifyData === "object") {
      if ("error" in notifyData && typeof notifyData.error === "string") {
        toast.info(`Status updated. Notification issue: ${notifyData.error}`);
      } else if (
        "warnings" in notifyData &&
        Array.isArray(notifyData.warnings) &&
        notifyData.warnings.length
      ) {
        const first = notifyData.warnings.find(
          (x: unknown): x is string =>
            typeof x === "string" && x.trim().length > 0,
        );
        if (first) {
          toast.info(`Status updated. Notification note: ${first}`);
        }
      }
    }
    void loadAll({ silent: true });
  }
}

function onCancelSelectedOrder() {
  const ord = selectedOrder.value;
  if (!ord || !canCancelOrderStatus(ord.status)) return;
  cancelOrderConfirmOpen.value = true;
}

const cancelOrderConfirmOpen = ref(false);

function closeCancelOrderModal() {
  cancelOrderConfirmOpen.value = false;
}

function confirmCancelSelectedOrder() {
  const ord = selectedOrder.value;
  if (!ord || !canCancelOrderStatus(ord.status)) {
    cancelOrderConfirmOpen.value = false;
    return;
  }
  cancelOrderConfirmOpen.value = false;
  void setOrderStatus(ord.id, "canceled");
}

async function submitSupportTicket() {
  if (!store.value || !sessionUserId.value) return;
  if (!ticketSubject.value.trim() || !ticketMessage.value.trim()) {
    toast.info("Add a subject and a short description.");
    return;
  }
  ticketBusy.value = true;
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.from("support_tickets").insert({
    store_id: store.value.id,
    author_id: sessionUserId.value,
    subject: ticketSubject.value.trim(),
    message: ticketMessage.value.trim(),
    status: "open",
  });
  ticketBusy.value = false;
  if (error) toast.error(error.message);
  else {
    ticketSubject.value = "";
    ticketMessage.value = "";
    supportTicketModalOpen.value = false;
    toast.success("Support ticket sent.");
    void loadAll({ silent: true });
  }
}

function closeStoreFeePlanModal() {
  if (payBusy.value) return;
  storeFeePlanModalOpen.value = false;
}

async function confirmStoreFeePlanAndPay() {
  if (!store.value || payBusy.value) return;
  const planId = selectedStoreFeePlan.value;
  storeFeePlanModalOpen.value = false;
  await startPaystackWithPlan(planId);
}

async function startPaystackWithPlan(planId: PaidStoreFeePlanId) {
  if (!store.value) return;
  payBusy.value = true;
  const supabase = getSupabaseBrowser();
  const prep = await refreshSessionForEdgeFunctions(supabase);
  if (!prep.ok) {
    payBusy.value = false;
    toast.error(prep.message);
    return;
  }
  auth.syncSession(prep.session);
  const { data, error } = await supabase.functions.invoke("paystack-init", {
    body: { store_id: store.value.id, plan_id: planId },
    headers: prep.headers,
  });
  payBusy.value = false;
  if (error) {
    toast.error(formatFunctionsInvokeError(error, "paystack-init"));
    return;
  }
  const url =
    data && typeof data === "object" && "authorization_url" in data
      ? String((data as { authorization_url: string }).authorization_url)
      : null;
  if (url) window.location.href = url;
  else toast.error("No checkout URL returned. Configure Paystack secrets.");
}
</script>

<template>
  <div class="space-y-6">
    <SkeletonStoreManage v-if="loading" />
    <p v-else-if="!store" class="text-sm font-medium text-zinc-600">
      This store could not be loaded. Check the link or your account access.
    </p>
    <template v-else-if="store">
      <header
        class="rounded-3xl border border-white/60 bg-white/70 p-6 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.15)] backdrop-blur-xl sm:p-8"
      >
        <div
          class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
        >
          <div class="flex min-w-0 flex-1 items-start gap-4 sm:items-center">
            <div class="relative shrink-0">
              <input
                ref="logoUploadInputRef"
                type="file"
                class="sr-only"
                accept="image/jpeg,image/png,image/webp,image/gif"
                :disabled="!canUploadStoreLogo || logoBusy"
                @change="onStoreLogoFileChange"
              />
              <button
                type="button"
                class="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-zinc-200/90 bg-zinc-50 text-xl font-bold text-zinc-400 shadow-inner transition sm:h-[4.5rem] sm:w-[4.5rem]"
                :class="
                  canUploadStoreLogo
                    ? 'cursor-pointer ring-2 ring-transparent hover:border-teal-300/80 hover:ring-teal-400/25'
                    : 'cursor-default'
                "
                :disabled="logoBusy"
                :aria-label="
                  canUploadStoreLogo
                    ? 'Change store logo'
                    : `Logo for ${store.name}`
                "
                @click="openStoreLogoPicker"
              >
                <img
                  v-if="storeLogoPublicUrl"
                  :src="storeLogoPublicUrl"
                  alt=""
                  class="h-full w-full object-cover"
                  @error="
                    ($event.target as HTMLImageElement).style.display = 'none'
                  "
                />
                <span v-else aria-hidden="true">{{
                  store.name.slice(0, 1).toUpperCase()
                }}</span>
                <span
                  v-if="logoBusy"
                  class="absolute inset-0 flex items-center justify-center bg-white/70 text-[10px] font-bold uppercase tracking-wide text-zinc-600"
                  >…</span
                >
              </button>
              <p
                v-if="canUploadStoreLogo"
                class="mt-1.5 max-w-[5.5rem] text-center text-[10px] font-medium leading-tight text-zinc-500"
              >
                Tap to upload
              </p>
            </div>
            <div class="min-w-0 flex-1">
              <h1
                class="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl"
              >
                {{ store.name }}
              </h1>
              <p
                v-if="canUseRoleGatedStoreActions"
                class="mt-2 text-sm text-zinc-600"
              >
                Public shop
                <RouterLink
                  :to="`/${store.slug}`"
                  class="font-semibold text-teal-700 hover:text-teal-900"
                  >/{{ store.slug }}</RouterLink
                >
                <span
                  class="ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  :class="
                    store.is_active
                      ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300/50'
                      : 'bg-zinc-200/80 text-zinc-700 ring-1 ring-zinc-300/40'
                  "
                >
                  {{ store.is_active ? "Live" : "Paused" }}
                </span>
              </p>
              <p
                v-if="isStoreOwner && !hasSelectedPlan && !isSuperAdmin"
                class="mt-2 text-xs font-medium leading-snug text-amber-900/90"
              >
                Choose a plan on the dashboard to upload a shop logo.
              </p>
            </div>
          </div>
          <div class="flex shrink-0 flex-col items-end gap-2">
            <button
              v-if="canUseRoleGatedStoreActions"
              type="button"
              class="rounded-full border px-4 py-2 text-xs font-semibold shadow-sm transition disabled:opacity-50"
              :class="
                store.is_active
                  ? 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-100/70'
              "
              :disabled="storeStatusBusy"
              @click="openStoreLinkStatusModal"
            >
              {{
                storeStatusBusy
                  ? "Saving..."
                  : store.is_active
                    ? "Pause store link"
                    : "Activate store link"
              }}
            </button>
            <p
              v-if="
                sellerSubscription?.status === 'active' &&
                sellerSubscription.current_period_end
              "
              class="max-w-[14rem] text-right text-xs font-medium leading-snug text-emerald-800"
            >
              <span v-if="sellerSubscription.pricing_plan_id">
                {{ planLabelFromSignupId(sellerSubscription.pricing_plan_id) }}
                —
              </span>
              Platform fee active until
              {{
                formatSubscriptionPeriodEnd(
                  sellerSubscription.current_period_end,
                )
              }}
            </p>
          </div>
        </div>
      </header>

      <div
        class="inline-flex flex-wrap gap-1 rounded-full border border-white/50 bg-white/50 p-1 shadow-inner backdrop-blur-md"
      >
        <button
          type="button"
          class="rounded-full px-4 py-2 text-sm font-semibold transition-all"
          :class="
            tab === 'products'
              ? 'bg-zinc-900 text-white shadow-md'
              : 'text-zinc-600 hover:bg-white/80 hover:text-zinc-900'
          "
          @click="tab = 'products'"
        >
          Products
        </button>
        <button
          type="button"
          class="rounded-full px-4 py-2 text-sm font-semibold transition-all"
          :class="
            tab === 'orders'
              ? 'bg-zinc-900 text-white shadow-md'
              : 'text-zinc-600 hover:bg-white/80 hover:text-zinc-900'
          "
          @click="tab = 'orders'"
        >
          Orders & delivery
        </button>
        <button
          type="button"
          class="rounded-full px-4 py-2 text-sm font-semibold transition-all"
          :class="
            tab === 'support'
              ? 'bg-zinc-900 text-white shadow-md'
              : 'text-zinc-600 hover:bg-white/80 hover:text-zinc-900'
          "
          @click="tab = 'support'"
        >
          Support
        </button>
      </div>

      <section v-show="tab === 'products'" class="space-y-6">
        <div
          class="flex flex-col gap-4 rounded-3xl border border-white/60 bg-white/70 px-5 py-4 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.12)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:px-6"
        >
          <div class="min-w-0">
            <h2 class="text-lg font-bold tracking-tight text-zinc-900">
              Catalog
            </h2>
            <p class="mt-1 text-sm text-zinc-600">
              Products on your public shop when published. Add new items from
              the dialog.
            </p>
          </div>
          <button
            v-if="canUseRoleGatedStoreActions"
            type="button"
            class="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-zinc-900/15 transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40"
            :disabled="!store"
            @click="openAddProductModal"
          >
            <span class="text-lg leading-none" aria-hidden="true">+</span>
            Add product
          </button>
        </div>

        <div
          class="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-zinc-200/70 bg-white/95 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.16)] ring-1 ring-zinc-100/80 xl:grid xl:grid-cols-[minmax(0,60%)_minmax(0,40%)] xl:items-start xl:gap-0"
        >
          <div
            class="flex max-h-[55dvh] min-h-0 min-w-0 w-full flex-col overflow-hidden border-b border-zinc-200/80 bg-white/95 xl:max-h-[65dvh] xl:border-b-0 xl:border-r xl:border-zinc-200/80"
          >
            <div
              class="flex shrink-0 flex-col gap-2 border-b border-zinc-100 bg-gradient-to-r from-zinc-50/95 to-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
            >
              <div class="min-w-0">
                <h3 class="text-sm font-bold tracking-tight text-zinc-900">
                  Product list
                </h3>
                <p
                  class="mt-0.5 text-[11px] font-medium leading-snug text-zinc-500"
                >
                  Listed date, category, price, and status — labels stay on the
                  right panel.
                </p>
              </div>
              <span
                class="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-zinc-900/[0.06] px-2.5 py-1 text-[11px] font-bold tabular-nums text-zinc-700 ring-1 ring-zinc-200/80 sm:self-auto"
              >
                <span class="text-zinc-500">Items</span>
                {{ products.length }}
              </span>
            </div>
            <div
              class="hidden shrink-0 grid-cols-[minmax(0,0.82fr)_9.25rem_4.5rem_5rem_3.75rem_5.75rem] gap-x-4 gap-y-1 border-b border-zinc-200 bg-zinc-100/90 px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500 lg:grid"
            >
              <span class="text-left">Name</span>
              <span class="text-left">Category</span>
              <span class="text-left">Listed</span>
              <span class="text-right">Price</span>
              <span class="text-center">Status</span>
              <span class="justify-self-end text-right">Action</span>
            </div>
            <template v-if="products.length">
              <ul
                class="min-h-0 flex-1 overflow-x-auto overflow-y-auto overscroll-y-contain"
              >
                <li
                  v-for="p in products"
                  :key="p.id"
                  class="border-b border-zinc-100 transition-colors last:border-b-0 hover:bg-zinc-50/80 motion-safe:duration-150"
                >
                  <!-- Mobile: card-style row -->
                  <div class="space-y-3 p-4 lg:hidden">
                    <div class="flex gap-3">
                      <div
                        class="flex h-[3.25rem] w-[3.25rem] shrink-0 overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-100 shadow-inner"
                      >
                        <img
                          v-if="productCoverPublicUrl(p.image_paths?.[0])"
                          :src="productCoverPublicUrl(p.image_paths[0])!"
                          alt=""
                          class="h-full w-full object-cover"
                          loading="lazy"
                          @error="
                            ($event.target as HTMLImageElement).style.display =
                              'none'
                          "
                        />
                        <div
                          v-else
                          class="flex h-full w-full items-center justify-center text-zinc-300"
                          aria-hidden="true"
                        >
                          <svg
                            class="h-6 w-6 opacity-60"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                          >
                            <rect
                              x="3"
                              y="3"
                              width="18"
                              height="18"
                              rx="2"
                              ry="2"
                            />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <path
                              d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"
                            />
                          </svg>
                        </div>
                      </div>
                      <div class="min-w-0 flex-1">
                        <p
                          class="text-[0.9375rem] font-semibold leading-snug tracking-tight text-zinc-900"
                        >
                          {{ p.title }}
                        </p>
                        <p
                          v-if="p.description"
                          class="mt-0.5 line-clamp-2 text-xs leading-relaxed text-zinc-600"
                        >
                          {{ p.description }}
                        </p>
                        <p
                          class="mt-1.5 text-[11px] font-medium tabular-nums text-zinc-500"
                        >
                          Listed {{ formatProductTableDate(p.created_at) }}
                        </p>
                      </div>
                    </div>
                    <div class="min-w-0">
                      <span
                        class="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500"
                      >
                        Category
                      </span>
                      <ProductCategoryDropdown
                        :category-id="p.category_id"
                        :categories="productCategories"
                        :pending="categoryBusyId === p.id"
                        size="md"
                        @pick="(v) => saveProductCategoryId(p, v)"
                      />
                    </div>
                    <div
                      class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100/90 pt-3"
                    >
                      <p class="text-sm font-bold tabular-nums text-zinc-900">
                        {{ formatGhs(p.price_cents) }}
                      </p>
                      <span
                        class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                        :class="
                          p.is_published
                            ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80'
                            : 'bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200/80'
                        "
                      >
                        {{ p.is_published ? "Live" : "Draft" }}
                      </span>
                      <div class="ml-auto flex items-center gap-1.5">
                        <button
                          type="button"
                          class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200/90 bg-white text-zinc-600 shadow-sm outline-none transition hover:border-teal-300 hover:bg-teal-50/90 hover:text-teal-800 focus-visible:ring-2 focus-visible:ring-teal-500/30"
                          :aria-label="
                            p.is_published
                              ? 'Unpublish product'
                              : 'Publish product'
                          "
                          @click="togglePublish(p)"
                        >
                          <svg
                            v-if="p.is_published"
                            class="h-[1.125rem] w-[1.125rem]"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.75"
                            aria-hidden="true"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z"
                            />
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              d="M10.5 9.75v4.5m3-2.25h-4.5"
                            />
                          </svg>
                          <svg
                            v-else
                            class="h-[1.125rem] w-[1.125rem]"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.75"
                            aria-hidden="true"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200/90 bg-white text-rose-600 shadow-sm outline-none transition hover:border-rose-300 hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-500/25"
                          aria-label="Delete product"
                          @click="openDeleteProductDialog(p.id)"
                        >
                          <svg
                            class="h-[1.125rem] w-[1.125rem]"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.75"
                            aria-hidden="true"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- Desktop: wide table row -->
                  <div
                    class="hidden min-w-[36rem] grid-cols-[minmax(0,0.82fr)_9.25rem_4.5rem_5rem_3.75rem_5.75rem] gap-x-4 gap-y-1 px-4 py-4 lg:grid lg:items-center"
                  >
                    <div class="flex min-w-0 items-center gap-3">
                      <div
                        class="flex h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-zinc-200/80 bg-zinc-100 shadow-inner"
                      >
                        <img
                          v-if="productCoverPublicUrl(p.image_paths?.[0])"
                          :src="productCoverPublicUrl(p.image_paths[0])!"
                          alt=""
                          class="h-full w-full object-cover"
                          loading="lazy"
                          @error="
                            ($event.target as HTMLImageElement).style.display =
                              'none'
                          "
                        />
                        <div
                          v-else
                          class="flex h-full w-full items-center justify-center text-zinc-300"
                          aria-hidden="true"
                        >
                          <svg
                            class="h-5 w-5 opacity-60"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                          >
                            <rect
                              x="3"
                              y="3"
                              width="18"
                              height="18"
                              rx="2"
                              ry="2"
                            />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <path
                              d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"
                            />
                          </svg>
                        </div>
                      </div>
                      <div class="min-w-0">
                        <p
                          class="truncate text-sm font-semibold tracking-tight text-zinc-900"
                        >
                          {{ p.title }}
                        </p>
                        <p
                          v-if="p.description"
                          class="mt-0.5 line-clamp-1 text-xs leading-snug text-zinc-500"
                        >
                          {{ p.description }}
                        </p>
                      </div>
                    </div>
                    <div class="min-w-0 max-w-[10.25rem] justify-self-stretch">
                      <span class="sr-only">Category</span>
                      <ProductCategoryDropdown
                        :category-id="p.category_id"
                        :categories="productCategories"
                        :pending="categoryBusyId === p.id"
                        size="sm"
                        @pick="(v) => saveProductCategoryId(p, v)"
                      />
                    </div>
                    <p class="text-xs tabular-nums text-zinc-600">
                      {{ formatProductTableDate(p.created_at) }}
                    </p>
                    <p
                      class="text-right text-sm font-semibold tabular-nums text-zinc-900"
                    >
                      {{ formatGhs(p.price_cents) }}
                    </p>
                    <div class="flex justify-center">
                      <span
                        class="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        :class="
                          p.is_published
                            ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80'
                            : 'bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200/80'
                        "
                      >
                        {{ p.is_published ? "Live" : "Draft" }}
                      </span>
                    </div>
                    <div class="justify-self-end flex justify-end gap-1">
                      <button
                        type="button"
                        class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200/90 bg-white text-zinc-600 shadow-sm outline-none transition hover:border-teal-300 hover:bg-teal-50/90 hover:text-teal-800 focus-visible:ring-2 focus-visible:ring-teal-500/30"
                        :aria-label="
                          p.is_published
                            ? 'Unpublish product'
                            : 'Publish product'
                        "
                        @click="togglePublish(p)"
                      >
                        <svg
                          v-if="p.is_published"
                          class="h-[1.125rem] w-[1.125rem]"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.75"
                          aria-hidden="true"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z"
                          />
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M10.5 9.75v4.5m3-2.25h-4.5"
                          />
                        </svg>
                        <svg
                          v-else
                          class="h-[1.125rem] w-[1.125rem]"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.75"
                          aria-hidden="true"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200/90 bg-white text-rose-600 shadow-sm outline-none transition hover:border-rose-300 hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-500/25"
                        aria-label="Delete product"
                        @click="openDeleteProductDialog(p.id)"
                      >
                        <svg
                          class="h-[1.125rem] w-[1.125rem]"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.75"
                          aria-hidden="true"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </li>
              </ul>
              <footer
                class="shrink-0 border-t border-zinc-200/90 bg-gradient-to-r from-zinc-50/95 to-zinc-100/80 px-4 py-3.5 sm:px-5"
                aria-label="Product list summary"
              >
                <div
                  class="flex flex-col gap-3 text-xs text-zinc-600 lg:hidden"
                >
                  <div
                    class="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span class="font-semibold text-zinc-800">Summary</span>
                    <span class="tabular-nums text-zinc-500"
                      >{{ products.length }} products</span
                    >
                  </div>
                  <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <span
                      >Live
                      <span class="font-semibold text-emerald-800">{{
                        productsPublishedCount
                      }}</span></span
                    >
                    <span
                      >Draft
                      <span class="font-semibold text-zinc-800">{{
                        productsDraftCount
                      }}</span></span
                    >
                    <span
                      class="ml-auto font-semibold tabular-nums text-zinc-900"
                    >
                      List total {{ formatGhs(productsPriceTotalCents) }}
                    </span>
                  </div>
                </div>
                <div
                  class="hidden min-w-[36rem] grid-cols-[minmax(0,0.82fr)_9.25rem_4.5rem_5rem_3.75rem_5.75rem] gap-x-4 text-[11px] lg:grid lg:items-center"
                >
                  <span class="font-bold uppercase tracking-wider text-zinc-500"
                    >Summary</span
                  >
                  <span class="text-zinc-400" aria-hidden="true">—</span>
                  <span class="text-zinc-400" aria-hidden="true">—</span>
                  <p
                    class="text-right text-sm font-bold tabular-nums tracking-tight text-zinc-900"
                  >
                    {{ formatGhs(productsPriceTotalCents) }}
                  </p>
                  <div class="flex justify-center">
                    <span
                      class="inline-flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center text-[11px] font-medium text-zinc-600"
                    >
                      <span class="text-emerald-800"
                        >{{ productsPublishedCount }} live</span
                      >
                      <span class="text-zinc-300" aria-hidden="true">·</span>
                      <span>{{ productsDraftCount }} draft</span>
                    </span>
                  </div>
                  <span
                    class="justify-self-end text-right text-[10px] font-semibold uppercase tracking-wide text-zinc-400"
                  >
                    {{ products.length }} rows
                  </span>
                </div>
              </footer>
            </template>
            <p
              v-else
              class="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center"
            >
              <span
                class="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 ring-1 ring-zinc-200/80"
                aria-hidden="true"
              >
                <svg
                  class="h-7 w-7"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
              </span>
              <span class="text-sm font-semibold text-zinc-700">
                No products in this store yet
              </span>
              <span class="max-w-xs text-xs leading-relaxed text-zinc-500">
                Add your first item with
                <span class="font-semibold text-zinc-600">Add product</span>
                — you can attach categories anytime.
              </span>
            </p>
          </div>

          <aside
            class="w-full min-w-0 shrink-0 overflow-hidden bg-gradient-to-b from-violet-50/70 via-white to-teal-50/25 p-1 xl:sticky xl:top-4 xl:self-start"
          >
            <div
              class="rounded-[1.35rem] border border-white/80 bg-white/85 p-4 shadow-inner backdrop-blur-sm sm:p-5"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 gap-3">
                  <span
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-teal-500 text-white shadow-md shadow-violet-500/25"
                    aria-hidden="true"
                  >
                    <svg
                      class="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                      />
                    </svg>
                  </span>
                  <div class="min-w-0">
                    <h3
                      class="text-base font-bold tracking-tight text-zinc-900"
                    >
                      Categories
                    </h3>
                    <p class="mt-0.5 text-xs leading-relaxed text-zinc-600">
                      Group products for your shop — each product can show its
                      category as a label for buyers.
                    </p>
                  </div>
                </div>
                <span
                  v-if="productCategories.length"
                  class="inline-flex shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-violet-900 ring-1 ring-violet-200/80"
                >
                  {{ productCategories.length }}
                </span>
              </div>

              <div
                v-if="uncategorizedProductCount > 0 && products.length"
                class="mt-4 flex items-start gap-2.5 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 text-xs leading-snug text-amber-950 ring-1 ring-amber-100/80"
                role="status"
              >
                <span
                  class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700"
                  aria-hidden="true"
                >
                  <svg
                    class="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M12 18v-5M9 9a3 3 0 116 0c0 2-3 2-3 4"
                    />
                  </svg>
                </span>
                <span>
                  <span class="font-semibold">{{
                    uncategorizedProductCount
                  }}</span>
                  {{
                    uncategorizedProductCount === 1
                      ? "product has"
                      : "products have"
                  }}
                  no category — pick one in the list when you are ready.
                </span>
              </div>

              <div v-if="canUseRoleGatedStoreActions" class="mt-4">
                <label for="store-new-category-name" class="sr-only"
                  >New category name</label
                >
                <div
                  class="flex flex-col gap-2 rounded-2xl border border-zinc-200/70 bg-zinc-50/50 p-1.5 sm:flex-row sm:items-stretch"
                >
                  <input
                    id="store-new-category-name"
                    v-model="newCategoryName"
                    type="text"
                    autocomplete="off"
                    placeholder="e.g. Snacks, Drinks, Deals"
                    class="min-w-0 flex-1 rounded-xl border border-transparent bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none ring-zinc-200/80 transition placeholder:text-zinc-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
                    @keydown.enter.prevent="addStoreCategory"
                  />
                  <button
                    type="button"
                    class="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-zinc-900/10 transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-45 sm:shrink-0"
                    :disabled="categoryAddBusy || !newCategoryName.trim()"
                    @click="addStoreCategory"
                  >
                    <span
                      v-if="categoryAddBusy"
                      class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                      aria-hidden="true"
                    />
                    <span v-else class="text-lg leading-none" aria-hidden="true"
                      >+</span
                    >
                    <span>{{ categoryAddBusy ? "Adding…" : "Add" }}</span>
                  </button>
                </div>
                <p class="mt-2 text-[11px] font-medium text-zinc-500">
                  Press
                  <kbd
                    class="rounded border border-zinc-200 bg-white px-1 py-0.5 font-mono text-[10px] text-zinc-600"
                    >Enter</kbd
                  >
                  to add quickly.
                </p>
              </div>

              <ul
                v-if="productCategories.length"
                class="mt-4 max-h-[min(20rem,calc(100dvh-14rem))] space-y-2 overflow-y-auto overscroll-y-contain pr-0.5"
              >
                <li
                  v-for="c in productCategories"
                  :key="c.id"
                  class="group flex items-center gap-2 rounded-2xl border border-violet-100 bg-gradient-to-r from-white to-violet-50/40 px-3 py-2.5 text-sm font-semibold text-violet-950 shadow-sm ring-1 ring-violet-100/60 transition hover:border-violet-200 hover:shadow-md"
                >
                  <span
                    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"
                    aria-hidden="true"
                  >
                    <svg
                      class="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                      />
                    </svg>
                  </span>
                  <span class="min-w-0 flex-1 truncate">{{ c.name }}</span>
                  <button
                    v-if="canUseRoleGatedStoreActions"
                    type="button"
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-200/70 bg-white text-rose-600 opacity-90 transition hover:bg-rose-50 hover:opacity-100 disabled:pointer-events-none disabled:opacity-40"
                    :disabled="deleteCategoryBusyId === c.id"
                    :aria-label="`Remove category ${c.name}`"
                    title="Remove category"
                    @click="deleteStoreCategory(c.id)"
                  >
                    <span
                      v-if="deleteCategoryBusyId === c.id"
                      class="h-4 w-4 animate-spin rounded-full border-2 border-rose-200 border-t-rose-600"
                      aria-hidden="true"
                    />
                    <svg
                      v-else
                      class="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </li>
              </ul>
              <div
                v-else
                class="mt-4 flex flex-col items-center rounded-2xl border border-dashed border-violet-200/80 bg-violet-50/30 px-4 py-8 text-center"
              >
                <p class="text-sm font-semibold text-violet-950">
                  No categories yet
                </p>
                <p
                  class="mt-1 max-w-[16rem] text-xs leading-relaxed text-violet-800/80"
                >
                  Add a name above to create your first label, then assign it to
                  products in the table.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section v-show="tab === 'orders'" class="space-y-4">
        <!-- Section header — matches Products section header -->
        <div
          class="flex flex-col gap-4 rounded-3xl border border-white/60 bg-white/70 px-5 py-4 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.12)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:px-6"
        >
          <div class="min-w-0">
            <h2 class="text-lg font-bold tracking-tight text-zinc-900">
              Orders &amp; delivery
            </h2>
            <p class="mt-1 text-sm text-zinc-600">
              Update fulfilment status and buyer-facing delivery updates.
            </p>
          </div>
          <!-- Stat chips -->
          <div class="flex shrink-0 flex-wrap items-center gap-2">
            <span
              class="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white/90 px-3 py-1.5 text-[11px] shadow-sm ring-1 ring-zinc-200/50"
            >
              <span class="font-semibold uppercase tracking-wide text-zinc-500"
                >Total</span
              >
              <span class="font-bold text-zinc-900">{{ orders.length }}</span>
            </span>
            <span
              class="inline-flex items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-50/80 px-3 py-1.5 text-[11px] shadow-sm ring-1 ring-amber-100/60"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span class="font-semibold text-amber-700"
                >{{
                  orders.filter((o) => o.status === "pending").length
                }}
                pending</span
              >
            </span>
            <span
              class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50/80 px-3 py-1.5 text-[11px] shadow-sm ring-1 ring-emerald-100/60"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span class="font-semibold text-emerald-700"
                >{{
                  orders.filter((o) => o.status === "delivered").length
                }}
                delivered</span
              >
            </span>
          </div>
        </div>

        <!-- Main split panel — matches Products panel exactly -->
        <div
          class="flex h-[80dvh] min-h-[32rem] min-w-0 w-full flex-col overflow-hidden rounded-3xl border border-zinc-200/70 bg-white/95 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.16)] ring-1 ring-zinc-100/80 lg:grid lg:grid-cols-[28%_minmax(0,1fr)] lg:items-stretch xl:h-[56rem]"
        >
          <!-- ── LEFT: master list ── -->
          <div
            class="flex max-h-[45dvh] min-h-0 min-w-0 w-full flex-col overflow-hidden border-b border-zinc-200/80 bg-white/95 lg:h-full lg:max-h-none lg:min-h-0 lg:border-b-0 lg:border-r lg:border-zinc-200/80"
          >
            <!-- List header -->
            <div
              class="flex shrink-0 flex-col gap-2 border-b border-zinc-100 bg-gradient-to-r from-zinc-50/95 to-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
            >
              <div class="min-w-0">
                <h3 class="text-sm font-bold tracking-tight text-zinc-900">
                  Order list
                </h3>
                <p
                  class="mt-0.5 text-[11px] font-medium leading-snug text-zinc-500"
                >
                  Newest first — click a row to view details.
                </p>
              </div>
              <span
                class="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-zinc-900/[0.06] px-2.5 py-1 text-[11px] font-bold tabular-nums text-zinc-700 ring-1 ring-zinc-200/80 sm:self-auto"
              >
                <span class="text-zinc-500">Orders</span>
                {{ orders.length }}
              </span>
            </div>

            <!-- Column headers -->
            <div
              class="hidden shrink-0 grid-cols-[1fr_7rem] gap-x-3 border-b border-zinc-200 bg-zinc-100/90 px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500 sm:grid"
            >
              <span>Customer</span>
              <span class="text-right">Amount</span>
            </div>

            <!-- Search -->
            <div class="shrink-0 border-b border-zinc-100 bg-white px-4 py-2.5">
              <div class="flex items-center gap-2">
                <label class="sr-only" for="order-master-search"
                  >Search orders</label
                >
                <div class="relative min-w-0 flex-1">
                  <span
                    class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
                  >
                    <svg
                      class="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="m21 21-4.35-4.35m1.6-5.4a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </span>
                  <input
                    id="order-master-search"
                    v-model="orderSearch"
                    type="search"
                    placeholder="Search by name or ref…"
                    class="w-full rounded-lg border border-zinc-200/80 bg-zinc-50/70 py-1.5 pl-8 pr-3 text-xs text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-400/20"
                  />
                </div>
                <label class="sr-only" for="order-master-sort">Sort orders</label>
                <select
                  id="order-master-sort"
                  v-model="orderSortMode"
                  class="shrink-0 rounded-lg border border-zinc-200/80 bg-zinc-50/70 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 outline-none transition focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-400/20"
                >
                  <option value="newest">Newest</option>
                  <option value="status">Status</option>
                </select>
              </div>
            </div>

            <!-- Rows -->
            <ul
              class="min-h-0 flex-1 overflow-y-auto overscroll-y-contain divide-y divide-zinc-100/90"
            >
              <li
                v-for="ord in filteredOrders"
                :key="ord.id"
                class="transition-colors last:border-b-0 motion-safe:duration-150"
                :class="
                  selectedOrderId === ord.id
                    ? 'bg-zinc-50/90'
                    : 'hover:bg-zinc-50/60'
                "
              >
                <button
                  type="button"
                  class="w-full px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-400/40"
                  :class="
                    selectedOrderId === ord.id
                      ? 'border-l-2 border-l-zinc-900'
                      : ''
                  "
                  @click="selectedOrderId = ord.id"
                >
                  <div class="flex items-center gap-3">
                    <!-- Avatar -->
                    <span
                      class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tracking-wide"
                      :class="
                        selectedOrderId === ord.id
                          ? 'bg-zinc-900 text-white'
                          : 'bg-zinc-200/80 text-zinc-600'
                      "
                      aria-hidden="true"
                      >{{ orderCustomerInitials(ord) }}</span
                    >
                    <div class="min-w-0 flex-1">
                      <div class="flex items-baseline justify-between gap-2">
                        <p
                          class="truncate text-[13px] font-semibold text-zinc-900"
                        >
                          {{ orderCustomerTitle(ord) }}
                        </p>
                        <p
                          class="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-zinc-700"
                        >
                          {{ formatGhs(orderTotalCents(ord)) }}
                        </p>
                      </div>
                      <div
                        class="mt-0.5 flex items-center justify-between gap-2"
                      >
                        <p class="font-mono text-[11px] text-zinc-400">
                          {{ orderDisplayRef(ord) }}
                        </p>
                        <div class="flex items-center gap-1.5">
                          <span
                            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            :class="{
                              'bg-amber-100 text-amber-700':
                                ord.status === 'pending',
                              'bg-sky-100 text-sky-700':
                                ord.status === 'confirmed',
                              'bg-violet-100 text-violet-700':
                                ord.status === 'preparing',
                              'bg-blue-100 text-blue-700':
                                ord.status === 'out_for_delivery',
                              'bg-emerald-100 text-emerald-700':
                                ord.status === 'delivered',
                              'bg-red-100 text-red-600':
                                ord.status === 'canceled',
                            }"
                            >{{ orderStatusLabel(ord.status) }}</span
                          >
                          <p class="text-[10px] text-zinc-400">
                            {{ formatOrderMasterDate(ord.created_at) }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              </li>
              <li
                v-if="!filteredOrders.length && orders.length"
                class="px-4 py-8 text-center text-xs text-zinc-400"
              >
                No orders match "{{ orderSearch }}".
              </li>
              <li v-if="!orders.length" class="px-4 py-14 text-center">
                <p class="text-sm font-semibold text-zinc-800">No orders yet</p>
                <p class="mt-1 text-xs text-zinc-500">
                  When buyers check out, orders appear here.
                </p>
              </li>
            </ul>
          </div>

          <!-- ── RIGHT: detail panel ── -->
          <div
            class="flex min-h-0 flex-col overflow-hidden bg-white/95"
            aria-live="polite"
          >
            <template v-if="selectedOrder">
              <!-- Detail header — matches right panel pattern -->
              <div
                class="flex shrink-0 flex-col gap-3 border-b border-zinc-100 bg-gradient-to-r from-zinc-50/95 to-white px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div class="flex min-w-0 items-center gap-3">
                  <span
                    class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-white"
                    aria-hidden="true"
                    >{{ orderCustomerInitials(selectedOrder) }}</span
                  >
                  <div class="min-w-0">
                    <p class="text-base font-bold tracking-tight text-zinc-900">
                      {{ orderCustomerTitle(selectedOrder) }}
                    </p>
                    <div
                      class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5"
                    >
                      <span
                        class="font-mono text-[11px] font-semibold text-zinc-500"
                        >{{ orderDisplayRef(selectedOrder) }}</span
                      >
                      <span class="text-zinc-300">·</span>
                      <span class="text-[11px] text-zinc-400">{{
                        formatOrderListDate(selectedOrder.created_at)
                      }}</span>
                      <span
                        class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        :class="{
                          'bg-amber-100 text-amber-700':
                            selectedOrder.status === 'pending',
                          'bg-sky-100 text-sky-700':
                            selectedOrder.status === 'confirmed',
                          'bg-violet-100 text-violet-700':
                            selectedOrder.status === 'preparing',
                          'bg-blue-100 text-blue-700':
                            selectedOrder.status === 'out_for_delivery',
                          'bg-emerald-100 text-emerald-700':
                            selectedOrder.status === 'delivered',
                          'bg-red-100 text-red-600':
                            selectedOrder.status === 'canceled',
                        }"
                        >{{ orderStatusLabel(selectedOrder.status) }}</span
                      >
                    </div>
                  </div>
                </div>
                <!-- Status progression -->
                <div class="shrink-0">
                  <p
                    class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400"
                  >
                    Progress status
                  </p>
                  <div class="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      class="inline-flex min-w-[13rem] items-center justify-center gap-1.5 rounded-xl border border-zinc-200/80 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm outline-none transition hover:border-zinc-300 hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50"
                      :disabled="!nextOrderProgressStatus(selectedOrder.status)"
                      @click="
                        nextOrderProgressStatus(selectedOrder.status) &&
                        setOrderStatus(
                          selectedOrder.id,
                          nextOrderProgressStatus(selectedOrder.status)!,
                        )
                      "
                    >
                      <svg
                        class="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                      {{ orderProgressActionLabel(selectedOrder.status) }}
                    </button>
                    <button
                      v-if="canCancelOrderStatus(selectedOrder.status)"
                      type="button"
                      class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200/80 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm outline-none transition hover:bg-rose-100"
                      @click="onCancelSelectedOrder"
                    >
                      <svg
                        class="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                      Cancel order
                    </button>
                  </div>
                </div>
              </div>

              <!-- Quick facts row -->
              <div
                class="hidden shrink-0 grid-cols-4 gap-x-3 border-b border-zinc-100 bg-zinc-100/90 px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500 sm:grid"
              >
                <span>Type</span>
                <span>Email</span>
                <span>Phone</span>
                <span class="text-right">Items</span>
              </div>
              <div
                class="shrink-0 grid-cols-4 gap-3 border-b border-zinc-100 bg-white/95 px-4 py-3 text-sm sm:grid"
              >
                <p class="font-medium text-zinc-800">Guest</p>
                <p class="truncate font-medium text-zinc-800">
                  {{ selectedOrder.guest_email || "—" }}
                </p>
                <p class="font-medium text-zinc-800">
                  {{ selectedOrder.guest_phone || "—" }}
                </p>
                <p class="text-right font-semibold tabular-nums text-zinc-800">
                  {{ selectedOrderItems.length }}
                </p>
              </div>

              <!-- Items table — scrollable body -->
              <div class="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
                <div class="p-4">
                  <div
                    class="overflow-hidden rounded-2xl border border-zinc-200/70"
                  >
                    <div
                      class="flex items-center justify-between border-b border-zinc-100 bg-gradient-to-r from-zinc-50/95 to-white px-5 py-3"
                    >
                      <p class="text-sm font-bold tracking-tight text-zinc-900">
                        Ordered items
                      </p>
                      <span
                        class="inline-flex items-center gap-1.5 rounded-full bg-zinc-900/[0.06] px-2.5 py-1 text-[11px] font-bold tabular-nums text-zinc-700 ring-1 ring-zinc-200/80"
                        >{{ selectedOrderItems.length }}</span
                      >
                    </div>
                    <div
                      v-if="selectedOrderItems.length"
                      class="overflow-x-auto"
                    >
                      <table class="min-w-full text-left">
                        <thead>
                          <tr
                            class="border-b border-zinc-100 bg-zinc-100/90 text-[10px] font-bold uppercase tracking-wider text-zinc-500"
                          >
                            <th class="px-5 py-3">Product</th>
                            <th class="px-4 py-3 text-center">Qty</th>
                            <th class="px-4 py-3 text-right">Unit</th>
                            <th class="px-5 py-3 text-right">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-zinc-100/90">
                          <tr
                            v-for="(item, idx) in selectedOrderItems"
                            :key="`${selectedOrder.id}-item-${idx}`"
                            class="bg-white transition-colors hover:bg-zinc-50/80 motion-safe:duration-150"
                          >
                            <td
                              class="px-5 py-3 text-sm font-medium text-zinc-800"
                            >
                              {{ item.title }}
                            </td>
                            <td class="px-4 py-3 text-center">
                              <span
                                class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold tabular-nums text-zinc-700"
                                >{{ item.quantity }}</span
                              >
                            </td>
                            <td
                              class="px-4 py-3 text-right text-sm tabular-nums text-zinc-500"
                            >
                              {{ formatGhs(item.unitPriceCents) }}
                            </td>
                            <td
                              class="px-5 py-3 text-right text-sm font-semibold tabular-nums text-zinc-900"
                            >
                              {{
                                formatGhs(item.unitPriceCents * item.quantity)
                              }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p
                      v-else
                      class="px-5 py-4 text-center text-xs text-zinc-400"
                    >
                      No items found on this order.
                    </p>
                    <div
                      v-if="selectedOrderItems.length"
                      class="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/80 px-5 py-3"
                    >
                      <span class="text-xs text-zinc-400"
                        >{{ selectedOrderItems.length }} item{{
                          selectedOrderItems.length !== 1 ? "s" : ""
                        }}</span
                      >
                      <div class="flex items-center gap-2">
                        <span
                          class="text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                          >Total</span
                        >
                        <span
                          class="text-sm font-bold tabular-nums text-zinc-900"
                        >
                          {{
                            formatGhs(
                              selectedOrderItems.reduce(
                                (sum, it) =>
                                  sum + it.unitPriceCents * it.quantity,
                                0,
                              ),
                            )
                          }}
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- Delivery address -->
                  <div
                    v-if="selectedOrder.delivery_address"
                    class="mt-3 overflow-hidden rounded-2xl border border-zinc-200/70"
                  >
                    <div
                      class="flex items-center gap-2 border-b border-zinc-100 bg-gradient-to-r from-zinc-50/95 to-white px-5 py-3"
                    >
                      <svg
                        class="h-3.5 w-3.5 text-zinc-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                        />
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                      <p class="text-sm font-bold tracking-tight text-zinc-900">
                        Drop-off address
                      </p>
                    </div>
                    <p
                      class="bg-white px-5 py-3.5 text-sm leading-relaxed text-zinc-700"
                    >
                      {{ selectedOrder.delivery_address }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Action footer -->
              <div
                class="shrink-0 border-t border-zinc-100 bg-white/95 px-5 py-3.5"
              >
                <div class="flex items-center justify-end gap-3">
                  <p class="text-[11px] font-medium text-zinc-400">
                    {{
                      formatGhs(
                        selectedOrderItems.reduce(
                          (sum, it) => sum + it.unitPriceCents * it.quantity,
                          0,
                        ),
                      )
                    }}
                  </p>
                </div>
              </div>
            </template>

            <!-- Empty detail state -->
            <div
              v-else
              class="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center"
            >
              <div
                class="flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-200/80 bg-zinc-50 text-zinc-400"
              >
                <svg
                  class="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
                  />
                </svg>
              </div>
              <p class="text-sm font-semibold text-zinc-800">Select an order</p>
              <p class="max-w-[16rem] text-xs leading-relaxed text-zinc-500">
                Click any row on the left to view full details here.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section v-show="tab === 'support'" class="space-y-6">
        <div
          class="flex flex-col gap-4 rounded-3xl border border-white/60 bg-white/70 px-5 py-4 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.14)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5"
        >
          <div class="min-w-0">
            <h2 class="text-lg font-bold tracking-tight text-zinc-900">
              Support tickets
            </h2>
            <p class="mt-1 text-sm leading-relaxed text-zinc-600">
              Message the platform team — each ticket is visible to super admins
              so they can help with account, billing, or technical issues.
            </p>
          </div>
          <button
            type="button"
            class="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-zinc-900/20 transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40"
            :disabled="!store"
            @click="openSupportTicketModal"
          >
            <span class="text-lg font-light leading-none" aria-hidden="true"
              >+</span
            >
            New ticket
          </button>
        </div>
        <div
          class="flex max-h-[min(55dvh,36rem)] min-h-[12rem] min-w-0 w-full flex-col overflow-hidden rounded-t-3xl rounded-b-none border border-zinc-200/70 bg-white/95 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.16)] ring-1 ring-zinc-100/80 backdrop-blur-md xl:max-h-[min(55dvh,42rem)]"
          role="region"
          aria-label="Support ticket history"
        >
          <div
            class="flex shrink-0 flex-col gap-2 border-b border-zinc-100 bg-gradient-to-r from-violet-50/90 to-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
          >
            <div class="min-w-0">
              <h3 class="text-sm font-bold tracking-tight text-zinc-900">
                Ticket history
              </h3>
              <p
                class="mt-0.5 text-[11px] font-medium leading-snug text-zinc-500"
              >
                Subject, status, and when each ticket was opened — newest at the
                top.
              </p>
            </div>
            <span
              class="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-zinc-900/[0.06] px-2.5 py-1 text-[11px] font-bold tabular-nums text-zinc-700 ring-1 ring-zinc-200/80 sm:self-auto"
            >
              <span class="text-zinc-500">Tickets</span>
              {{ tickets.length }}
            </span>
          </div>
          <div
            class="hidden shrink-0 grid-cols-[minmax(0,1.05fr)_7rem_10.25rem_minmax(0,1.15fr)] gap-x-3 border-b border-zinc-200 bg-zinc-100/90 px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500 lg:grid"
          >
            <span class="text-left">Subject</span>
            <span class="text-left">Status</span>
            <span class="text-left">Opened</span>
            <span class="text-left">Message</span>
          </div>
          <template v-if="tickets.length">
            <ul
              class="min-h-0 flex-1 divide-y divide-zinc-100 overflow-x-auto overflow-y-auto overscroll-y-contain"
            >
              <li
                v-for="t in tickets"
                :key="t.id"
                class="transition-colors hover:bg-zinc-50/90 motion-safe:duration-150"
              >
                <div class="space-y-3 p-4 lg:hidden">
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <p
                      class="min-w-0 flex-1 text-[0.9375rem] font-semibold leading-snug tracking-tight text-zinc-900"
                    >
                      {{ t.subject }}
                    </p>
                    <span :class="ticketStatusBadgeClass(t.status)">{{
                      t.status
                    }}</span>
                  </div>
                  <p class="text-[11px] font-medium tabular-nums text-zinc-500">
                    Opened {{ formatOrderListDate(t.created_at) }}
                  </p>
                  <p
                    class="line-clamp-4 text-xs leading-relaxed text-zinc-600 whitespace-pre-wrap"
                  >
                    {{ t.message }}
                  </p>
                </div>
                <div
                  class="hidden min-w-[44rem] grid-cols-[minmax(0,1.05fr)_7rem_10.25rem_minmax(0,1.15fr)] gap-x-3 px-4 py-3.5 lg:grid lg:items-start"
                >
                  <div class="min-w-0">
                    <p
                      class="truncate text-sm font-semibold tracking-tight text-zinc-900"
                    >
                      {{ t.subject }}
                    </p>
                    <p
                      class="mt-1 font-mono text-[10px] text-zinc-400"
                      :title="t.id"
                    >
                      {{ orderShortId(t.id) }}
                    </p>
                  </div>
                  <div class="pt-0.5">
                    <span :class="ticketStatusBadgeClass(t.status)">{{
                      t.status
                    }}</span>
                  </div>
                  <p
                    class="pt-0.5 text-xs tabular-nums leading-snug text-zinc-600"
                  >
                    {{ formatOrderListDate(t.created_at) }}
                  </p>
                  <p
                    class="line-clamp-3 min-w-0 text-xs leading-relaxed text-zinc-600 whitespace-pre-wrap"
                  >
                    {{ t.message }}
                  </p>
                </div>
              </li>
            </ul>
            <footer
              class="shrink-0 border-t border-zinc-200/90 bg-gradient-to-r from-zinc-50/95 to-zinc-100/80 px-4 py-3 sm:px-5"
            >
              <div class="flex flex-col gap-2 text-xs text-zinc-600 lg:hidden">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="font-semibold text-zinc-800">Summary</span>
                  <span class="tabular-nums text-zinc-500"
                    >{{ tickets.length }} total</span
                  >
                </div>
                <div class="flex flex-wrap gap-x-4 gap-y-1">
                  <span
                    >Open
                    <span class="font-semibold text-amber-800">{{
                      ticketsOpenCount
                    }}</span></span
                  >
                  <span
                    >Closed
                    <span class="font-semibold text-zinc-800">{{
                      ticketsClosedCount
                    }}</span></span
                  >
                </div>
              </div>
              <div
                class="hidden min-w-[44rem] grid-cols-[minmax(0,1.05fr)_7rem_10.25rem_minmax(0,1.15fr)] gap-x-3 text-[11px] lg:grid lg:items-center"
              >
                <span class="font-bold uppercase tracking-wider text-zinc-500"
                  >Summary</span
                >
                <span class="text-zinc-500" aria-hidden="true">—</span>
                <span class="text-zinc-500" aria-hidden="true">—</span>
                <div
                  class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right font-medium text-zinc-600"
                >
                  <span
                    ><span class="tabular-nums font-bold text-zinc-900">{{
                      tickets.length
                    }}</span>
                    total</span
                  >
                  <span class="text-zinc-300" aria-hidden="true">·</span>
                  <span class="text-amber-800"
                    ><span class="font-bold tabular-nums">{{
                      ticketsOpenCount
                    }}</span>
                    open</span
                  >
                  <span class="text-zinc-300" aria-hidden="true">·</span>
                  <span
                    ><span class="font-bold tabular-nums text-zinc-800">{{
                      ticketsClosedCount
                    }}</span>
                    closed</span
                  >
                </div>
              </div>
            </footer>
          </template>
          <div
            v-else
            class="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-14 text-center"
          >
            <span
              class="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-violet-400 ring-1 ring-violet-100/90"
              aria-hidden="true"
            >
              <svg
                class="h-7 w-7"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 5.25a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0-10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zM12 18.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 5.25a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 6.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm13.5 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0-5.25a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0-5.25a.375.375 0 11-.75 0 .375.375 0 01.75 0zM12 3.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0-5.25a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0-5.25a.375.375 0 11-.75 0 .375.375 0 01.75 0zM12 8.25a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
                />
              </svg>
            </span>
            <p class="text-sm font-semibold text-zinc-800">No tickets yet</p>
            <p class="max-w-sm text-xs leading-relaxed text-zinc-500">
              When you need help from the platform team, use
              <span class="font-semibold text-zinc-600">New ticket</span>
              — your conversation history will show here.
            </p>
          </div>
        </div>
      </section>

      <Teleport to="body">
        <Transition name="del-product-modal">
          <div
            v-if="cancelOrderConfirmOpen && selectedOrder"
            class="fixed inset-0 z-[275] flex items-center justify-center p-4"
            role="presentation"
          >
            <div
              class="absolute inset-0 bg-zinc-900/50 backdrop-blur-[1px]"
              aria-hidden="true"
            />
            <div
              class="del-product-dialog relative z-10 w-full max-w-md rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-[0_32px_90px_-28px_rgba(15,23,42,0.4)] sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cancel-order-modal-title"
              @click.stop
            >
              <div class="flex items-start gap-3">
                <span
                  class="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700"
                  aria-hidden="true"
                >
                  !
                </span>
                <div class="min-w-0 flex-1">
                  <h3
                    id="cancel-order-modal-title"
                    class="text-base font-bold tracking-tight text-zinc-900"
                  >
                    Cancel this order?
                  </h3>
                  <p class="mt-2 text-sm leading-relaxed text-zinc-600">
                    This will move the order to canceled and notify the buyer of
                    the update.
                  </p>
                </div>
              </div>
              <div class="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  class="rounded-2xl border border-zinc-200/80 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
                  @click="closeCancelOrderModal"
                >
                  Keep order
                </button>
                <button
                  type="button"
                  class="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700"
                  @click="confirmCancelSelectedOrder"
                >
                  Cancel order
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <Teleport to="body">
        <Transition name="del-product-modal">
          <div
            v-if="storeStatusConfirmOpen && store"
            class="fixed inset-0 z-[274] flex items-center justify-center p-4"
            role="presentation"
          >
            <div
              class="absolute inset-0 bg-zinc-900/50 backdrop-blur-[1px]"
              aria-hidden="true"
            />
            <div
              class="del-product-dialog relative z-10 w-full max-w-md rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-[0_32px_90px_-28px_rgba(15,23,42,0.4)] sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-labelledby="store-status-modal-title"
            >
              <div class="flex items-start gap-3">
                <span
                  class="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base"
                  :class="
                    pendingStoreActiveState
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'
                  "
                  aria-hidden="true"
                >
                  {{ pendingStoreActiveState ? "✓" : "!" }}
                </span>
                <div class="min-w-0 flex-1">
                  <h3
                    id="store-status-modal-title"
                    class="text-base font-bold tracking-tight text-zinc-900"
                  >
                    {{
                      pendingStoreActiveState
                        ? "Activate store link?"
                        : "Pause store link?"
                    }}
                  </h3>
                  <p class="mt-2 text-sm leading-relaxed text-zinc-600">
                    {{
                      pendingStoreActiveState
                        ? "Customers will be able to open your storefront and place new orders."
                        : "Customers will not be able to open your storefront or place new orders while paused."
                    }}
                  </p>
                </div>
              </div>
              <div class="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  class="rounded-2xl border border-zinc-200/80 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50"
                  :disabled="storeStatusBusy"
                  @click="closeStoreLinkStatusModal"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="rounded-2xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50"
                  :class="
                    pendingStoreActiveState
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : 'bg-zinc-900 hover:bg-zinc-800'
                  "
                  :disabled="storeStatusBusy"
                  @click="confirmStoreLinkStatusChange"
                >
                  {{
                    storeStatusBusy
                      ? "Saving..."
                      : pendingStoreActiveState
                        ? "Activate"
                        : "Pause"
                  }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <Teleport to="body">
        <Transition name="aproduct-modal">
          <div
            v-if="supportTicketModalOpen && store"
            class="aproduct-root fixed inset-0 z-[262] flex items-end justify-center p-0 sm:items-center sm:p-4"
            role="presentation"
          >
            <div
              class="absolute inset-0 bg-zinc-900/45 backdrop-blur-[2px]"
              aria-hidden="true"
            />
            <div
              class="aproduct-dialog relative z-10 flex max-h-[min(92svh,40rem)] w-full max-w-[min(96vw,40rem)] flex-col overflow-hidden rounded-t-[1.75rem] border border-zinc-200/80 bg-white shadow-[0_-24px_80px_-20px_rgba(15,23,42,0.35)] sm:max-h-[min(92svh,42rem)] sm:rounded-3xl sm:shadow-[0_32px_80px_-24px_rgba(15,23,42,0.35)]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="support-ticket-modal-title"
              @click.stop
            >
              <div
                class="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-100 bg-gradient-to-br from-violet-50/90 via-white to-indigo-50/40 px-5 py-4 sm:rounded-t-3xl sm:px-6 sm:py-5"
              >
                <div class="min-w-0 flex-1">
                  <p
                    class="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-800/70"
                  >
                    Support
                  </p>
                  <h2
                    id="support-ticket-modal-title"
                    class="mt-1 text-lg font-bold tracking-tight text-zinc-900"
                  >
                    New ticket
                  </h2>
                  <p class="mt-2 text-xs leading-relaxed text-zinc-600">
                    Visible to platform super admins — include enough detail to
                    reproduce or resolve the issue.
                  </p>
                </div>
                <button
                  type="button"
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white/90 text-xl leading-none text-zinc-500 shadow-sm transition hover:border-zinc-300 hover:bg-white hover:text-zinc-800 disabled:opacity-40"
                  aria-label="Close"
                  :disabled="ticketBusy"
                  @click="closeSupportTicketModal"
                >
                  ×
                </button>
              </div>
              <form
                class="flex min-h-0 flex-1 flex-col"
                @submit.prevent="submitSupportTicket"
              >
                <div
                  class="space-y-4 overflow-y-auto overscroll-y-contain px-5 py-5 sm:px-6"
                >
                  <div>
                    <label
                      for="support-ticket-subject"
                      class="text-xs font-semibold text-zinc-700"
                      >Subject <span class="text-rose-600">*</span></label
                    >
                    <input
                      id="support-ticket-subject"
                      v-model.trim="ticketSubject"
                      type="text"
                      name="subject"
                      required
                      autocomplete="off"
                      placeholder="e.g. Payout not reflecting"
                      class="mt-1.5 w-full rounded-xl border border-zinc-200/90 bg-zinc-50/50 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-500/20"
                    />
                  </div>
                  <div>
                    <label
                      for="support-ticket-message"
                      class="text-xs font-semibold text-zinc-700"
                      >Describe the issue
                      <span class="text-rose-600">*</span></label
                    >
                    <textarea
                      id="support-ticket-message"
                      v-model.trim="ticketMessage"
                      name="message"
                      rows="5"
                      required
                      placeholder="What happened, what you expected, and any links or order IDs that help."
                      class="mt-1.5 min-h-[7.5rem] w-full resize-y rounded-xl border border-zinc-200/90 bg-zinc-50/50 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-500/20"
                    />
                  </div>
                </div>
                <div
                  class="flex shrink-0 flex-col-reverse gap-2 border-t border-zinc-100 bg-zinc-50/60 px-5 py-4 sm:flex-row sm:justify-end sm:px-6"
                >
                  <button
                    type="button"
                    class="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-zinc-200/90 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:opacity-40"
                    :disabled="ticketBusy"
                    @click="closeSupportTicketModal"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    class="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-zinc-800 disabled:opacity-50"
                    :disabled="ticketBusy"
                  >
                    {{ ticketBusy ? "Sending…" : "Submit ticket" }}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </Transition>
      </Teleport>

      <Teleport to="body">
        <Transition name="aproduct-modal">
          <div
            v-if="addProductModalOpen && store"
            class="aproduct-root fixed inset-0 z-[260] flex items-end justify-center p-0 sm:items-center sm:p-4"
            role="presentation"
          >
            <div
              class="absolute inset-0 bg-zinc-900/45 backdrop-blur-[2px]"
              aria-hidden="true"
            />
            <div
              class="aproduct-dialog relative z-10 flex max-h-[92svh] w-full max-w-[min(96vw,52rem)] flex-col overflow-hidden rounded-t-[1.75rem] border border-zinc-200/80 bg-white shadow-[0_-24px_80px_-20px_rgba(15,23,42,0.35)] sm:max-h-[92svh] sm:rounded-3xl sm:shadow-[0_32px_80px_-24px_rgba(15,23,42,0.35)]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-product-modal-title"
              @click.stop
            >
              <div
                class="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-100 bg-gradient-to-br from-teal-50/90 via-white to-indigo-50/30 px-5 py-4 sm:rounded-t-3xl sm:px-6 sm:py-5"
              >
                <div class="min-w-0 flex-1">
                  <p
                    class="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-800/70"
                  >
                    New listing
                  </p>
                  <h2
                    id="add-product-modal-title"
                    class="mt-1 text-lg font-bold tracking-tight text-zinc-900"
                  >
                    Add product
                  </h2>
                  <div class="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      class="inline-flex max-w-full items-center truncate rounded-full border border-white/80 bg-white/90 px-3 py-1 text-xs font-semibold text-zinc-800 shadow-sm ring-1 ring-zinc-200/50"
                    >
                      {{ store.name }}
                    </span>
                    <RouterLink
                      :to="`/${store.slug}`"
                      class="inline-flex items-center rounded-full border border-teal-200/80 bg-teal-50/90 px-3 py-1 text-xs font-semibold text-teal-900 shadow-sm transition hover:border-teal-300 hover:bg-teal-100/80"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View shop ↗
                    </RouterLink>
                  </div>
                </div>
                <button
                  type="button"
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white/90 text-xl leading-none text-zinc-500 shadow-sm transition hover:border-zinc-300 hover:bg-white hover:text-zinc-800"
                  aria-label="Close"
                  @click="closeAddProductModal"
                >
                  ×
                </button>
              </div>

              <form
                class="flex min-h-0 flex-col"
                novalidate
                @submit.prevent="addProduct"
              >
                <div
                  class="max-h-[calc(92svh-11.5rem)] space-y-5 overflow-y-auto overscroll-y-contain bg-zinc-50/50 px-5 py-5 sm:max-h-[calc(92svh-12rem)] sm:px-6"
                >
                  <div
                    class="rounded-2xl border border-zinc-200/60 bg-white p-4 shadow-sm ring-1 ring-zinc-100/80 sm:p-5"
                  >
                    <h3
                      class="text-[11px] font-bold uppercase tracking-wider text-zinc-500"
                    >
                      Product details
                    </h3>
                    <div class="mt-4 space-y-4">
                      <div>
                        <label
                          for="modal-add-product-title"
                          class="text-xs font-semibold text-zinc-700"
                          >Name *</label
                        >
                        <input
                          id="modal-add-product-title"
                          v-model="newTitle"
                          type="text"
                          required
                          autocomplete="off"
                          placeholder="e.g. Jasmine rice 5 kg"
                          class="mt-1.5 w-full rounded-xl border border-zinc-200/90 bg-zinc-50/50 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
                        />
                      </div>
                      <div>
                        <label
                          for="modal-add-product-desc"
                          class="text-xs font-semibold text-zinc-700"
                          >Description</label
                        >
                        <textarea
                          id="modal-add-product-desc"
                          v-model="newDesc"
                          rows="3"
                          placeholder="What buyers should know — size, variants, delivery notes…"
                          class="mt-1.5 w-full resize-y rounded-xl border border-zinc-200/90 bg-zinc-50/50 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
                        />
                      </div>
                      <div>
                        <span
                          id="modal-add-product-category-label"
                          class="text-xs font-semibold text-zinc-700"
                        >
                          Category
                        </span>
                        <div class="mt-1.5">
                          <ProductCategoryDropdown
                            :category-id="newCategoryId.trim() || null"
                            :categories="productCategories"
                            labelled-by="modal-add-product-category-label"
                            size="md"
                            @pick="
                              (v) => {
                                newCategoryId = v ?? '';
                              }
                            "
                          />
                        </div>
                        <p
                          id="modal-add-product-category-hint"
                          class="mt-1.5 text-[11px] leading-snug text-zinc-500"
                        >
                          Optional — add labels in the Categories panel first if
                          you need new ones.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div
                    class="rounded-2xl border border-zinc-200/60 bg-white p-4 shadow-sm ring-1 ring-zinc-100/80 sm:p-5"
                  >
                    <h3
                      class="text-[11px] font-bold uppercase tracking-wider text-zinc-500"
                    >
                      Price & cover image
                    </h3>
                    <div class="mt-4 flex flex-col gap-6">
                      <div>
                        <label
                          for="modal-add-product-price"
                          class="text-xs font-semibold text-zinc-700"
                          >Price (GHS) *</label
                        >
                        <div class="relative mt-1.5">
                          <span
                            class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-zinc-400"
                            aria-hidden="true"
                            >₵</span
                          >
                          <input
                            id="modal-add-product-price"
                            v-model="newPrice"
                            type="text"
                            inputmode="decimal"
                            autocomplete="off"
                            placeholder="0.00"
                            class="w-full rounded-xl border border-zinc-200/90 bg-zinc-50/50 py-3 pl-9 pr-3 text-sm font-medium tabular-nums text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
                          />
                        </div>
                        <p
                          class="mt-1.5 text-[11px] leading-snug text-zinc-500"
                        >
                          Use a dot or comma for decimals (e.g. 12.50 or 12,50).
                        </p>
                      </div>
                      <div class="min-w-0 w-full">
                        <label
                          for="modal-add-product-image"
                          class="text-xs font-semibold text-zinc-700"
                        >
                          Cover image
                          <span class="font-normal text-zinc-400"
                            >(optional)</span
                          >
                        </label>
                        <input
                          id="modal-add-product-image"
                          ref="coverImageFileInputRef"
                          type="file"
                          class="sr-only"
                          :accept="COVER_IMAGE_ACCEPT"
                          @change="onAddProductCoverFileChange"
                        />
                        <div v-if="!pendingCoverImage" class="relative mt-1.5">
                          <button
                            type="button"
                            class="flex min-h-[10.5rem] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35 focus-visible:ring-offset-2"
                            :class="
                              coverDropActive
                                ? 'border-teal-500 bg-teal-50/70 shadow-inner shadow-teal-500/10'
                                : 'border-zinc-200/90 bg-gradient-to-b from-zinc-50/90 to-white hover:border-teal-300/90 hover:bg-teal-50/25'
                            "
                            aria-describedby="modal-cover-image-hint"
                            aria-label="Open file chooser for cover image"
                            @click="openCoverImagePicker"
                            @keydown.enter.prevent="openCoverImagePicker"
                            @keydown.space.prevent="openCoverImagePicker"
                            @dragover="onCoverDragOver"
                            @dragleave="onCoverDragLeave"
                            @drop="onCoverDrop"
                          >
                            <span
                              class="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-600/10 text-teal-700 ring-1 ring-teal-600/15"
                              aria-hidden="true"
                            >
                              <svg
                                class="h-6 w-6"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.75"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              >
                                <rect
                                  x="3"
                                  y="3"
                                  width="18"
                                  height="18"
                                  rx="2"
                                  ry="2"
                                />
                                <circle cx="8.5" cy="8.5" r="1.5" />
                                <path
                                  d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"
                                />
                              </svg>
                            </span>
                            <span class="text-sm font-semibold text-zinc-800">
                              Drop an image here
                            </span>
                            <span class="text-xs text-zinc-500">
                              or
                              <span class="font-semibold text-teal-700"
                                >browse</span
                              >
                              — JPEG, PNG, WebP, GIF
                            </span>
                          </button>
                          <p
                            id="modal-cover-image-hint"
                            class="mt-2 text-[11px] leading-relaxed text-zinc-500"
                          >
                            Max
                            <span class="font-medium text-zinc-700">{{
                              maxProductCoverImageLabel
                            }}</span>
                            on your plan · stored as
                            <code
                              class="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[10px] text-zinc-800"
                              >{{ store.id }}/…</code
                            >
                          </p>
                        </div>
                        <div
                          v-else
                          class="relative mt-1.5 overflow-hidden rounded-2xl border border-teal-200/70 bg-gradient-to-br from-teal-50/50 via-white to-indigo-50/20 shadow-sm ring-1 ring-teal-500/10"
                        >
                          <div
                            class="flex flex-col gap-3 p-3 sm:flex-row sm:items-stretch"
                          >
                            <div
                              class="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-zinc-900/5 sm:aspect-square sm:h-28 sm:w-28 sm:max-w-[7rem]"
                            >
                              <img
                                v-if="coverPreviewUrl"
                                :src="coverPreviewUrl"
                                alt=""
                                class="h-full w-full object-cover"
                              />
                            </div>
                            <div
                              class="flex min-w-0 flex-1 flex-col justify-center gap-2"
                            >
                              <p class="text-xs font-semibold text-zinc-900">
                                {{ pendingCoverImage.file.name }}
                              </p>
                              <p class="text-[11px] tabular-nums text-zinc-500">
                                {{
                                  (pendingCoverImage.file.size / 1024).toFixed(
                                    0,
                                  )
                                }}
                                KB · {{ maxProductCoverImageLabel }} max
                              </p>
                              <div class="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  class="inline-flex items-center justify-center rounded-lg border border-teal-200/90 bg-white px-3 py-1.5 text-xs font-semibold text-teal-900 shadow-sm transition hover:bg-teal-50/80"
                                  @click="openCoverImagePicker"
                                >
                                  Replace
                                </button>
                                <button
                                  type="button"
                                  class="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                                  @click="clearPendingCoverImage"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          </div>
                          <div
                            v-if="addProductImageKey"
                            class="border-t border-teal-100/80 bg-white/60 px-3 py-2"
                          >
                            <p
                              class="text-[10px] font-bold uppercase tracking-wide text-teal-900/90"
                            >
                              Upload path
                            </p>
                            <code
                              class="mt-0.5 block break-all font-mono text-[10px] leading-snug text-teal-950"
                              >{{ addProductImageKey }}</code
                            >
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  class="shrink-0 border-t border-zinc-200/80 bg-white/95 px-5 py-4 backdrop-blur-sm sm:px-6"
                >
                  <label
                    class="flex cursor-pointer select-none items-start gap-3 rounded-xl border border-zinc-200/70 bg-zinc-50/60 px-3 py-3 transition hover:border-teal-200/80 hover:bg-teal-50/40"
                  >
                    <input
                      v-model="newPublished"
                      type="checkbox"
                      class="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-teal-600 focus:ring-teal-500/40"
                    />
                    <span class="min-w-0">
                      <span class="block text-sm font-semibold text-zinc-900"
                        >Publish immediately</span
                      >
                      <span class="block text-xs leading-snug text-zinc-600"
                        >When off, the product is saved as a draft and stays
                        hidden on your storefront.</span
                      >
                    </span>
                  </label>
                  <div
                    class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end sm:gap-3"
                  >
                    <button
                      type="button"
                      class="inline-flex min-h-[2.75rem] w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 sm:w-auto"
                      @click="closeAddProductModal"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      class="inline-flex min-h-[2.75rem] w-full items-center justify-center rounded-xl bg-zinc-900 px-6 text-sm font-semibold text-white shadow-md transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-45 sm:w-auto sm:min-w-[10.5rem]"
                      :disabled="!canSubmitAddProduct"
                    >
                      <span v-if="productBusy">Adding…</span>
                      <span v-else>Add to catalog</span>
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </Transition>
      </Teleport>

      <Teleport to="body">
        <Transition name="del-product-modal">
          <div
            v-if="deleteProductTargetId"
            class="fixed inset-0 z-[270] flex items-center justify-center p-4"
            role="presentation"
          >
            <div
              class="absolute inset-0 bg-zinc-900/50 backdrop-blur-[2px]"
              aria-hidden="true"
            />
            <div
              class="del-product-dialog relative z-10 w-full max-w-md rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-[0_24px_64px_-24px_rgba(15,23,42,0.35)]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-product-modal-title"
              @click.stop
            >
              <p
                class="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-700/80"
              >
                Delete product
              </p>
              <h2
                id="delete-product-modal-title"
                class="mt-1 text-lg font-bold tracking-tight text-zinc-900"
              >
                Remove this listing?
              </h2>
              <p class="mt-2 text-sm leading-relaxed text-zinc-600">
                <span class="font-semibold text-zinc-900">{{
                  deleteProductTarget?.title ?? "This product"
                }}</span>
                will be removed from your catalog. Buyers will no longer see it
                on your shop. This cannot be undone.
              </p>
              <div
                class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3"
              >
                <button
                  type="button"
                  class="inline-flex min-h-[2.75rem] w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 sm:w-auto"
                  :disabled="deleteProductBusy"
                  @click="closeDeleteProductDialog"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="inline-flex min-h-[2.75rem] w-full items-center justify-center rounded-xl border border-rose-700/20 bg-rose-600 px-5 text-sm font-semibold text-white shadow-md transition hover:bg-rose-700 disabled:pointer-events-none disabled:opacity-50 sm:w-auto sm:min-w-[9rem]"
                  :disabled="deleteProductBusy"
                  @click="confirmDeleteProduct"
                >
                  <span v-if="deleteProductBusy">Deleting…</span>
                  <span v-else>Delete product</span>
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <Teleport to="body">
        <Transition name="store-fee-plan-modal">
          <div
            v-if="storeFeePlanModalOpen && store"
            class="fixed inset-0 z-[275] flex items-center justify-center p-4"
            role="presentation"
          >
            <div
              class="absolute inset-0 bg-zinc-900/50 backdrop-blur-[2px]"
              aria-hidden="true"
            />
            <div
              class="store-fee-plan-dialog relative z-10 w-full max-w-lg rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-[0_24px_64px_-24px_rgba(15,23,42,0.35)]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="store-fee-plan-modal-title"
              @click.stop
            >
              <p
                class="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-800/90"
              >
                Store platform fee
              </p>
              <h2
                id="store-fee-plan-modal-title"
                class="mt-1 text-lg font-bold tracking-tight text-zinc-900"
              >
                Choose a plan
              </h2>
              <p class="mt-2 text-sm leading-relaxed text-zinc-600">
                Paystack will charge the monthly amount for the tier you select.
                Your account plan is set to the same tier after payment
                succeeds.
              </p>
              <ul class="mt-5 space-y-2">
                <li v-for="p in storeFeePlanChoices" :key="p.id">
                  <label
                    class="flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition"
                    :class="
                      selectedStoreFeePlan === p.id
                        ? 'border-amber-400 bg-amber-50/80 ring-1 ring-amber-200/80'
                        : 'border-zinc-200 bg-white hover:border-zinc-300'
                    "
                  >
                    <input
                      v-model="selectedStoreFeePlan"
                      type="radio"
                      class="mt-1 h-4 w-4 shrink-0 border-zinc-300 text-amber-700 focus:ring-amber-500"
                      :value="p.id"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block text-sm font-bold text-zinc-900">{{
                        p.name
                      }}</span>
                      <span class="mt-0.5 block text-xs text-zinc-600">
                        {{ formatGhsWhole(p.monthlyGhs) }} / month (test
                        checkout)
                      </span>
                    </span>
                  </label>
                </li>
              </ul>
              <div
                class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3"
              >
                <button
                  type="button"
                  class="inline-flex min-h-[2.75rem] w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 sm:w-auto"
                  :disabled="payBusy"
                  @click="closeStoreFeePlanModal"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="inline-flex min-h-[2.75rem] w-full items-center justify-center rounded-xl border border-amber-700/20 bg-gradient-to-r from-amber-500 to-orange-500 px-5 text-sm font-semibold text-white shadow-md transition hover:from-amber-600 hover:to-orange-600 disabled:pointer-events-none disabled:opacity-50 sm:w-auto sm:min-w-[11rem]"
                  :disabled="payBusy"
                  @click="confirmStoreFeePlanAndPay"
                >
                  <span v-if="payBusy">Starting…</span>
                  <span v-else>Continue to Paystack</span>
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>
    </template>
  </div>
</template>

<style scoped>
.store-fee-plan-modal-enter-active,
.store-fee-plan-modal-leave-active {
  transition: opacity 0.2s ease;
}
.store-fee-plan-modal-enter-from,
.store-fee-plan-modal-leave-to {
  opacity: 0;
}
.store-fee-plan-modal-enter-active .store-fee-plan-dialog,
.store-fee-plan-modal-leave-active .store-fee-plan-dialog {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}
.store-fee-plan-modal-enter-from .store-fee-plan-dialog,
.store-fee-plan-modal-leave-to .store-fee-plan-dialog {
  opacity: 0;
  transform: translateY(0.5rem) scale(0.98);
}

.del-product-modal-enter-active,
.del-product-modal-leave-active {
  transition: opacity 0.2s ease;
}
.del-product-modal-enter-from,
.del-product-modal-leave-to {
  opacity: 0;
}
.del-product-modal-enter-active .del-product-dialog,
.del-product-modal-leave-active .del-product-dialog {
  transition:
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.22s ease;
}
.del-product-modal-enter-from .del-product-dialog,
.del-product-modal-leave-to .del-product-dialog {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}
.aproduct-modal-enter-active,
.aproduct-modal-leave-active {
  transition: opacity 0.22s ease;
}
.aproduct-modal-enter-from,
.aproduct-modal-leave-to {
  opacity: 0;
}
.aproduct-modal-enter-active .aproduct-dialog,
.aproduct-modal-leave-active .aproduct-dialog {
  transition:
    transform 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.28s ease;
}
.aproduct-modal-enter-from .aproduct-dialog,
.aproduct-modal-leave-to .aproduct-dialog {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
}
@media (min-width: 640px) {
  .aproduct-modal-enter-from .aproduct-dialog,
  .aproduct-modal-leave-to .aproduct-dialog {
    transform: translateY(8px) scale(0.98);
  }
}
</style>
