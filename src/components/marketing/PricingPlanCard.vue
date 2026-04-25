<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  formatGhsWhole,
  type PricingPlan,
} from "../../constants/pricingPlans";

const props = defineProps<{
  plan: PricingPlan;
  /** Center “Standard” style vs dark flank cards (reference UI). */
  tone: "hero" | "side";
}>();

const showDetailsModal = ref(false);

const iconWrapClass = computed(() => {
  if (props.tone === "hero") {
    return "rounded-xl bg-amber-100 p-2.5 text-amber-700 ring-1 ring-amber-200/80";
  }
  switch (props.plan.id) {
    case "free":
      return "rounded-xl bg-sky-500/20 p-2.5 text-sky-200 ring-1 ring-sky-400/30";
    case "starter":
      return "rounded-xl bg-cyan-500/20 p-2.5 text-cyan-200 ring-1 ring-cyan-400/25";
    case "growth":
      return "rounded-xl bg-violet-500/20 p-2.5 text-violet-200 ring-1 ring-violet-400/30";
    case "pro":
      return "rounded-xl bg-fuchsia-500/20 p-2.5 text-fuchsia-200 ring-1 ring-fuchsia-400/30";
    default:
      return "rounded-xl bg-white/10 p-2.5 text-white ring-1 ring-white/15";
  }
});

const shellClass = computed(() =>
  props.tone === "hero"
    ? "relative z-10 border border-zinc-200/90 bg-white text-zinc-900 shadow-xl shadow-zinc-900/10 ring-1 ring-zinc-100"
    : "border border-zinc-700/40 bg-zinc-800 text-white shadow-xl shadow-zinc-900/15 ring-1 ring-black/10 backdrop-blur-sm",
);

const previewGroups = computed(() => props.plan.groups.slice(0, 8));
const remainingGroupCount = computed(
  () => Math.max(0, props.plan.groups.length - previewGroups.value.length),
);

function getGroupIconPath(title: string): string {
  const key = title.trim().toLowerCase();
  if (key.includes("url")) return "M8.25 12a3.75 3.75 0 003.75 3.75h3a3.75 3.75 0 100-7.5h-1.5M15.75 12a3.75 3.75 0 00-3.75-3.75h-3a3.75 3.75 0 000 7.5h1.5";
  if (key.includes("theme")) return "M12 3.75c-4.56 0-8.25 3.328-8.25 7.433 0 2.664 2.04 4.82 4.56 4.82h1.065a1.5 1.5 0 011.5 1.5 2.247 2.247 0 002.247 2.247H13.5c3.727 0 6.75-3.023 6.75-6.75 0-5.108-3.447-9.25-8.25-9.25z";
  if (key.includes("product")) return "M20.25 7.5l-8.25-4.5-8.25 4.5m16.5 0v9l-8.25 4.5m8.25-13.5L12 12m0 9V12m0 0L3.75 7.5";
  if (key.includes("order")) return "M8.25 6.75h11.25m-11.25 4.5h11.25m-11.25 4.5h11.25M3.75 6.75h.008v.008H3.75V6.75zm0 4.5h.008v.008H3.75v-.008zm0 4.5h.008v.008H3.75v-.008z";
  if (key.includes("image")) return "M3.75 4.5h16.5A1.5 1.5 0 0121.75 6v12a1.5 1.5 0 01-1.5 1.5H3.75a1.5 1.5 0 01-1.5-1.5V6a1.5 1.5 0 011.5-1.5zM7.5 9.75a1.125 1.125 0 100-2.25 1.125 1.125 0 000 2.25zm12 7.5l-4.28-4.28a1.5 1.5 0 00-2.12 0L9 17.07l-1.78-1.78a1.5 1.5 0 00-2.12 0L3 17.39";
  if (key.includes("notification")) return "M14.25 17.25a2.25 2.25 0 11-4.5 0m7.5-6v-2.25a5.25 5.25 0 10-10.5 0v2.25l-1.5 2.25h13.5l-1.5-2.25z";
  if (key.includes("deliver")) return "M9.75 17.25h4.5m-11.25-9h10.5l1.5 2.25h3.75v4.5h-1.5a2.25 2.25 0 11-4.5 0H9.75a2.25 2.25 0 11-4.5 0h-1.5v-6.75z";
  if (key.includes("analytic")) return "M3.75 19.5h16.5M7.5 16.5v-6m4.5 6v-9m4.5 9v-3";
  if (key.includes("admin") || key.includes("user")) return "M15 19.5v-1.125a3.375 3.375 0 00-3.375-3.375h-3.75A3.375 3.375 0 004.5 18.375V19.5M13.5 7.875a3 3 0 11-6 0 3 3 0 016 0z";
  if (key.includes("sms")) return "M21.75 7.5v9A2.25 2.25 0 0119.5 18.75h-15A2.25 2.25 0 012.25 16.5v-9A2.25 2.25 0 014.5 5.25h15A2.25 2.25 0 0121.75 7.5zm-2.25.21L12 12.75 4.5 7.71";
  if (key.includes("support")) return "M18.75 9.75a6.75 6.75 0 10-13.5 0v1.5A2.25 2.25 0 003 13.5v1.5a2.25 2.25 0 002.25 2.25h1.5m9.75-3.75h1.5A2.25 2.25 0 0020.25 11.25v-1.5m-7.5 9h-1.5";
  return "M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z";
}

