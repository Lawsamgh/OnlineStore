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
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { resolveStoreThemeTokens } from "../../constants/storeThemes";
import { useRealtimeTableRefresh } from "../../composables/useRealtimeTableRefresh";
import {
  lookupBuyerOrderStatus,
  lookupBuyerReviewableItems,
  submitBuyerProductReview,
  type BuyerReviewableOrderItem,
  type BuyerOrderTrackingRow,
} from "../../composables/useBuyerOrderTracking";
import { useToastStore } from "../../stores/toast";

const route = useRoute();
const router = useRouter();
const toast = useToastStore();

const slug = computed(() => String(route.params.storeSlug ?? ""));

const orderRefInput = ref("");
const verifyInput = ref("");
const loading = ref(false);
const result = ref<BuyerOrderTrackingRow | null>(null);
const lastLookup = ref<{ orderRef: string; verify: string } | null>(null);
const reviewableItems = ref<BuyerReviewableOrderItem[]>([]);
const reviewBusyByProductId = ref<Record<string, boolean>>({});
const reviewRatingByProductId = ref<Record<string, number>>({});
const reviewCommentByProductId = ref<Record<string, string>>({});
const reviewNameByProductId = ref<Record<string, string>>({});

const trackingSectionRef = ref<HTMLElement | null>(null);

const store = ref<{
  id: string;
  slug: string;
  name: string;
  theme_id: string | null;
  theme_primary_color: string | null;
  theme_accent_color: string | null;
  theme_bg_color: string | null;
  theme_surface_color: string | null;
  theme_text_color: string | null;
  theme_font_family: string | null;
} | null>(null);

const storefrontTheme = computed(() =>
  resolveStoreThemeTokens(store.value ?? {}),
);

const ORDER_STEPS = [
  { id: "pending", label: "Received", short: "Received" },
  { id: "confirmed", label: "Confirmed", short: "Confirmed" },
  { id: "preparing", label: "Preparing", short: "Prep" },
  { id: "out_for_delivery", label: "Out for delivery", short: "Transit" },
  { id: "delivered", label: "Delivered", short: "Done" },
] as const;

const DELIVERY_STEPS = [
  { id: "pending", label: "Awaiting pickup" },
  { id: "picked_up", label: "Picked up" },
  { id: "in_transit", label: "In transit" },
  { id: "delivered", label: "Driver delivered" },
] as const;

function stepIndex(status: string): number {
  const i = ORDER_STEPS.findIndex((s) => s.id === status);
  return i >= 0 ? i : 0;
}

function deliveryStepIndex(stage: string): number {
  const i = DELIVERY_STEPS.findIndex((s) => s.id === stage);
  return i >= 0 ? i : 0;
}

const currentStepIdx = computed(() =>
  result.value ? stepIndex(result.value.status) : 0,
);

const deliveryIdx = computed(() =>
  result.value ? deliveryStepIndex(result.value.delivery_stage) : 0,
);

const isCanceled = computed(() => result.value?.status === "canceled");
const canReviewOrder = computed(() => result.value?.status === "delivered");
const reviewTotalCount = computed(() => reviewableItems.value.length);
const reviewedCount = computed(
  () => reviewableItems.value.filter((i) => i.already_reviewed).length,
);
const reviewCompletionPct = computed(() => {
  if (reviewTotalCount.value <= 0) return 0;
  return Math.round((reviewedCount.value / reviewTotalCount.value) * 100);
});

const fulfillmentProgressPct = computed(() => {
  const max = ORDER_STEPS.length - 1;
  if (max <= 0) return 0;
  return Math.round((currentStepIdx.value / max) * 100);
});

