<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { useRealtimeTableRefresh } from "../../composables/useRealtimeTableRefresh";
import { useToastStore } from "../../stores/toast";
import VChart from "vue-echarts";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { BarChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import type { EChartsOption } from "echarts";

use([CanvasRenderer, BarChart, GridComponent, TooltipComponent, LegendComponent]);

type SmsLogRow = {
  id: string;
  created_at: string;
  function_name: string;
  event_type: string;
  status: "sent" | "failed" | "skipped";
  provider: string;
  recipient_phone_e164: string | null;
  detail: string | null;
};

const toast = useToastStore();
const loading = ref(true);
const rows = ref<SmsLogRow[]>([]);

const statusFilter = ref<"all" | "sent" | "failed" | "skipped">("all");
const functionFilter = ref("all");
const searchQuery = ref("");
const dateRange = ref<"7d" | "30d" | "90d" | "thisMonth" | "lastMonth" | "thisYear" | "all">("30d");

const functionOptions = computed(() => {
  const unique = new Set(
    rows.value.map((r) => r.function_name).filter(Boolean),
  );
  return ["all", ...Array.from(unique).sort((a, b) => a.localeCompare(b))];
});

const rowsByDateRange = computed(() => {
  const now = new Date();
  let cutoffDate: Date | null = null;
  if (dateRange.value === "7d") {
    cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (dateRange.value === "30d") {
    cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (dateRange.value === "90d") {
    cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  } else if (dateRange.value === "thisMonth") {
    cutoffDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (dateRange.value === "lastMonth") {
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return rows.value.filter((r) => {
      const d = new Date(r.created_at);
      return d >= lastMonthStart && d <= lastMonthEnd;
    });
  } else if (dateRange.value === "thisYear") {
    cutoffDate = new Date(now.getFullYear(), 0, 1);
  }
  if (!cutoffDate) return rows.value;
  return rows.value.filter((r) => new Date(r.created_at) >= cutoffDate);
});

const filteredRows = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return rows.value.filter((r) => {
    if (statusFilter.value !== "all" && r.status !== statusFilter.value)
      return false;
    if (
      functionFilter.value !== "all" &&
      r.function_name !== functionFilter.value
    )
      return false;
    if (!q) return true;
    return (
      r.function_name.toLowerCase().includes(q) ||
      r.event_type.toLowerCase().includes(q) ||
      (r.recipient_phone_e164 ?? "").toLowerCase().includes(q) ||
      (r.detail ?? "").toLowerCase().includes(q)
    );
  });
});

const sentCount = computed(
  () => rows.value.filter((r) => r.status === "sent").length,
);
const failedCount = computed(
  () => rows.value.filter((r) => r.status === "failed").length,
);
const skippedCount = computed(
  () => rows.value.filter((r) => r.status === "skipped").length,
);

const chartOption = computed<EChartsOption>(() => {
  const dayMap = new Map<string, { sent: number; failed: number; skipped: number }>();
  for (const row of rowsByDateRange.value) {
    const d = new Date(row.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    const bin = dayMap.get(key) ?? { sent: 0, failed: 0, skipped: 0 };
    bin[row.status]++;
    dayMap.set(key, bin);
  }
  const sorted = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const labels = sorted.map(([k]) =>
    new Date(k).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  );
  const sentData = sorted.map(([, v]) => v.sent);
  const failedData = sorted.map(([, v]) => v.failed);
  const skippedData = sorted.map(([, v]) => v.skipped);
  return {
    animationDuration: 500,
    animationEasing: "cubicOut",
    grid: { top: 36, right: 10, bottom: 36, left: 10, containLabel: true },
    legend: {
      top: 4,
      left: 8,
      itemWidth: 9,
      itemHeight: 9,
      icon: "roundRect",
      textStyle: { color: "#334155", fontSize: 12, fontWeight: 600 },
      data: ["Sent", "Failed", "Skipped"],
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "rgba(255,255,255,0.98)",
      borderColor: "rgba(148,163,184,0.35)",
      borderWidth: 1,
      textStyle: { color: "#0f172a" },
      padding: [8, 10],
    },
    xAxis: {
      type: "category",
      data: labels,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "rgba(15,23,42,0.08)" } },
      axisLabel: { color: "#475569", fontSize: 11 },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { color: "#94a3b8", fontSize: 11 },
      splitLine: { lineStyle: { color: "rgba(15,23,42,0.06)" } },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        name: "Sent",
        type: "bar",
        stack: "sms",
        data: sentData,
        barMaxWidth: 48,
        barMinHeight: 3,
        itemStyle: { color: "#059669", borderRadius: [0, 0, 0, 0] },
        emphasis: { focus: "series" },
      },
      {
        name: "Failed",
        type: "bar",
        stack: "sms",
        data: failedData,
        barMaxWidth: 48,
        barMinHeight: 3,
        itemStyle: { color: "#f43f5e" },
        emphasis: { focus: "series" },
      },
      {
        name: "Skipped",
        type: "bar",
        stack: "sms",
        data: skippedData,
        barMaxWidth: 48,
        barMinHeight: 3,
        itemStyle: { color: "#f59e0b", borderRadius: [4, 4, 0, 0] },
        emphasis: { focus: "series" },
      },
    ],
  };
});

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function statusBadgeClass(status: SmsLogRow["status"]): string {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1";
  if (status === "sent") {
    return `${base} bg-emerald-50 text-emerald-800 ring-emerald-200/80`;
  }
  if (status === "failed") {
    return `${base} bg-rose-50 text-rose-800 ring-rose-200/80`;
  }
  return `${base} bg-amber-50 text-amber-900 ring-amber-200/80`;
}

