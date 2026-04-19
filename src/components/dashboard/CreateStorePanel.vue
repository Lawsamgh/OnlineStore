<script setup lang="ts">
import { Transition, computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import {
  MAX_STORES_BY_PLAN,
  maxStoresDisplayText,
  maxStoresForPlan,
  normalizeSignupPlanId,
  type PlanId,
} from "../../constants/planEntitlements";
import { PRICING_PLANS, formatGhsWhole } from "../../constants/pricingPlans";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import SkeletonCreateStoreGate from "../skeleton/SkeletonCreateStoreGate.vue";

withDefaults(
  defineProps<{
    /** `h1` on dedicated page, `h2` inside modal for heading order */
    headingLevel?: "h1" | "h2";
  }>(),
  { headingLevel: "h1" },
);

const router = useRouter();
const auth = useAuthStore();
const toast = useToastStore();
const ui = useUiStore();

const name = ref("");
const slug = ref("");
const description = ref("");
const whatsapp = ref("");
const busy = ref(false);
const gateLoading = ref(true);
const storeCount = ref(0);
const planBusy = ref(false);

const currentPlanId = computed(() =>
  normalizeSignupPlanId(
    typeof auth.user?.user_metadata?.signup_plan === "string"
      ? auth.user.user_metadata.signup_plan
      : undefined,
  ),
);

const hasSelectedPlan = computed(() => currentPlanId.value !== null);

/** Sellers need `signup_plan` before creating stores; super admins do not (platform / QA). */
const sellerNeedsPlanPicker = computed(
  () => !auth.isSuperAdmin && !hasSelectedPlan.value,
);

const maxStores = computed(() => {
  if (auth.isSuperAdmin) return 9999;
  return currentPlanId.value ? maxStoresForPlan(currentPlanId.value) : 0;
});

const unlimitedStores = computed(
  () =>
    !auth.isSuperAdmin &&
    currentPlanId.value != null &&
    MAX_STORES_BY_PLAN[currentPlanId.value] == null,
);

/** Human-readable store cap for the current plan (`"1"` … `"unlimited"`). */
const storeCapLabel = computed(() =>
  currentPlanId.value ? maxStoresDisplayText(currentPlanId.value) : "",
);

const atStoreLimit = computed(() => {
  if (auth.isSuperAdmin) return false;
  return hasSelectedPlan.value && storeCount.value >= maxStores.value;
});

const canUseCreateForm = computed(() => {
  if (auth.isSuperAdmin) return true;
  return hasSelectedPlan.value && !atStoreLimit.value;
});

const currentPlanName = computed(() => {
  const id = currentPlanId.value;
  if (!id) return "";
  return PRICING_PLANS.find((p) => p.id === id)?.name ?? id;
});

async function loadGate() {
  gateLoading.value = true;
  storeCount.value = 0;
  if (!isSupabaseConfigured() || !auth.sessionUserId) {
    gateLoading.value = false;
    return;
  }
  const supabase = getSupabaseBrowser();
  const { count, error } = await supabase
    .from("stores")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", auth.sessionUserId);
  if (error) toast.error(error.message);
  else storeCount.value = count ?? 0;
  gateLoading.value = false;
}

onMounted(() => {
  void loadGate();
});

watch(
  () => auth.sessionUserId,
  () => {
    void loadGate();
  },
);

watch(
  () => auth.user?.user_metadata?.signup_plan,
  () => {
    void loadGate();
  },
);

function slugify() {
  slug.value = name.value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function saveSignupPlan(planId: PlanId) {
  if (!isSupabaseConfigured() || !auth.user) {
    toast.error("Sign in required.");
    return;
  }
  planBusy.value = true;
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.auth.updateUser({
    data: {
      ...auth.user.user_metadata,
      signup_plan: planId,
    },
  });
  planBusy.value = false;
  if (error) {
    toast.error(error.message);
    return;
  }
  await auth.refreshSessionFromSupabase();
  toast.success(
    `Plan set to ${PRICING_PLANS.find((p) => p.id === planId)?.name ?? planId}.`,
  );
  await loadGate();
}

async function submit() {
  if (!canUseCreateForm.value) {
    if (!auth.isSuperAdmin && !hasSelectedPlan.value) {
      toast.error("Select a subscription plan before creating a store.");
    } else if (atStoreLimit.value) {
      const cap =
        currentPlanId.value &&
        MAX_STORES_BY_PLAN[currentPlanId.value] != null
          ? maxStoresDisplayText(currentPlanId.value)
          : "unlimited";
      toast.error(
        cap === "unlimited"
          ? `You cannot add another storefront right now.`
          : `Your ${currentPlanName.value} plan allows up to ${cap} shop${cap === "1" ? "" : "s"}. Upgrade to add more.`,
      );
    }
    return;
  }
  if (!isSupabaseConfigured() || !auth.sessionUserId) {
    toast.error("Sign in required.");
    return;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.value)) {
    toast.error(
      "Slug: lowercase letters, numbers, and single hyphens only.",
    );
    return;
  }
  busy.value = true;
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from("stores")
    .insert({
      owner_id: auth.sessionUserId,
      slug: slug.value.trim(),
      name: name.value.trim(),
      description: description.value.trim() || null,
      whatsapp_phone_e164: whatsapp.value.trim() || null,
      is_active: true,
    })
    .select("id")
    .single();
  busy.value = false;
  if (error) {
    toast.error(error.message);
    return;
  }
  toast.success("Store created.");
  if (ui.createStoreModalOpen) {
    ui.closeCreateStoreModal();
  }
  await router.push(`/dashboard/stores/${data.id}`);
}

defineExpose({ loadGate });
</script>

<template>
  <div
    class="rounded-3xl border border-white/60 bg-white/70 p-8 shadow-[0_28px_70px_-36px_rgba(15,23,42,0.18)] backdrop-blur-xl sm:p-10"
  >
    <component
      :is="headingLevel"
      class="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl"
    >
      Create store
    </component>
    <p class="mt-2 text-sm leading-relaxed text-zinc-600">
      Choose a name and URL slug. You can add products and publish when you are ready.
    </p>

    <Transition name="cstore-body" mode="out-in">
      <div
        v-if="gateLoading"
        key="gate"
        class="cstore-body"
      >
        <SkeletonCreateStoreGate />
      </div>

      <div
        v-else
        key="ready"
        class="cstore-body"
      >
      <div
        v-if="sellerNeedsPlanPicker"
        class="mt-8 rounded-2xl border border-amber-200/90 bg-amber-50/90 p-5 ring-1 ring-amber-200/50"
      >
        <h2 class="text-sm font-bold uppercase tracking-wide text-amber-950">
          Select a plan first
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-amber-950/90">
          Your account does not have a subscription plan on file. Pick the tier
          you are starting with so we know how many shops you can run. You can
          change paid tiers later from billing when you are ready.
        </p>
        <div class="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            v-for="plan in PRICING_PLANS"
            :key="plan.id"
            type="button"
            :disabled="planBusy"
            class="rounded-2xl border border-amber-200/80 bg-white px-3 py-3 text-left text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-amber-300 hover:bg-amber-50/50 disabled:opacity-50"
            @click="saveSignupPlan(plan.id)"
          >
            <span class="block">{{ plan.name }}</span>
            <span class="mt-0.5 block text-xs font-normal text-zinc-600">
              <template v-if="plan.monthlyGhs === 0">Free</template>
              <template v-else>{{ formatGhsWhole(plan.monthlyGhs) }} / mo</template>
            </span>
          </button>
        </div>
      </div>

      <div
        v-else-if="atStoreLimit"
        class="mt-8 rounded-2xl border border-red-200/90 bg-red-50/90 p-5 ring-1 ring-red-200/40"
      >
        <h2 class="text-sm font-bold uppercase tracking-wide text-red-950">
          Store limit reached
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-red-950/90">
          <template v-if="unlimitedStores">
            You cannot add another storefront right now. If this looks wrong,
            contact support.
          </template>
          <template v-else>
            Your <strong>{{ currentPlanName }}</strong> plan allows up to
            <strong>{{ storeCapLabel }}</strong>
            shop{{ storeCapLabel === "1" ? "" : "s" }}. To add another storefront,
            upgrade your plan.
          </template>
        </p>
        <RouterLink
          :to="{ name: 'home', hash: '#pricing' }"
          class="mt-4 inline-flex rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-zinc-800"
        >
          View plans &amp; pricing
        </RouterLink>
      </div>

      <template v-else>
        <p
          v-if="auth.isSuperAdmin"
          class="mt-6 rounded-2xl border border-violet-200/80 bg-violet-50/80 px-4 py-3 text-sm text-violet-950 ring-1 ring-violet-200/40"
        >
          <span class="font-semibold">Super admin</span>
          <span class="text-violet-900/90">
            — you can add stores for testing or support without a seller subscription
            plan. Store caps do not apply to your account.
          </span>
        </p>
        <p
          v-else
          class="mt-6 rounded-2xl border border-teal-200/80 bg-teal-50/80 px-4 py-3 text-sm text-teal-950 ring-1 ring-teal-200/40"
        >
          <span class="font-semibold">Plan:</span>
          {{ currentPlanName }}
          <span class="text-teal-800/90">
            —
            <template v-if="unlimitedStores">
              <strong class="text-teal-950">Unlimited</strong> shops on this tier
            </template>
            <template v-else>
              up to
              <strong class="text-teal-950">{{ storeCapLabel }}</strong>
              shop{{ storeCapLabel === "1" ? "" : "s" }} on this tier
            </template>
            ({{ storeCount }} created).
          </span>
        </p>

        <form class="mt-8 space-y-5" @submit.prevent="submit">
          <div>
            <label
              class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
              for="create-store-name"
              >Store name *</label
            >
            <input
              id="create-store-name"
              v-model="name"
              required
              class="mt-1.5 w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-3 text-sm text-zinc-900 shadow-inner outline-none transition focus:border-teal-300 focus:ring-4 focus:ring-teal-500/15"
              @blur="slugify"
            />
          </div>
          <div>
            <label
              class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
              for="create-store-slug"
              >URL slug *</label
            >
            <input
              id="create-store-slug"
              v-model="slug"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              class="mt-1.5 w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-3 font-mono text-sm text-zinc-900 shadow-inner outline-none transition focus:border-teal-300 focus:ring-4 focus:ring-teal-500/15"
            />
            <p class="mt-1.5 text-xs text-zinc-500">Shop URL: /{{ slug || "…" }}</p>
          </div>
          <div>
            <label
              class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
              for="create-store-desc"
              >Description</label
            >
            <textarea
              id="create-store-desc"
              v-model="description"
              rows="3"
              class="mt-1.5 w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-3 text-sm text-zinc-900 shadow-inner outline-none transition focus:border-teal-300 focus:ring-4 focus:ring-teal-500/15"
            />
          </div>
          <div>
            <label
              class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
              for="create-store-wa"
              >WhatsApp (E.164, e.g. +23320…)</label
            >
            <input
              id="create-store-wa"
              v-model="whatsapp"
              type="tel"
              class="mt-1.5 w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-3 text-sm text-zinc-900 shadow-inner outline-none transition focus:border-teal-300 focus:ring-4 focus:ring-teal-500/15"
            />
          </div>
          <button
            type="submit"
            class="w-full rounded-full bg-zinc-900 py-3.5 text-sm font-semibold text-white shadow-lg shadow-zinc-900/25 transition hover:bg-zinc-800 disabled:opacity-50"
            :disabled="busy"
          >
            {{ busy ? "Saving…" : "Create store" }}
          </button>
        </form>
      </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.cstore-body-enter-from,
.cstore-body-leave-to {
  opacity: 0;
  transform: translate3d(0, 0.5rem, 0);
}

.cstore-body-enter-active,
.cstore-body-leave-active {
  transition:
    opacity 0.32s ease,
    transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .cstore-body,
  .cstore-body-enter-active,
  .cstore-body-leave-active {
    transition-duration: 0.01ms !important;
  }

  .cstore-body-enter-from,
  .cstore-body-leave-to {
    transform: none;
  }
}
</style>
