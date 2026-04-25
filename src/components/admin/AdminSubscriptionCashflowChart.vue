<script setup lang="ts">
import { computed, ref } from "vue";
import { formatGhs } from "../../lib/formatMoney";

export type CashflowMonthBin = {
  key: string;
  label: string;
  incomeGhs: number;
  feeGhs: number;
};

const props = defineProps<{
  months: readonly CashflowMonthBin[];
}>();

const hoveredKey = ref<string | null>(null);

const maxScale = computed(() => {
  let m = 0;
  for (const x of props.months) {
    m = Math.max(m, x.incomeGhs, x.feeGhs);
  }
  return m <= 0 ? 1 : m * 1.05;
});

const yTickLabels = computed(() => {
  const mx = maxScale.value;
  const h = mx / 2;
  const fmt = (n: number) =>
    `GH₵ ${n.toLocaleString("en-GH", { maximumFractionDigits: 0 })}`;
  return [fmt(mx), fmt(h), "GH₵ 0", `- ${fmt(h)}`, `- ${fmt(mx)}`];
});

function incomeBarHeightPct(income: number) {
  return `${(income / maxScale.value) * 100}%`;
}

function feeBarHeightPct(fee: number) {
  return `${(fee / maxScale.value) * 100}%`;
}

function tooltipHeading(m: CashflowMonthBin) {
  const parts = m.key.split("-").map(Number);
  if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
    const [y, mi] = parts;
    return new Date(y!, mi!, 1).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }
  return m.label;
}

function ghsFromFloat(g: number) {
  return formatGhs(Math.round(g * 100));
}

function monthNetGhs(m: CashflowMonthBin): number {
  return m.incomeGhs - m.feeGhs;
}

function monthNetTone(m: CashflowMonthBin): string {
  return monthNetGhs(m) >= 0 ? "text-emerald-700" : "text-rose-700";
}
</script>

<template>
  <div class="relative flex min-h-[13rem] gap-2 sm:min-h-[14.5rem] sm:gap-2.5">
    <div
      class="flex w-14 shrink-0 flex-col justify-between rounded-xl border border-emerald-200/55 bg-white/70 py-2 pr-1.5 text-right text-[9px] font-semibold tabular-nums text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] sm:w-16 sm:py-2.5 sm:pr-2 sm:text-[10px]"
      aria-hidden="true"
    >
      <span v-for="(lab, i) in yTickLabels" :key="i">{{ lab }}</span>
    </div>
    <div
      class="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-emerald-200/50 bg-white/55 px-1.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.65),inset_0_-1px_0_rgba(6,78,59,0.04)] backdrop-blur-xl sm:px-2.5 sm:py-2.5"
    >
      <div
        class="pointer-events-none absolute inset-x-2 top-1.5 z-[2] flex items-center justify-between text-[10px] font-semibold sm:inset-x-3"
      >
        <span class="rounded-full bg-lime-50/90 px-2 py-0.5 text-lime-700 ring-1 ring-lime-200/80">
          Paid (inflow)
        </span>
        <span class="rounded-full bg-emerald-50/90 px-2 py-0.5 text-emerald-800 ring-1 ring-emerald-200/80">
          Fees (outflow)
        </span>
      </div>
      <div
        class="pointer-events-none absolute inset-x-2 top-7 bottom-8 flex flex-col justify-between sm:inset-x-3 sm:bottom-9"
      >
        <div
          v-for="i in 5"
          :key="i"
          class="h-px bg-emerald-900/10"
          :class="i === 3 ? 'bg-emerald-500/35' : ''"
        />
      </div>
      <div
        class="relative flex h-[calc(100%-1.5rem)] items-stretch gap-0.5 pt-5 sm:gap-1"
      >
        <div
          v-for="m in months"
          :key="m.key"
          class="relative flex min-w-0 flex-1 flex-col"
          @mouseenter="hoveredKey = m.key"
          @mouseleave="hoveredKey = null"
        >
          <div
            class="relative flex flex-1 flex-col justify-end overflow-visible px-0.5"
          >
            <div
              class="mx-auto w-[min(2rem,64%)] max-w-[2.2rem] rounded-t-[0.8rem] bg-gradient-to-b from-lime-300/95 via-lime-400 to-lime-500/95 shadow-[0_6px_16px_rgba(132,204,22,0.22),inset_0_2px_3px_rgba(255,255,255,0.45)] transition-[box-shadow,ring-width] sm:w-[min(2.2rem,64%)]"
              :class="
                hoveredKey === m.key
                  ? 'ring-2 ring-lime-300/90 ring-offset-2 ring-offset-white/40'
                  : 'ring-1 ring-white/50'
              "
              :style="{
                height: incomeBarHeightPct(m.incomeGhs),
                minHeight: m.incomeGhs > 0 ? '4px' : '0',
              }"
            />
          </div>
          <div
            class="relative z-[1] h-px shrink-0 bg-gradient-to-r from-transparent via-emerald-500/35 to-transparent"
          />
          <div
            class="relative flex flex-1 flex-col justify-start overflow-visible px-0.5 pt-0.5"
          >
            <div
              class="mx-auto w-[min(2rem,64%)] max-w-[2.2rem] rounded-b-[0.8rem] bg-gradient-to-b from-emerald-900 via-emerald-950 to-black/80 shadow-[0_6px_16px_rgba(6,78,59,0.28),inset_0_-2px_4px_rgba(0,0,0,0.35)] transition-[box-shadow,ring-width] sm:w-[min(2.2rem,64%)]"
              :class="
                hoveredKey === m.key
                  ? 'ring-2 ring-emerald-300/50 ring-offset-2 ring-offset-white/40'
                  : 'ring-1 ring-white/25'
              "
              :style="{
                height: feeBarHeightPct(m.feeGhs),
                minHeight: m.feeGhs > 0 ? '4px' : '0',
              }"
            />
          </div>

          <div
            v-if="hoveredKey === m.key"
            class="pointer-events-none absolute bottom-[calc(100%-0.25rem)] left-1/2 z-20 mb-1 w-max max-w-[min(14rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-white/55 bg-white/75 px-3 py-2 text-left shadow-[0_16px_40px_-8px_rgba(15,23,42,0.18)] backdrop-blur-xl"
            role="tooltip"
          >
            <p class="text-xs font-semibold text-zinc-900">
              {{ tooltipHeading(m) }}
            </p>
            <p class="mt-1 text-[11px] text-zinc-600">
              Paid
              <span class="font-semibold tabular-nums text-lime-700">{{
                ghsFromFloat(m.incomeGhs)
              }}</span>
            </p>
            <p class="text-[11px] text-zinc-600">
              Fees
              <span class="font-semibold tabular-nums text-emerald-950">{{
                ghsFromFloat(m.feeGhs)
              }}</span>
            </p>
            <p class="mt-0.5 text-[11px] text-zinc-600">
              Net
              <span
                class="font-semibold tabular-nums"
                :class="monthNetTone(m)"
                >{{ ghsFromFloat(monthNetGhs(m)) }}</span
              >
            </p>
            <div
              class="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 border border-white/55 border-t-0 border-l-0 bg-white/80 backdrop-blur-sm"
              aria-hidden="true"
            />
          </div>

          <span
            class="mt-1.5 block text-center text-[10px] font-semibold text-zinc-600/85 sm:text-[11px]"
            >{{ m.label }}</span
          >
        </div>
      </div>
    </div>
  </div>
</template>
