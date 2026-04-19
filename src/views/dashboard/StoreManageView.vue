<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { RouterLink, useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { formatGhs } from "../../lib/formatMoney";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";
import { normalizeSignupPlanId } from "../../constants/planEntitlements";
import {
  PLAN_FEATURE_LIMITS,
  resolvePricingPlanId,
} from "../../lib/planFeatureLimits";
import { useRealtimeTableRefresh } from "../../composables/useRealtimeTableRefresh";
import SkeletonStoreManage from "../../components/skeleton/SkeletonStoreManage.vue";

const route = useRoute();
const auth = useAuthStore();
const { sessionUserId, isPlatformStaff, user, isSuperAdmin } =
  storeToRefs(auth);
const toast = useToastStore();

const storeId = computed(() => String(route.params.storeId ?? ""));

const tab = ref<"products" | "orders" | "support">("products");
const loading = ref(true);

const store = ref<{
  id: string;
  slug: string;
  name: string;
  whatsapp_phone_e164: string | null;
  owner_id: string;
  logo_path: string | null;
} | null>(null);

const products = ref<
  {
    id: string;
    title: string;
    description: string | null;
    price_cents: number;
    is_published: boolean;
    image_paths: string[];
  }[]
>([]);

const orders = ref<
  {
    id: string;
    status: string;
    created_at: string;
    customer_id: string | null;
    guest_name: string | null;
    guest_email: string | null;
    delivery_address: string | null;
  }[]
>([]);

const newTitle = ref("");
const newDesc = ref("");
const newPrice = ref("");
const newPublished = ref(true);
const productBusy = ref(false);
const addProductModalOpen = ref(false);
const deleteProductTargetId = ref<string | null>(null);
const deleteProductBusy = ref(false);

const deleteProductTarget = computed(() => {
  const id = deleteProductTargetId.value;
  if (!id) return null;
  return products.value.find((p) => p.id === id) ?? null;
});

/** Picked cover file + object name under `product-images` (DB stores `objectName` only). */
const pendingCoverImage = ref<{ file: File; objectName: string } | null>(null);
const coverImageFileInputRef = ref<HTMLInputElement | null>(null);
const coverDropActive = ref(false);
const coverPreviewUrl = ref<string | null>(null);

const sellerPlanId = computed(() =>
  resolvePricingPlanId(user.value?.user_metadata?.signup_plan),
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
  newPrice.value = "";
  pendingCoverImage.value = null;
  newPublished.value = true;
}

function openAddProductModal() {
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
  if (addProductModalOpen.value) {
    e.preventDefault();
    closeAddProductModal();
  }
}

function openDeleteProductDialog(productId: string) {
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
  const { error } = await supabase.from("products").delete().eq("id", id);
  deleteProductBusy.value = false;
  if (error) {
    toast.error(error.message);
    return;
  }
  deleteProductTargetId.value = null;
  toast.success("Product removed.");
  await loadAll();
}

watch([addProductModalOpen, deleteProductTargetId], ([open, delId]) => {
  document.body.style.overflow = open || delId ? "hidden" : "";
  if (open) {
    void nextTick(() => {
      document.getElementById("modal-add-product-title")?.focus();
    });
  }
});

watch(store, (s) => {
  if (!s) {
    if (addProductModalOpen.value) {
      addProductModalOpen.value = false;
      resetAddProductForm();
    }
    if (deleteProductTargetId.value) deleteProductTargetId.value = null;
    document.body.style.overflow = "";
  }
});

onBeforeUnmount(() => {
  document.body.style.overflow = "";
  document.removeEventListener("keydown", onStoreManageDocKeydown);
  if (coverPreviewUrl.value) {
    URL.revokeObjectURL(coverPreviewUrl.value);
    coverPreviewUrl.value = null;
  }
});

const payBusy = ref(false);
const logoBusy = ref(false);
const logoUploadInputRef = ref<HTMLInputElement | null>(null);

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

/** Owners need a chosen plan (or super admin) before changing the shop logo. */
const canUploadStoreLogo = computed(
  () => isStoreOwner.value && (hasSelectedPlan.value || isSuperAdmin.value),
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

const deliveryForms = ref<
  Record<
    string,
    {
      stage: string;
      last_message: string;
      last_latitude: string;
      last_longitude: string;
    }
  >
>({});

function ensureDeliveryForm(orderId: string) {
  if (!deliveryForms.value[orderId]) {
    deliveryForms.value[orderId] = {
      stage: "pending",
      last_message: "",
      last_latitude: "",
      last_longitude: "",
    };
  }
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
  }
  if (!isSupabaseConfigured() || !sessionUserId.value || !storeId.value) {
    if (!silent) loading.value = false;
    return;
  }
  const supabase = getSupabaseBrowser();
  try {
    const { data: s, error: se } = await supabase
      .from("stores")
      .select("id, slug, name, whatsapp_phone_e164, owner_id, logo_path")
      .eq("id", storeId.value)
      .maybeSingle();
    if (se || !s) {
      toast.error(se?.message ?? "Store not found.");
      if (!silent) store.value = null;
      return;
    }
    if (s.owner_id !== sessionUserId.value && !isPlatformStaff.value) {
      toast.error("You do not manage this store.");
      store.value = null;
      return;
    }
    store.value = {
      id: s.id,
      slug: s.slug,
      name: s.name,
      whatsapp_phone_e164: s.whatsapp_phone_e164,
      owner_id: s.owner_id,
      logo_path: s.logo_path?.trim() || null,
    };

    const { data: p } = await supabase
      .from("products")
      .select("id, title, description, price_cents, is_published, image_paths")
      .eq("store_id", s.id)
      .order("created_at", { ascending: false });
    products.value = (p ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      description:
        typeof row.description === "string" && row.description.trim()
          ? row.description.trim()
          : null,
      price_cents: row.price_cents,
      is_published: row.is_published,
      image_paths: Array.isArray(row.image_paths)
        ? (row.image_paths as string[])
        : [],
    })) as typeof products.value;

    const { data: o } = await supabase
      .from("orders")
      .select(
        "id, status, created_at, guest_name, guest_email, delivery_address, customer_id",
      )
      .eq("store_id", s.id)
      .order("created_at", { ascending: false })
      .limit(50);
    orders.value = (o ?? []) as typeof orders.value;
    for (const ord of orders.value) ensureDeliveryForm(ord.id);

    const { data: tk } = await supabase
      .from("support_tickets")
      .select("id, subject, message, status, created_at")
      .eq("store_id", s.id)
      .order("created_at", { ascending: false })
      .limit(30);
    tickets.value = (tk ?? []) as typeof tickets.value;
  } finally {
    if (!silent) loading.value = false;
  }
}

