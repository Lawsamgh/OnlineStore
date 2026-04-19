<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import {
  formatGhsWhole,
  type PricingPlan,
} from "../../constants/pricingPlans";
import { useAuthStore } from "../../stores/auth";

const props = defineProps<{
  plan: PricingPlan;
  /** Center “Standard” style vs dark flank cards (reference UI). */
  tone: "hero" | "side";
}>();

const auth = useAuthStore();

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
      class="mt-8 flex-1 border-t pt-8"
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
          v-for="group in plan.groups"
          :key="`${plan.id}-${group.title}`"
          class="px-4 py-3.5 sm:px-5 sm:py-4"
        >
          <template v-if="group.lines.length === 1">
            <div
              class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
            >
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
          </template>
          <template v-else>
            <h4
              class="text-xs font-bold uppercase tracking-wide"
              :class="tone === 'hero' ? 'text-zinc-900' : 'text-zinc-200'"
            >
              {{ group.title }}
            </h4>
            <ul
              class="mt-2.5 space-y-1.5 text-sm leading-relaxed"
              :class="tone === 'hero' ? 'text-zinc-800' : 'text-zinc-200'"
            >
              <li
                v-for="(line, idx) in group.lines"
                :key="idx"
                class="flex gap-2.5"
              >
                <span
                  class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                  :class="
                    tone === 'hero' ? 'bg-emerald-600' : 'bg-emerald-400'
                  "
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
      class="mt-8 rounded-2xl border p-5 sm:p-6"
      :class="
        tone === 'hero'
          ? 'border-zinc-200 bg-zinc-50'
          : 'border-white/10 bg-zinc-900/55'
      "
    >
      <p
        class="text-xs font-bold uppercase tracking-wide"
        :class="tone === 'hero' ? 'text-zinc-700' : 'text-zinc-300'"
      >
        Billed annually
      </p>
      <p
        class="mt-1 text-xl font-semibold tabular-nums"
        :class="tone === 'hero' ? 'text-zinc-950' : 'text-white'"
      >
        {{ formatGhsWhole(plan.annualGhs) }}
        <span
          class="text-sm font-medium"
          :class="tone === 'hero' ? 'text-zinc-500' : 'text-zinc-400'"
        >
          / yr
        </span>
      </p>
      <p
        class="mt-1 text-sm font-medium"
        :class="tone === 'hero' ? 'text-emerald-700' : 'text-emerald-400'"
      >
        Save {{ formatGhsWhole(plan.annualSaveGhs) }}
      </p>
    </footer>
    <footer
      v-else
      class="mt-8 rounded-2xl border p-5 sm:p-6"
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

    <RouterLink
      v-if="!auth.isSignedIn"
      :to="{ name: 'login', query: { plan: plan.id, mode: 'sign-up' } }"
      class="mt-6 block w-full rounded-full py-3.5 text-center text-sm font-semibold transition-all duration-200 ease-out active:scale-[0.99]"
      :class="
        tone === 'hero'
          ? 'bg-amber-400 text-zinc-900 hover:bg-amber-300'
          : 'border border-white/15 bg-zinc-700/95 text-white hover:bg-zinc-600'
      "
    >
      Choose plan
    </RouterLink>
    <RouterLink
      v-else
      :to="{ name: 'dashboard', query: { plan: plan.id } }"
      class="mt-6 block w-full rounded-full py-3.5 text-center text-sm font-semibold transition-all duration-200 ease-out active:scale-[0.99]"
      :class="
        tone === 'hero'
          ? 'bg-amber-400 text-zinc-900 hover:bg-amber-300'
          : 'border border-white/15 bg-zinc-700/95 text-white hover:bg-zinc-600'
      "
    >
      {{ plan.monthlyGhs === 0 ? "Open dashboard" : "Choose plan" }}
    </RouterLink>
    </article>
  </div>
</template>
