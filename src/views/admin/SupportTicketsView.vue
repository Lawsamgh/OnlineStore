<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { useRealtimeTableRefresh } from "../../composables/useRealtimeTableRefresh";
import { useToastStore } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import SkeletonAdminListCards from "../../components/skeleton/SkeletonAdminListCards.vue";

const toast = useToastStore();
const ui = useUiStore();

type Row = {
  id: string;
  store_id: string;
  subject: string;
  message: string;
  status: string;
  created_at: string;
  stores: { name: string; slug: string } | null;
};

const rows = ref<Row[]>([]);
const loading = ref(true);

async function load(opts?: { silent?: boolean }) {
  const silent = opts?.silent ?? false;
  if (!silent) loading.value = true;
  if (!isSupabaseConfigured()) {
    if (!silent) loading.value = false;
    return;
  }
  try {
    const { data, error } = await getSupabaseBrowser()
      .from("support_tickets")
      .select(
        "id, store_id, subject, message, status, created_at, stores(name, slug)",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      toast.error(error.message);
      rows.value = [];
    } else {
      rows.value = (data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        stores: r.stores as Row["stores"],
      })) as Row[];
    }
  } finally {
    if (!silent) loading.value = false;
    void ui.refreshAdminOpenTicketCount();
  }
}

onMounted(() => {
  void load();
});

useRealtimeTableRefresh({
  channelName: "admin-support-tickets",
  deps: [loading],
  getTables: () => [{ table: "support_tickets" }],
  onEvent: () => load({ silent: true }),
});

async function setStatus(id: string, status: string) {
  const { error } = await getSupabaseBrowser()
    .from("support_tickets")
    .update({ status })
    .eq("id", id);
  if (error) toast.error(error.message);
  else {
    toast.success(status === "closed" ? "Ticket closed." : "Ticket reopened.");
    await load({ silent: true });
  }
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-slate-900">Support tickets</h1>
    <p class="mt-2 text-sm text-slate-600">
      Tickets opened by sellers from their stores.
    </p>
    <SkeletonAdminListCards
      v-if="loading"
      label="Loading support tickets"
      :rows="5"
    />
    <ul v-else class="mt-6 space-y-4">
      <li
        v-for="r in rows"
        :key="r.id"
        class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p class="font-semibold text-slate-900">{{ r.subject }}</p>
            <p class="text-xs text-slate-500">
              {{ r.stores?.name ?? "Store" }} ({{ r.stores?.slug }}) ·
              {{ new Date(r.created_at).toLocaleString() }}
            </p>
            <p class="mt-2 text-sm text-slate-700 whitespace-pre-wrap">
              {{ r.message }}
            </p>
          </div>
          <div class="flex gap-2">
            <button
              v-if="r.status === 'open'"
              type="button"
              class="text-sm text-slate-600 hover:underline"
              @click="setStatus(r.id, 'closed')"
            >
              Close
            </button>
            <button
              v-else
              type="button"
              class="text-sm text-emerald-700 hover:underline"
              @click="setStatus(r.id, 'open')"
            >
              Reopen
            </button>
          </div>
        </div>
      </li>
    </ul>
    <p v-if="!loading && !rows.length" class="mt-6 text-slate-500">
      No tickets yet.
    </p>
  </div>
</template>