onMounted(() => {
  document.addEventListener("keydown", onStoreManageDocKeydown);
  void loadAll();
});
watch(storeId, () => {
  void loadAll();
});

useRealtimeTableRefresh({
  channelName: () => `store-manage-${storeId.value}`,
  deps: [storeId, sessionUserId, isPlatformStaff],
  getTables: () => {
    const id = storeId.value;
    if (!id) return [];
    return [
      { table: "stores", filter: `id=eq.${id}` },
      { table: "products", filter: `store_id=eq.${id}` },
      { table: "orders", filter: `store_id=eq.${id}` },
      { table: "support_tickets", filter: `store_id=eq.${id}` },
    ];
  },
  onEvent: () => loadAll({ silent: true }),
});

async function addProduct() {
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
    const { error } = await supabase.from("products").insert({
      store_id: store.value.id,
      title: newTitle.value.trim(),
      description: newDesc.value.trim() || null,
      price_cents: cents,
      image_paths: paths,
      is_published: newPublished.value,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    closeAddProductModal();
    toast.success("Product added.");
    await loadAll();
  } finally {
    productBusy.value = false;
  }
}

async function togglePublish(p: (typeof products.value)[0]) {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase
    .from("products")
    .update({ is_published: !p.is_published })
    .eq("id", p.id);
  if (error) toast.error(error.message);
  else {
    toast.success(
      p.is_published ? "Product unpublished." : "Product published.",
    );
    await loadAll();
  }
}

async function setOrderStatus(orderId: string, status: string) {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase
    .from("orders")
    .update({ status })
    .eq("id", orderId);
  if (error) toast.error(error.message);
  else {
    toast.success("Order status updated.");
    await loadAll();
  }
}

async function saveDelivery(orderId: string) {
  const f = deliveryForms.value[orderId];
  if (!f) return;
  const supabase = getSupabaseBrowser();
  const lat = f.last_latitude.trim() ? Number(f.last_latitude) : null;
  const lng = f.last_longitude.trim() ? Number(f.last_longitude) : null;
  const { error } = await supabase.from("delivery_tracking").upsert(
    {
      order_id: orderId,
      stage: f.stage,
      last_message: f.last_message.trim() || null,
      last_latitude: lat,
      last_longitude: lng,
    },
    { onConflict: "order_id" },
  );
  if (error) toast.error(error.message);
  else toast.success("Delivery update saved.");
}

async function submitSupportTicket() {
  if (!store.value || !sessionUserId.value) return;
  if (!ticketSubject.value.trim() || !ticketMessage.value.trim()) return;
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
    toast.success("Support ticket sent.");
    await loadAll();
  }
}

