<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { useToastStore } from "../../stores/toast";
import { useAuthStore } from "../../stores/auth";
import SkeletonAdminKvRows from "../../components/skeleton/SkeletonAdminKvRows.vue";

const toast = useToastStore();
const auth = useAuthStore();

const rows = ref<{ id: string; key: string; value: string }[]>([]);
const loading = ref(true);
const newKey = ref("");
const newVal = ref("");
const busy = ref(false);

async function load() {
  loading.value = true;
  if (!isSupabaseConfigured()) return;
  const { data, error } = await getSupabaseBrowser()
    .from("platform_settings")
    .select("id, key, value")
    .order("key");
  if (error) {
    toast.error(error.message);
    rows.value = [];
  } else rows.value = (data ?? []) as typeof rows.value;
  loading.value = false;
}

onMounted(load);

async function addRow() {
  if (!newKey.value.trim() || !newVal.value.trim()) {
    toast.error("Enter both key and value.");
    return;
  }
  busy.value = true;
  const { error } = await getSupabaseBrowser()
    .from("platform_settings")
    .insert({
      key: newKey.value.trim(),
      value: newVal.value.trim(),
    });
  busy.value = false;
  if (error) toast.error(error.message);
  else {
    newKey.value = "";
    newVal.value = "";
    toast.success("Setting added.");
    await load();
  }
}

async function save(r: { id: string; value: string }) {
  const { error } = await getSupabaseBrowser()
    .from("platform_settings")
    .update({ value: r.value })
    .eq("id", r.id);
  if (error) toast.error(error.message);
  else toast.success("Setting saved.");
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-slate-900">Platform settings</h1>
    <p class="mt-2 text-sm text-slate-600">
      Key/value pairs for global configuration.
    </p>
    <SkeletonAdminKvRows v-if="loading" :rows="6" />
    <div v-else class="mt-6 space-y-4">
      <p
        v-if="auth.isPlatformStaff && !auth.isSuperAdmin"
        class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
      >
        You are signed in as <strong>Admin</strong>. Values are read-only;
        adding or changing settings requires a
        <strong>Super admin</strong> account.
      </p>
      <div
        v-for="r in rows"
        :key="r.id"
        class="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3"
      >
        <div class="min-w-[140px] flex-1">
          <label class="text-xs text-slate-500">Key</label>
          <p class="font-mono text-sm text-slate-900">{{ r.key }}</p>
        </div>
        <div class="min-w-[200px] flex-[2]">
          <label class="text-xs text-slate-500">Value</label>
          <input
            v-model="r.value"
            type="text"
            class="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-600"
            :disabled="!auth.isSuperAdmin"
            @change="save(r)"
          />
        </div>
      </div>
      <div
        v-if="auth.isSuperAdmin"
        class="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4"
      >
        <h2 class="text-sm font-semibold text-slate-800">Add setting</h2>
        <div class="mt-2 flex flex-wrap gap-2">
          <input
            v-model="newKey"
            type="text"
            placeholder="key"
            class="min-w-[120px] flex-1 rounded border border-slate-300 px-2 py-1 text-sm font-mono"
          />
          <input
            v-model="newVal"
            type="text"
            placeholder="value"
            class="min-w-[160px] flex-[2] rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            class="rounded-lg bg-violet-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
            :disabled="busy"
            @click="addRow"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