function formatWhen(iso: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function reviewRatingLabel(n: number): string {
  if (n <= 1) return "Poor";
  if (n === 2) return "Fair";
  if (n === 3) return "Good";
  if (n === 4) return "Very good";
  return "Excellent";
}

async function loadStore(opts?: { silent?: boolean }) {
  const silent = opts?.silent ?? false;
  if (!isSupabaseConfigured() || !slug.value) {
    store.value = null;
    return;
  }
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from("stores")
    .select(
      "id, slug, name, theme_id, theme_primary_color, theme_accent_color, theme_bg_color, theme_surface_color, theme_text_color, theme_font_family",
    )
    .eq("slug", slug.value)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) {
    if (!silent) toast.error(error?.message ?? "Store not found.");
    store.value = null;
    return;
  }
  store.value = {
    id: String(data.id),
    slug: String(data.slug),
    name: String(data.name),
    theme_id:
      typeof data.theme_id === "string" && data.theme_id.trim()
        ? data.theme_id.trim()
        : null,
    theme_primary_color:
      typeof data.theme_primary_color === "string" &&
      data.theme_primary_color.trim()
        ? data.theme_primary_color.trim()
        : null,
    theme_accent_color:
      typeof data.theme_accent_color === "string" &&
      data.theme_accent_color.trim()
        ? data.theme_accent_color.trim()
        : null,
    theme_bg_color:
      typeof data.theme_bg_color === "string" && data.theme_bg_color.trim()
        ? data.theme_bg_color.trim()
        : null,
    theme_surface_color:
      typeof data.theme_surface_color === "string" &&
      data.theme_surface_color.trim()
        ? data.theme_surface_color.trim()
        : null,
    theme_text_color:
      typeof data.theme_text_color === "string" && data.theme_text_color.trim()
        ? data.theme_text_color.trim()
        : null,
    theme_font_family:
      typeof data.theme_font_family === "string" &&
      data.theme_font_family.trim()
        ? data.theme_font_family.trim()
        : null,
  };
}

async function runLookup(silent: boolean) {
  if (!store.value || !slug.value) return;
  const ref = orderRefInput.value.trim();
  const verify = verifyInput.value.trim();
  if (!ref || !verify) {
    if (!silent) toast.error("Enter your order number and email or phone.");
    return;
  }
  if (!silent) loading.value = true;
  try {
    const { row, error } = await lookupBuyerOrderStatus({
      storeSlug: slug.value,
      orderRef: ref,
      verify,
    });
    if (error) {
      if (!silent) toast.error(error);
      result.value = null;
      lastLookup.value = null;
      return;
    }
    if (!row) {
      if (!silent) {
        toast.error(
          "No match. Check your order number and use the same email or phone you used at checkout.",
        );
      }
      result.value = null;
      lastLookup.value = null;
      return;
    }
    result.value = row;
    lastLookup.value = { orderRef: ref, verify };
    await loadReviewableItemsForCurrentOrder();
  } finally {
    if (!silent) loading.value = false;
  }
}

async function loadReviewableItemsForCurrentOrder() {
  if (!canReviewOrder.value || !lastLookup.value || !slug.value) {
    reviewableItems.value = [];
    return;
  }
  const { items, error } = await lookupBuyerReviewableItems({
    storeSlug: slug.value,
    orderRef: lastLookup.value.orderRef,
    verify: lastLookup.value.verify,
  });
  if (error) {
    reviewableItems.value = [];
    toast.error(error);
    return;
  }
  reviewableItems.value = items;
  const nextRating: Record<string, number> = {};
  const nextComment: Record<string, string> = {};
  const nextName: Record<string, string> = {};
  for (const item of items) {
    nextRating[item.product_id] = item.existing_rating ?? 5;
    nextComment[item.product_id] = item.existing_comment ?? "";
    nextName[item.product_id] = item.existing_reviewer_name ?? "";
  }
  reviewRatingByProductId.value = nextRating;
  reviewCommentByProductId.value = nextComment;
  reviewNameByProductId.value = nextName;
}