function closeDetailsModal() {
  showDetailsModal.value = false;
}

function onDocKeydown(ev: KeyboardEvent) {
  if (ev.key === "Escape" && showDetailsModal.value) {
    ev.preventDefault();
    closeDetailsModal();
  }
}

onMounted(() => {
  document.addEventListener("keydown", onDocKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onDocKeydown);
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

watch(showDetailsModal, (open) => {
  if (!open) {
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
    return;
  }
  const scrollbarComp = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.overflow = "hidden";
  if (scrollbarComp > 0) {
    document.body.style.paddingRight = `${scrollbarComp}px`;
  }
});
</script>

<template>
  <div class="relative h-full min-h-0">
    <article
      data-pricing-card
      class="relative flex h-full flex-col rounded-3xl p-7 transition-[transform,box-shadow] duration-300 ease-out sm:p-8"
      :class="shellClass"
    >
      <div class="mb-5">
        <div class="flex items-center gap-3">
          <span :class="iconWrapClass" aria-hidden="true">
            <svg
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.75"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
              />
            </svg>
          </span>
          <h3
            class="min-w-0 text-lg font-bold tracking-tight"
            :class="tone === 'hero' ? 'text-zinc-900' : 'text-white'"
          >
            {{ plan.name }}
          </h3>
        </div>
        <div
          v-if="plan.highlighted && tone === 'hero'"
          class="mt-2.5 flex justify-end"
        >
          <span
            class="inline-flex rounded-full bg-amber-400 px-3 py-1 text-[10px] font-bold uppercase leading-none tracking-wide text-zinc-900 shadow-sm ring-1 ring-amber-300/90"
          >
            Popular
          </span>
        </div>
      </div>

    <p
      v-if="plan.audience"
      class="text-sm leading-relaxed"
      :class="tone === 'hero' ? 'text-zinc-600' : 'text-zinc-300'"
    >
      {{ plan.audience }}
    </p>

    <p class="mt-4 flex flex-wrap items-baseline gap-1">
      <span
        v-if="plan.monthlyGhs === 0"
        class="text-4xl font-semibold tabular-nums tracking-tight"
        :class="tone === 'hero' ? 'text-zinc-950' : 'text-white'"
      >
        Free
      </span>
      <template v-else>
        <span
          class="text-4xl font-semibold tabular-nums tracking-tight"
          :class="tone === 'hero' ? 'text-zinc-950' : 'text-white'"
        >
          {{ formatGhsWhole(plan.monthlyGhs) }}
        </span>
        <span
          class="text-sm font-medium"
          :class="tone === 'hero' ? 'text-zinc-500' : 'text-zinc-400'"
        >
          / month
        </span>
      </template>
    </p>

    <div
      class="mt-6 border-t pt-6"
      :class="
        tone === 'hero'
          ? 'border-zinc-200/90'
          : 'border-white/10'
      "
    >
      <p
        class="mb-3 text-xs font-semibold uppercase tracking-wide"
        :class="tone === 'hero' ? 'text-zinc-500' : 'text-zinc-400'"
      >
        What's included
      </p>
      <div
        class="divide-y overflow-hidden rounded-2xl border"
        :class="
          tone === 'hero'
            ? 'divide-zinc-200/90 border-zinc-200/90 bg-zinc-50/90'
            : 'divide-white/10 border-white/10 bg-zinc-900/55'
        "
      >
        <div
          v-for="group in previewGroups"
          :key="`${plan.id}-${group.title}`"
          class="px-4 py-3 sm:px-5"
        >
          <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <h4
              class="shrink-0 text-xs font-bold uppercase tracking-wide"
              :class="tone === 'hero' ? 'text-zinc-900' : 'text-zinc-200'"
            >
              {{ group.title }}
            </h4>
            <p
              class="min-w-0 text-sm font-medium leading-relaxed sm:max-w-[min(100%,20rem)] sm:text-right"
              :class="tone === 'hero' ? 'text-zinc-800' : 'text-zinc-300'"
            >
              {{ group.lines[0] }}
            </p>
          </div>
        </div>
      </div>
      <p
        v-if="remainingGroupCount > 0"
        class="mt-3 text-xs font-medium"
        :class="tone === 'hero' ? 'text-zinc-600' : 'text-zinc-400'"
      >
        + {{ remainingGroupCount }} more feature sections
      </p>
    </div>

    <footer
      v-if="plan.monthlyGhs === 0"
      class="mt-5 rounded-2xl border p-4 sm:p-5"
      :class="
        tone === 'hero'
          ? 'border-zinc-200/90 bg-zinc-100/90'
          : 'border-white/10 bg-zinc-900/50'
      "
    >
      <p
        class="text-xs font-bold uppercase tracking-wide"
        :class="tone === 'hero' ? 'text-zinc-600' : 'text-zinc-400'"
      >
        Billing
      </p>
      <p
        class="mt-1 text-sm font-medium leading-relaxed"
        :class="tone === 'hero' ? 'text-zinc-700' : 'text-zinc-300'"
      >
        Always free — no card required. Upgrade to Starter when you need more
        products, orders, and analytics.
      </p>
    </footer>

    <button
      type="button"
      class="mt-auto block w-full rounded-full py-3.5 text-center text-sm font-semibold transition-all duration-200 ease-out active:scale-[0.99]"
      :class="
        tone === 'hero'
          ? 'bg-amber-400 text-zinc-900 hover:bg-amber-300'
          : 'border border-white/15 bg-zinc-700/95 text-white hover:bg-zinc-600'
      "
      @click="showDetailsModal = true"
    >
      View details
    </button>
    </article>
    <Teleport to="body">
      <div
        v-if="showDetailsModal"
        class="fixed inset-0 z-[320] flex items-center justify-center p-4 sm:p-6"
        role="dialog"
        aria-modal="true"
        :aria-label="`${plan.name} plan details`"
      >
        <div class="absolute inset-0 bg-zinc-950/55 backdrop-blur-md" aria-hidden="true" />
        <div
          class="relative z-10 flex w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-zinc-700/70 bg-zinc-900/95 shadow-[0_36px_90px_-28px_rgba(0,0,0,0.7)] ring-1 ring-white/10 backdrop-blur-xl"
        >
          <div class="flex items-center justify-between border-b border-zinc-700/70 bg-gradient-to-r from-zinc-900 via-zinc-900 to-zinc-800/90 px-6 py-4">
            <div class="min-w-0">
              <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
                Plan details
              </p>
              <h3 class="truncate text-2xl font-extrabold tracking-tight text-white">
                {{ plan.name }}
              </h3>
            </div>
            <button
              type="button"
              class="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-800 text-lg leading-none text-zinc-300 shadow-sm transition hover:bg-zinc-700 hover:text-white"
              aria-label="Close details"
              @click="closeDetailsModal"
            >
              ×
            </button>
          </div>
          <div class="px-5 py-3 sm:px-6">
            <div
              class="mb-2.5 rounded-2xl border border-zinc-700/80 bg-zinc-800/85 px-4 py-3"
            >
              <p class="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Quick summary
              </p>
              <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <p class="text-3xl font-extrabold leading-none text-white sm:text-4xl">
                  {{ plan.monthlyGhs === 0 ? "Free" : `${formatGhsWhole(plan.monthlyGhs)} / month` }}
                </p>
                <span
                  class="inline-flex rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300 ring-1 ring-emerald-400/30"
                >
                  {{ plan.monthlyGhs === 0 ? "No card needed" : "Monthly plan" }}
                </span>
              </div>
              <p class="mt-1.5 text-sm text-zinc-300">
                {{ plan.audience || "Includes all features listed below." }}
              </p>
            </div>
            <div class="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              <div
                v-for="group in plan.groups"
                :key="`${plan.id}-full-${group.title}`"
                class="rounded-2xl border border-zinc-700/80 bg-zinc-800/80 px-3.5 py-2.5 transition-colors duration-200 hover:border-zinc-600 hover:bg-zinc-800"
              >
                <h4 class="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-zinc-100">
                  <span class="inline-flex h-7 w-7 items-center justify-center text-emerald-300">
                    <svg
                      class="h-6 w-6"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="1.9"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        :d="getGroupIconPath(group.title)"
                      />
                    </svg>
                  </span>
                  {{ group.title }}
                </h4>
                <ul class="mt-1.5 space-y-1 text-sm leading-relaxed text-zinc-300">
                  <li v-for="(line, idx) in group.lines" :key="idx" class="flex gap-2">
                    <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
                    <span>{{ line }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
