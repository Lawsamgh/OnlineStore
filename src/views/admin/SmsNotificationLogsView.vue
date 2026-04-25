<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { useRealtimeTableRefresh } from "../../composables/useRealtimeTableRefresh";
import { useToastStore } from "../../stores/toast";

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

const functionOptions = computed(() => {
  const unique = new Set(
    rows.value.map((r) => r.function_name).filter(Boolean),
  );
  return ["all", ...Array.from(unique).sort((a, b) => a.localeCompare(b))];
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

    <div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div
        class="rounded-2xl border border-emerald-200/80 bg-emerald-50/70 px-4 py-3"
      >
        <p
          class="text-[11px] font-semibold uppercase tracking-wide text-emerald-800"
        >
          Sent
        </p>
        <p class="mt-1 text-xl font-bold tabular-nums text-emerald-900">
          {{ sentCount }}
        </p>
      </div>
      <div
        class="rounded-2xl border border-rose-200/80 bg-rose-50/70 px-4 py-3"
      >
        <p
          class="text-[11px] font-semibold uppercase tracking-wide text-rose-800"
        >
          Failed
        </p>
        <p class="mt-1 text-xl font-bold tabular-nums text-rose-900">
          {{ failedCount }}
        </p>
      </div>
      <div
        class="rounded-2xl border border-amber-200/80 bg-amber-50/70 px-4 py-3"
      >
        <p
          class="text-[11px] font-semibold uppercase tracking-wide text-amber-800"
        >
          Skipped
        </p>
        <p class="mt-1 text-xl font-bold tabular-nums text-amber-900">
          {{ skippedCount }}
        </p>
      </div>
    </div>

    <div class="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
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
      <div v-else class="max-h-[64dvh] overflow-auto">
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