async function submitReviewForProduct(productId: string) {
  if (!lastLookup.value || !slug.value) return;
  if ((reviewBusyByProductId.value[productId] ?? false) === true) return;
  const rating = reviewRatingByProductId.value[productId] ?? 0;
  if (rating < 1 || rating > 5) {
    toast.error("Pick a rating between 1 and 5 stars.");
    return;
  }
  reviewBusyByProductId.value = {
    ...reviewBusyByProductId.value,
    [productId]: true,
  };
  try {
    const res = await submitBuyerProductReview({
      storeSlug: slug.value,
      orderRef: lastLookup.value.orderRef,
      verify: lastLookup.value.verify,
      productId,
      rating,
      comment: reviewCommentByProductId.value[productId] ?? "",
      reviewerName: reviewNameByProductId.value[productId] ?? "",
    });
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Review saved.");
    await nextTick();
    await router.push({ path: `/${slug.value}` });
  } finally {
    reviewBusyByProductId.value = {
      ...reviewBusyByProductId.value,
      [productId]: false,
    };
  }
}

async function onSubmit() {
  await runLookup(false);
  if (!result.value) return;
  await nextTick();
  requestAnimationFrame(() => {
    trackingSectionRef.value?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

let pollId: ReturnType<typeof setInterval> | null = null;

function startPolling() {
  stopPolling();
  pollId = setInterval(() => {
    if (!lastLookup.value || isCanceled.value) return;
    void runLookup(true);
  }, 15000);
}

function stopPolling() {
  if (pollId) {
    clearInterval(pollId);
    pollId = null;
  }
}

watch(
  () => result.value,
  (r) => {
    stopPolling();
    if (!r || r.status === "canceled" || r.status === "delivered") return;
    startPolling();
  },
);

onMounted(() => {
  void loadStore();
  const q = route.query.ref;
  if (typeof q === "string" && q.trim()) {
    orderRefInput.value = q.trim();
  }
});

watch(slug, () => {
  void loadStore();
  result.value = null;
  lastLookup.value = null;
  reviewableItems.value = [];
});

useRealtimeTableRefresh({
  channelName: () =>
    `storefront-track:${slug.value}:${store.value?.id ?? "pending"}`,
  deps: [slug, () => store.value?.id ?? ""],
  debounceMs: 400,
  getTables: () => {
    const id = store.value?.id;
    if (!id) return [];
    return [{ table: "stores", filter: `id=eq.${id}` }];
  },
  onEvent: () => loadStore({ silent: true }),
});

onBeforeUnmount(() => {
  stopPolling();
});
</script>

<template>
  <div
    class="relative min-h-svh overflow-hidden"
    :style="{
      backgroundColor: storefrontTheme.bg,
      fontFamily: storefrontTheme.fontFamily,
    }"
  >
    <!-- Ambient orbs -->
    <div
      class="pointer-events-none absolute -left-32 top-0 h-96 w-96 rounded-full opacity-40 blur-3xl"
      :style="{ backgroundColor: `${storefrontTheme.primary}55` }"
    />
    <div
      class="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full opacity-30 blur-3xl"
      :style="{
        backgroundColor: `${storefrontTheme.accent ?? storefrontTheme.primary}44`,
      }"
    />

    <div class="relative mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      <RouterLink
        :to="`/${slug}`"
        class="inline-flex items-center gap-2 text-sm font-medium opacity-70 transition hover:opacity-100"
        :style="{ color: storefrontTheme.muted }"
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
          <path d="m15 18-6-6 6-6" />
        </svg>
        Back to {{ store?.name ?? "shop" }}
      </RouterLink>

      <div class="mt-8 text-center sm:mt-10">
        <p
          class="text-[11px] font-bold uppercase tracking-[0.2em] opacity-80"
          :style="{ color: storefrontTheme.primary }"
        >
          Delivery tracker
        </p>
        <h1
          class="mt-2 text-3xl font-black tracking-tight sm:text-4xl"
          :style="{ color: storefrontTheme.text }"
        >
          Track your order
        </h1>
        <p
          class="mx-auto mt-2 max-w-md text-sm leading-relaxed opacity-80"
          :style="{ color: storefrontTheme.muted }"
        >
          Enter your order reference and the email or phone number you used at
          checkout.
        </p>
      </div>

      <!-- Glass form card -->
      <div
        class="mt-10 rounded-[1.75rem] border p-6 shadow-2xl backdrop-blur-2xl sm:p-8"
        :style="{
          borderColor: storefrontTheme.border,
          backgroundColor: `${storefrontTheme.surface}cc`,
          boxShadow: `0 25px 80px -20px ${storefrontTheme.text}18`,
        }"
      >
        <form class="space-y-5" @submit.prevent="onSubmit">
          <div>
            <label
              class="mb-2 block text-xs font-bold uppercase tracking-wider opacity-70"
              :style="{ color: storefrontTheme.text }"
              for="track-ref"
              >Order number</label
            >
            <input
              id="track-ref"
              v-model="orderRefInput"
              type="text"
              autocomplete="off"
              placeholder="ORD-XXXX-YYYY"
              :disabled="loading"
              class="w-full rounded-2xl border px-4 py-3.5 font-mono text-base font-semibold tracking-wide shadow-inner outline-none transition focus:ring-2 disabled:opacity-50"
              :style="{
                borderColor: storefrontTheme.border,
                backgroundColor: storefrontTheme.bg,
                color: storefrontTheme.text,
                '--tw-ring-color': `${storefrontTheme.primary}55`,
              }"
            />
          </div>
          <div>
            <label
              class="mb-2 block text-xs font-bold uppercase tracking-wider opacity-70"
              :style="{ color: storefrontTheme.text }"
              for="track-verify"
              >Email or phone</label
            >
            <input
              id="track-verify"
              v-model="verifyInput"
              type="text"
              autocomplete="email"
              placeholder="name@example.com  or  +233 XX XXX XXXX"
              :disabled="loading"
              class="w-full rounded-2xl border px-4 py-3.5 text-sm shadow-inner outline-none transition focus:ring-2 disabled:opacity-50"
              :style="{
                borderColor: storefrontTheme.border,
                backgroundColor: storefrontTheme.bg,
                color: storefrontTheme.text,
                '--tw-ring-color': `${storefrontTheme.primary}55`,
              }"
            />
            <div
              class="mt-2 space-y-1.5 rounded-xl border px-3 py-2.5 text-[11px] leading-snug sm:text-xs"
              :style="{
                borderColor: storefrontTheme.border,
                backgroundColor: `${storefrontTheme.bg}cc`,
                color: storefrontTheme.muted,
              }"
            >
              <p :style="{ color: storefrontTheme.text }">
                <span class="font-semibold">Email:</span>
                same address you used at checkout (capital letters don’t
                matter).
              </p>
              <p :style="{ color: storefrontTheme.text }">
                <span class="font-semibold">Phone:</span>
                use the same number as at checkout, with country code. Examples:
                <span
                  class="whitespace-nowrap font-mono text-[10px] font-semibold sm:text-[11px]"
                  :style="{ color: storefrontTheme.primary }"
                  >+233&nbsp;XX&nbsp;XXX&nbsp;XXXX</span
                >,
                <span
                  class="whitespace-nowrap font-mono text-[10px] font-semibold sm:text-[11px]"
                  :style="{ color: storefrontTheme.primary }"
                  >+233XXXXXXXX</span
                >, or digits only
                <span
                  class="whitespace-nowrap font-mono text-[10px] font-semibold sm:text-[11px]"
                  :style="{ color: storefrontTheme.primary }"
                  >233XXXXXXXX</span
                >
                — spaces and “+” are ignored; only the digits must match
                checkout.
              </p>
            </div>
          </div>
          <button
            type="submit"
            class="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold tracking-wide text-white shadow-lg transition active:scale-[0.99] disabled:opacity-50"
            :style="{
              backgroundColor: storefrontTheme.primary,
              color: storefrontTheme.primaryText,
              boxShadow: `0 12px 40px -10px ${storefrontTheme.primary}99`,
            }"
            :disabled="loading"
          >
            <svg
              v-if="loading"
              class="h-5 w-5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
            <template v-else>
              <svg
                class="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </template>
            {{ loading ? "Looking up…" : "Show status" }}
          </button>
        </form>

        <!-- Result -->
        <div
          v-if="result"
          ref="trackingSectionRef"
          class="mt-8 scroll-mt-24 border-t pt-8 sm:scroll-mt-28"
          :style="{ borderColor: storefrontTheme.border }"
          tabindex="-1"
        >
          <div
            v-if="isCanceled"
            class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm font-semibold text-red-800"
          >
            This order was canceled.
          </div>

          <div v-else class="flex flex-col items-center gap-2 text-center">
            <p
              class="text-xs font-bold uppercase tracking-widest opacity-60"
              :style="{ color: storefrontTheme.muted }"
            >
              Order reference
            </p>
            <p
              class="font-mono text-2xl font-black tracking-tight sm:text-3xl"
              :style="{ color: storefrontTheme.text }"
            >
              {{ result.order_ref }}
            </p>
            <span
              class="mt-1 inline-flex items-center rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide"
              :style="{
                backgroundColor: `${storefrontTheme.primary}22`,
                color: storefrontTheme.primary,
              }"
            >
              {{ result.status.replace(/_/g, " ") }}
            </span>
          </div>

          <!-- Fulfillment timeline -->
          <div v-if="!isCanceled" class="mt-10">
            <p
              class="mb-4 text-center text-xs font-bold uppercase tracking-wider opacity-60"
              :style="{ color: storefrontTheme.muted }"
            >
              Fulfillment
            </p>
            <div class="relative flex justify-between gap-1 px-1 sm:gap-2">
              <div
                class="absolute left-4 right-4 top-4 h-1 overflow-hidden rounded-full sm:left-5 sm:right-5"
                :style="{ backgroundColor: storefrontTheme.border }"
              >
                <div
                  class="h-full rounded-full transition-all duration-700 ease-out"
                  :style="{
                    width: `${fulfillmentProgressPct}%`,
                    backgroundColor: storefrontTheme.primary,
                  }"
                />
              </div>
              <div
                v-for="(step, idx) in ORDER_STEPS"
                :key="step.id"
                class="relative z-10 flex flex-1 flex-col items-center"
              >
                <div
                  class="flex h-9 w-9 items-center justify-center rounded-full border-2 text-[10px] font-bold transition sm:h-10 sm:w-10 sm:text-xs"
                  :class="
                    idx <= currentStepIdx
                      ? 'border-transparent text-white'
                      : 'bg-white/80'
                  "
                  :style="
                    idx <= currentStepIdx
                      ? {
                          backgroundColor: storefrontTheme.primary,
                          color: storefrontTheme.primaryText,
                        }
                      : {
                          borderColor: storefrontTheme.border,
                          color: storefrontTheme.muted,
                        }
                  "
                >
                  <template v-if="idx < currentStepIdx">✓</template>
                  <template v-else>{{ idx + 1 }}</template>
                </div>
                <span
                  class="mt-2 hidden text-center text-[10px] font-semibold leading-tight sm:block sm:text-[11px]"
                  :style="{
                    color:
                      idx <= currentStepIdx
                        ? storefrontTheme.text
                        : storefrontTheme.muted,
                  }"
                  >{{ step.label }}</span
                >
                <span
                  class="mt-2 text-center text-[9px] font-semibold leading-tight sm:hidden"
                  :style="{
                    color:
                      idx <= currentStepIdx
                        ? storefrontTheme.text
                        : storefrontTheme.muted,
                  }"
                  >{{ step.short }}</span
                >
              </div>
            </div>
          </div>

          <!-- Delivery driver stage -->
          <div v-if="!isCanceled" class="mt-10">
            <p
              class="mb-3 text-center text-xs font-bold uppercase tracking-wider opacity-60"
              :style="{ color: storefrontTheme.muted }"
            >
              Delivery route
            </p>
            <div class="flex flex-wrap justify-center gap-2">
              <span
                v-for="(ds, idx) in DELIVERY_STEPS"
                :key="ds.id"
                class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
                :style="
                  idx <= deliveryIdx
                    ? {
                        backgroundColor: storefrontTheme.primary,
                        color: storefrontTheme.primaryText,
                      }
                    : {
                        backgroundColor: storefrontTheme.bg,
                        color: storefrontTheme.muted,
                        border: `1px solid ${storefrontTheme.border}`,
                      }
                "
                >{{ ds.label }}</span
              >
            </div>
            <p
              class="mt-3 text-center text-[11px] opacity-60"
              :style="{ color: storefrontTheme.muted }"
            >
              Route updates automatically from seller order status changes.
            </p>
          </div>

          <dl
            class="mt-8 grid grid-cols-2 gap-3 rounded-2xl border p-4 text-sm sm:grid-cols-4"
            :style="{
              borderColor: storefrontTheme.border,
              backgroundColor: `${storefrontTheme.bg}99`,
            }"
          >
            <div>
              <dt
                class="text-[10px] font-bold uppercase opacity-50"
                :style="{ color: storefrontTheme.muted }"
              >
                Placed
              </dt>
              <dd
                class="mt-0.5 font-semibold"
                :style="{ color: storefrontTheme.text }"
              >
                {{ formatWhen(result.created_at) }}
              </dd>
            </div>
            <div>
              <dt
                class="text-[10px] font-bold uppercase opacity-50"
                :style="{ color: storefrontTheme.muted }"
              >
                Updated
              </dt>
              <dd
                class="mt-0.5 font-semibold"
                :style="{ color: storefrontTheme.text }"
              >
                {{ formatWhen(result.updated_at) }}
              </dd>
            </div>
            <div>
              <dt
                class="text-[10px] font-bold uppercase opacity-50"
                :style="{ color: storefrontTheme.muted }"
              >
                Line items
              </dt>
              <dd
                class="mt-0.5 font-semibold"
                :style="{ color: storefrontTheme.text }"
              >
                {{ result.item_count }}
              </dd>
            </div>
            <div>
              <dt
                class="text-[10px] font-bold uppercase opacity-50"
                :style="{ color: storefrontTheme.muted }"
              >
                Units
              </dt>
              <dd
                class="mt-0.5 font-semibold"
                :style="{ color: storefrontTheme.text }"
              >
                {{ result.item_units }}
              </dd>
            </div>
          </dl>

          <div
            v-if="canReviewOrder"
            class="mt-8 rounded-3xl border p-5 shadow-sm sm:p-6"
            :style="{
              borderColor: storefrontTheme.border,
              backgroundColor: `${storefrontTheme.surface}e6`,
            }"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3
                  class="text-sm font-extrabold uppercase tracking-wide"
                  :style="{ color: storefrontTheme.text }"
                >
                  Rate purchased products
                </h3>
                <p class="mt-1 text-xs" :style="{ color: storefrontTheme.muted }">
                  Share a quick rating and comment for items in this delivered order.
                </p>
                <p
                  v-if="reviewTotalCount > 0"
                  class="mt-1 text-[11px] font-semibold"
                  :style="{ color: storefrontTheme.muted }"
                >
                  {{ reviewedCount }}/{{ reviewTotalCount }} reviewed
                </p>
              </div>
              <RouterLink
                :to="`/${slug}`"
                class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-bold transition hover:opacity-80"
                :style="{
                  color: storefrontTheme.primary,
                  borderColor: storefrontTheme.border,
                  backgroundColor: storefrontTheme.bg,
                }"
              >
                <svg
                  class="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.25"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 7h10m0 0v10m0-10L6 19" />
                </svg>
                Continue shopping
              </RouterLink>
            </div>

            <div
              v-if="reviewTotalCount > 0"
              class="mt-3 h-2 w-full overflow-hidden rounded-full"
              :style="{ backgroundColor: storefrontTheme.border }"
              aria-label="Review completion"
            >
              <div
                class="h-full rounded-full transition-[width] duration-300"
                :style="{
                  width: `${reviewCompletionPct}%`,
                  backgroundColor: storefrontTheme.primary,
                }"
              />
            </div>

            <div v-if="reviewableItems.length" class="mt-4 space-y-3">
              <div
                v-for="item in reviewableItems"
                :key="item.product_id"
                class="rounded-2xl border p-4 sm:p-5"
                :style="{
                  borderColor: storefrontTheme.border,
                  backgroundColor: storefrontTheme.bg,
                }"
              >
                <div class="flex items-start justify-between gap-3">
                  <p class="text-sm font-semibold" :style="{ color: storefrontTheme.text }">
                    {{ item.product_title }}
                  </p>
                  <span
                    v-if="item.already_reviewed"
                    class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    :style="{
                      backgroundColor: `${storefrontTheme.primary}22`,
                      color: storefrontTheme.primary,
                    }"
                  >
                    Reviewed
                  </span>
                </div>

                <div class="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    v-for="star in 5"
                    :key="`${item.product_id}-star-${star}`"
                    type="button"
                    class="inline-flex h-9 w-9 items-center justify-center rounded-xl text-lg font-bold transition duration-150"
                    :style="
                      (reviewRatingByProductId[item.product_id] ?? 0) >= star
                        ? {
                            backgroundColor: storefrontTheme.primary,
                            color: storefrontTheme.primaryText,
                          }
                        : {
                            backgroundColor: storefrontTheme.bg,
                            color: storefrontTheme.muted,
                            border: `1px solid ${storefrontTheme.border}`,
                          }
                    "
                    :aria-label="`Rate ${star} star${star > 1 ? 's' : ''}`"
                    @click="reviewRatingByProductId[item.product_id] = star"
                  >
                    ★
                  </button>
                  <span class="ml-1 text-xs font-semibold" :style="{ color: storefrontTheme.muted }">
                    {{ reviewRatingByProductId[item.product_id] ?? 0 }}/5 ·
                    {{ reviewRatingLabel(reviewRatingByProductId[item.product_id] ?? 0) }}
                  </span>
                </div>

                <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    v-model="reviewNameByProductId[item.product_id]"
                    type="text"
                    maxlength="60"
                    placeholder="Your name (optional)"
                    class="w-full rounded-xl border px-3 py-2 text-xs outline-none focus:ring-2"
                    :style="{
                      borderColor: storefrontTheme.border,
                      backgroundColor: storefrontTheme.surface,
                      color: storefrontTheme.text,
                      '--tw-ring-color': `${storefrontTheme.primary}55`,
                    }"
                  />
                  <textarea
                    v-model="reviewCommentByProductId[item.product_id]"
                    maxlength="220"
                    placeholder="Comment (optional)"
                    rows="2"
                    class="w-full rounded-xl border px-3 py-2 text-xs outline-none focus:ring-2 sm:col-span-1"
                    :style="{
                      borderColor: storefrontTheme.border,
                      backgroundColor: storefrontTheme.surface,
                      color: storefrontTheme.text,
                      '--tw-ring-color': `${storefrontTheme.primary}55`,
                    }"
                  />
                </div>

                <button
                  type="button"
                  class="mt-4 inline-flex min-w-[9rem] items-center justify-center rounded-xl px-4 py-2.5 text-xs font-bold shadow-sm transition hover:opacity-90 disabled:opacity-60"
                  :style="{
                    backgroundColor: storefrontTheme.primary,
                    color: storefrontTheme.primaryText,
                  }"
                  :disabled="reviewBusyByProductId[item.product_id] === true"
                  @click="void submitReviewForProduct(item.product_id)"
                >
                  {{
                    reviewBusyByProductId[item.product_id] === true
                      ? "Saving..."
                      : item.already_reviewed
                        ? "Update review"
                        : "Submit review"
                  }}
                </button>
              </div>
            </div>
            <p v-else class="mt-3 text-xs" :style="{ color: storefrontTheme.muted }">
              No reviewable products found for this order.
            </p>
          </div>
        </div>
      </div>

      <p
        class="mt-8 text-center text-xs opacity-50"
        :style="{ color: storefrontTheme.muted }"
      >
        Status refreshes automatically every 15 seconds while this page is open.
      </p>
    </div>
  </div>
</template>