async function startPaystack() {
  if (!store.value) return;
  payBusy.value = true;
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.functions.invoke("paystack-init", {
    body: { store_id: store.value.id },
  });
  payBusy.value = false;
  if (error) {
    toast.error(error.message);
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
              <p class="mt-2 text-sm text-zinc-600">
                Public shop
                <RouterLink
                  :to="`/${store.slug}`"
                  class="font-semibold text-teal-700 hover:text-teal-900"
                  >/{{ store.slug }}</RouterLink
                >
              </p>
              <p
                v-if="isStoreOwner && !hasSelectedPlan && !isSuperAdmin"
                class="mt-2 text-xs font-medium leading-snug text-amber-900/90"
              >
                Choose a plan on the dashboard to upload a shop logo.
              </p>
            </div>
          </div>
          <button
            type="button"
            class="rounded-full border border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-2.5 text-sm font-semibold text-amber-950 shadow-sm ring-1 ring-amber-200/50 transition hover:from-amber-100 hover:to-orange-100 disabled:opacity-50"
            :disabled="payBusy"
            @click="startPaystack"
          >
            Pay subscription (Paystack test)
          </button>
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
          class="flex max-h-[55dvh] min-h-0 flex-col overflow-hidden rounded-3xl border border-zinc-200/70 bg-white/90 shadow-[0_16px_48px_-28px_rgba(15,23,42,0.14)] ring-1 ring-zinc-100/80 backdrop-blur-md"
        >
          <div
            class="hidden shrink-0 grid-cols-[5.5rem_minmax(0,1fr)_7.5rem_5.5rem_11rem] gap-3 border-b border-zinc-200 bg-zinc-50/95 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-zinc-500 lg:grid"
          >
            <span>Photo</span>
            <span class="text-left">
              <span class="block">Product</span>
              <span
                class="mt-0.5 block text-[10px] font-semibold normal-case tracking-normal text-zinc-400"
                >Description</span
              >
            </span>
            <span class="text-right">Price</span>
            <span>Status</span>
            <span class="text-right">Actions</span>
          </div>
          <ul
            v-if="products.length"
            class="min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
          >
            <li
              v-for="p in products"
              :key="p.id"
              class="border-b border-zinc-200 transition last:border-b-0 hover:bg-zinc-50/60"
            >
              <div
                class="flex flex-col gap-4 p-4 lg:grid lg:grid-cols-[5.5rem_minmax(0,1fr)_7.5rem_5.5rem_11rem] lg:items-start lg:gap-4"
              >
                <div
                  class="mx-auto flex h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-zinc-200/80 bg-zinc-100 shadow-inner lg:mx-0 lg:h-20 lg:w-20"
                >
                  <img
                    v-if="productCoverPublicUrl(p.image_paths?.[0])"
                    :src="productCoverPublicUrl(p.image_paths[0])!"
                    alt=""
                    class="h-full w-full object-cover"
                    loading="lazy"
                    @error="
                      ($event.target as HTMLImageElement).style.display = 'none'
                    "
                  />
                  <div
                    v-else
                    class="flex h-full w-full items-center justify-center text-zinc-300"
                    aria-hidden="true"
                  >
                    <svg
                      class="h-9 w-9 opacity-60"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                    </svg>
                  </div>
                </div>
                <div class="min-w-0 text-center lg:text-left">
                  <p class="font-semibold text-zinc-900">{{ p.title }}</p>
                  <p
                    v-if="p.description"
                    class="mt-1 whitespace-pre-wrap text-left text-sm leading-snug text-zinc-600 line-clamp-3"
                  >
                    {{ p.description }}
                  </p>
                  <p class="mt-1 text-sm text-zinc-600 lg:hidden">
                    {{ formatGhs(p.price_cents) }}
                  </p>
                  <p class="mt-1 lg:hidden">
                    <span
                      class="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      :class="
                        p.is_published
                          ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80'
                          : 'bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200/80'
                      "
                    >
                      {{ p.is_published ? "Live" : "Draft" }}
                    </span>
                  </p>
                </div>
                <p
                  class="hidden self-center text-right text-sm font-semibold tabular-nums text-zinc-800 lg:block"
                >
                  {{ formatGhs(p.price_cents) }}
                </p>
                <div class="hidden self-center lg:block">
                  <span
                    class="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    :class="
                      p.is_published
                        ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80'
                        : 'bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200/80'
                    "
                  >
                    {{ p.is_published ? "Live" : "Draft" }}
                  </span>
                </div>
                <div
                  class="flex flex-wrap justify-center gap-2 self-center lg:justify-end"
                >
                  <button
                    type="button"
                    class="rounded-full border border-teal-200/80 bg-teal-50/90 px-3 py-1.5 text-sm font-semibold text-teal-900 transition hover:bg-teal-100"
                    @click="togglePublish(p)"
                  >
                    {{ p.is_published ? "Unpublish" : "Publish" }}
                  </button>
                  <button
                    type="button"
                    class="rounded-full border border-rose-200/80 bg-rose-50/90 px-3 py-1.5 text-sm font-semibold text-rose-800 transition hover:bg-rose-100"
                    @click="openDeleteProductDialog(p.id)"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          </ul>
          <p
            v-else
            class="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-12 text-center text-sm text-zinc-500"
          >
            No products yet. Add one with the button above.
          </p>
        </div>
      </section>

      <section v-show="tab === 'orders'" class="space-y-6">
        <div
          v-for="ord in orders"
          :key="ord.id"
          class="rounded-3xl border border-white/60 bg-white/70 p-6 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.14)] backdrop-blur-xl"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="font-mono text-xs text-zinc-500">{{ ord.id }}</p>
              <p class="text-sm text-zinc-700">
                <template v-if="ord.customer_id"
                  >Registered buyer (account)</template
                >
                <template v-else>
                  {{ ord.guest_name ?? "Guest" }} · {{ ord.guest_email ?? "—" }}
                </template>
              </p>
              <p v-if="ord.delivery_address" class="mt-1 text-sm text-zinc-600">
                {{ ord.delivery_address }}
              </p>
            </div>
            <div>
              <label
                class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
                >Order status</label
              >
              <select
                class="mt-1.5 block w-full min-w-[10rem] rounded-2xl border border-zinc-200/80 bg-white/90 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-teal-300 focus:ring-4 focus:ring-teal-500/15"
                :value="ord.status"
                @change="
                  setOrderStatus(
                    ord.id,
                    ($event.target as HTMLSelectElement).value,
                  )
                "
              >
                <option value="pending">pending</option>
                <option value="confirmed">confirmed</option>
                <option value="preparing">preparing</option>
                <option value="out_for_delivery">out_for_delivery</option>
                <option value="delivered">delivered</option>
                <option value="canceled">canceled</option>
              </select>
            </div>
          </div>
          <div
            v-if="deliveryForms[ord.id]"
            class="mt-5 border-t border-zinc-100/80 pt-5"
          >
            <h3 class="text-sm font-bold text-zinc-900">Delivery tracking</h3>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label class="text-xs font-medium text-zinc-500">Stage</label>
                <select
                  v-model="deliveryForms[ord.id].stage"
                  class="mt-1 w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-3 py-2 text-sm outline-none focus:border-teal-300 focus:ring-4 focus:ring-teal-500/15"
                >
                  <option value="pending">pending</option>
                  <option value="picked_up">picked_up</option>
                  <option value="in_transit">in_transit</option>
                  <option value="delivered">delivered</option>
                </select>
              </div>
              <div class="sm:col-span-2">
                <label class="text-xs font-medium text-zinc-500"
                  >Message to customer</label
                >
                <input
                  v-model="deliveryForms[ord.id].last_message"
                  type="text"
                  class="mt-1 w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-3 py-2 text-sm outline-none focus:border-teal-300 focus:ring-4 focus:ring-teal-500/15"
                />
              </div>
              <div>
                <label class="text-xs font-medium text-zinc-500"
                  >Latitude</label
                >
                <input
                  v-model="deliveryForms[ord.id].last_latitude"
                  type="text"
                  class="mt-1 w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-3 py-2 text-sm outline-none focus:border-teal-300 focus:ring-4 focus:ring-teal-500/15"
                />
              </div>
              <div>
                <label class="text-xs font-medium text-zinc-500"
                  >Longitude</label
                >
                <input
                  v-model="deliveryForms[ord.id].last_longitude"
                  type="text"
                  class="mt-1 w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-3 py-2 text-sm outline-none focus:border-teal-300 focus:ring-4 focus:ring-teal-500/15"
                />
              </div>
            </div>
            <button
              type="button"
              class="mt-4 rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-zinc-800"
              @click="saveDelivery(ord.id)"
            >
              Save tracking
            </button>
          </div>
        </div>
        <p v-if="!orders.length" class="text-sm text-zinc-500">
          No orders yet.
        </p>
      </section>

      <section v-show="tab === 'support'" class="space-y-6">
        <div
          class="rounded-3xl border border-white/60 bg-white/70 p-6 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.14)] backdrop-blur-xl"
        >
          <h2 class="text-lg font-bold text-zinc-900">Contact platform</h2>
          <p class="mt-2 text-xs leading-relaxed text-zinc-600">
            Opens a support ticket visible to the super admin.
          </p>
          <div class="mt-4 space-y-3">
            <input
              v-model="ticketSubject"
              type="text"
              placeholder="Subject"
              class="w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-2.5 text-sm outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-500/15"
            />
            <textarea
              v-model="ticketMessage"
              rows="4"
              placeholder="Describe the issue"
              class="w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-2.5 text-sm outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-500/15"
            />
            <button
              type="button"
              class="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-zinc-800 disabled:opacity-50"
              :disabled="ticketBusy"
              @click="submitSupportTicket"
            >
              Submit ticket
            </button>
          </div>
        </div>
        <ul class="space-y-3">
          <li
            v-for="t in tickets"
            :key="t.id"
            class="rounded-3xl border border-violet-100/80 bg-gradient-to-br from-violet-50/80 to-white/70 px-4 py-3 text-sm shadow-sm backdrop-blur-sm"
          >
            <p class="font-semibold text-zinc-900">{{ t.subject }}</p>
            <p class="text-xs text-zinc-500">
              {{ t.status }} · {{ new Date(t.created_at).toLocaleString() }}
            </p>
            <p class="mt-2 text-zinc-600 whitespace-pre-wrap">
              {{ t.message }}
            </p>
          </li>
        </ul>
        <p v-if="!tickets.length" class="text-sm text-zinc-500">
          No tickets yet for this store.
        </p>
      </section>

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
    </template>
  </div>
</template>

<style scoped>
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