async function load(opts?: { silent?: boolean }) {
  const silent = opts?.silent ?? false;
  if (!silent) loading.value = true;
  if (!isSupabaseConfigured()) {
    if (!silent) loading.value = false;
    return;
  }
  try {
    const { data, error } = await getSupabaseBrowser()
      .from("sms_notification_logs")
      .select(
        "id, created_at, function_name, event_type, status, provider, recipient_phone_e164, detail",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      toast.error(error.message);
      rows.value = [];
      return;
    }
    rows.value = (data ?? []) as SmsLogRow[];
  } finally {
    if (!silent) loading.value = false;
  }
}

onMounted(() => {
  void load();
});

useRealtimeTableRefresh({
  channelName: "admin-sms-notification-logs",
  deps: [loading],
  getTables: () => [{ table: "sms_notification_logs" }],
  onEvent: () => load({ silent: true }),
});
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
      SMS notification logs
    </h1>
    <p class="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600">
      Monitor all SMS delivery attempts across edge functions.
    </p>

    <div class="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
      <div class="mb-4 flex items-center justify-between gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Delivery activity by day
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="range in ['7d', '30d', '90d', 'thisMonth', 'lastMonth', 'thisYear', 'all']"
            :key="range"
            type="button"
            @click="dateRange = range as typeof dateRange"
            :class="[
              'rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
              dateRange === range
                ? 'bg-zinc-900 text-white'
                : 'border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
            ]"
          >
            {{
              range === '7d'
                ? '7d'
                : range === '30d'
                  ? '30d'
                  : range === '90d'
                    ? '90d'
                    : range === 'thisMonth'
                      ? 'This Month'
                      : range === 'lastMonth'
                        ? 'Last Month'
                        : range === 'thisYear'
                          ? 'This Year'
                          : 'All'
            }}
          </button>
        </div>
      </div>
      <p class="mt-1.5 text-sm text-zinc-600">
          <span class="font-semibold text-emerald-700">Sent {{ sentCount }}</span>
          <span class="mx-2 text-zinc-400">•</span>
          <span class="font-semibold text-rose-700">Failed {{ failedCount }}</span>
          <span class="mx-2 text-zinc-400">•</span>
          <span class="font-semibold text-amber-700">Skipped {{ skippedCount }}</span>
        </p>
      <VChart autoresize class="w-full" style="height: 224px" :option="chartOption" />
    </div>

    <div class="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
      <div
        class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,11rem)_minmax(0,16rem)_minmax(0,1fr)]"
      >
        <select
          v-model="statusFilter"
          class="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:ring-2 focus:ring-violet-200"
          aria-label="Filter SMS logs by status"
        >
          <option value="all">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </select>
        <select
          v-model="functionFilter"
          class="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:ring-2 focus:ring-violet-200"
          aria-label="Filter SMS logs by function"
        >
          <option
            v-for="opt in functionOptions"
            :key="`fn-${opt}`"
            :value="opt"
          >
            {{ opt === "all" ? "All functions" : opt }}
          </option>
        </select>
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Search event, recipient phone, or detail..."
          class="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:ring-2 focus:ring-violet-200"
          aria-label="Search SMS logs"
        />
      </div>
    </div>

    <div
      class="mt-6 min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
      role="region"
      aria-label="SMS notification logs table"
    >
      <div
        class="border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs font-semibold text-zinc-500 sm:px-5"
      >
        Showing {{ filteredRows.length }} of {{ rows.length }} logs
      </div>

      <div v-if="loading" class="px-5 py-8 text-sm text-zinc-500">
        Loading logs...
      </div>
      <div
        v-else-if="!filteredRows.length"
        class="px-5 py-8 text-sm text-zinc-500"
      >
        No SMS logs match your current filters.
      </div>
      <div v-else class="overflow-auto [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.5)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-thumb]:rounded-full" style="max-height: 500px">
        <table class="min-w-full border-collapse text-left text-sm">
          <thead
            class="sticky top-0 z-[1] bg-zinc-100/95 text-[11px] uppercase tracking-wider text-zinc-500"
          >
            <tr>
              <th class="px-4 py-3 font-semibold sm:px-5">Time</th>
              <th class="px-4 py-3 font-semibold">Function</th>
              <th class="px-4 py-3 font-semibold">Event</th>
              <th class="px-4 py-3 font-semibold">Status</th>
              <th class="px-4 py-3 font-semibold">Recipient</th>
              <th class="px-4 py-3 font-semibold">Detail</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in filteredRows"
              :key="row.id"
              class="border-t border-zinc-100 align-top hover:bg-zinc-50/70"
            >
              <td class="px-4 py-3 text-xs text-zinc-600 sm:px-5">
                {{ formatDateTime(row.created_at) }}
              </td>
              <td class="px-4 py-3">
                <code
                  class="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-700"
                >
                  {{ row.function_name }}
                </code>
              </td>
              <td class="px-4 py-3 text-zinc-700">{{ row.event_type }}</td>
              <td class="px-4 py-3">
                <span :class="statusBadgeClass(row.status)">
                  {{ row.status }}
                </span>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-zinc-700">
                {{ row.recipient_phone_e164 || "—" }}
              </td>
              <td class="px-4 py-3 text-xs text-zinc-600">
                {{ row.detail || "—" }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
