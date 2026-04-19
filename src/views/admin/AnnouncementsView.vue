<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { useToastStore } from "../../stores/toast";
import { useAuthStore } from "../../stores/auth";
import SkeletonAdminListCards from "../../components/skeleton/SkeletonAdminListCards.vue";

const toast = useToastStore();
const auth = useAuthStore();

type Row = {
  id: string;
  title: string;
  message: string;
  type: string;
  is_active: boolean;
  created_at: string;
};

const rows = ref<Row[]>([]);
const loading = ref(true);
const title = ref("");
const message = ref("");
const type = ref("info");
const busy = ref(false);

async function load() {
  loading.value = true;
  if (!isSupabaseConfigured()) return;
  const { data, error } = await getSupabaseBrowser()
    .from("announcements")
    .select("id, title, message, type, is_active, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    toast.error(error.message);
    rows.value = [];
  } else rows.value = (data ?? []) as Row[];
  loading.value = false;
}

onMounted(load);

async function createAnn() {
  if (!title.value.trim() || !message.value.trim()) {
    toast.error("Enter a title and message.");
    return;
  }
  busy.value = true;
  const { error } = await getSupabaseBrowser().from("announcements").insert({
    title: title.value.trim(),
    message: message.value.trim(),
    type: type.value,
    is_active: true,
  });
  busy.value = false;
  if (error) toast.error(error.message);
  else {
    title.value = "";
    message.value = "";
    type.value = "info";
    toast.success("Announcement published.");
    await load();
  }
}

async function toggle(r: Row) {
  const { error } = await getSupabaseBrowser()
    .from("announcements")
    .update({ is_active: !r.is_active })
    .eq("id", r.id);
  if (error) toast.error(error.message);
  else {
    toast.success(
      r.is_active ? "Announcement deactivated." : "Announcement activated.",
    );
    await load();
  }
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-slate-900">Announcements</h1>
    <p class="mt-2 text-sm text-slate-600">
      Active announcements are visible to sellers on their dashboard.
    </p>
    <div
      v-if="auth.isSuperAdmin"
      class="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 class="text-sm font-semibold text-slate-800">New announcement</h2>
      <div class="mt-3 grid gap-2 sm:grid-cols-2">
        <input
          v-model="title"
          type="text"
          placeholder="Title"
          class="rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2"
        />
        <textarea
          v-model="message"
          rows="3"
          placeholder="Message"
          class="rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2"
        />
        <select
          v-model="type"
          class="rounded border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="info">info</option>
          <option value="warning">warning</option>
          <option value="urgent">urgent</option>
        </select>
        <button
          type="button"
          class="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
          :disabled="busy"
          @click="createAnn"
        >
          Publish
        </button>
      </div>
    </div>
    <p
      v-else-if="auth.isPlatformStaff"
      class="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
    >
      You are signed in as <strong>Admin</strong>. Publishing and activating
      announcements is limited to <strong>Super admin</strong> accounts.
    </p>
    <SkeletonAdminListCards
      v-if="loading"
      label="Loading announcements"
      :rows="4"
    />
    <ul
      v-else
      class="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white"
    >
      <li v-for="r in rows" :key="r.id" class="px-4 py-4">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p class="font-semibold text-slate-900">{{ r.title }}</p>
            <p class="mt-1 text-sm text-slate-600 whitespace-pre-wrap">
              {{ r.message }}
            </p>
            <p class="mt-2 text-xs text-slate-400">
              {{ r.type }} · {{ new Date(r.created_at).toLocaleString() }} ·
              <span
                :class="r.is_active ? 'text-emerald-600' : 'text-slate-400'"
                >{{ r.is_active ? "active" : "inactive" }}</span
              >
            </p>
          </div>
          <button
            v-if="auth.isSuperAdmin"
            type="button"
            class="text-sm text-violet-700 hover:underline"
            @click="toggle(r)"
          >
            {{ r.is_active ? "Deactivate" : "Activate" }}
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
