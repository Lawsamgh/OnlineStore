<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";
import { resolvePricingPlanId } from "../../lib/planFeatureLimits";
import {
  STORE_THEME_FONTS,
  STORE_THEME_PRESETS,
  allowedThemeIdsForPlan,
  normalizeHexOrNull,
  resolveThemeFont,
  resolveThemePreset,
} from "../../constants/storeThemes";
import UiSkeleton from "../../components/skeleton/UiSkeleton.vue";

const auth = useAuthStore();
const toast = useToastStore();
const { user, sessionUserId } = storeToRefs(auth);

type OwnedStore = {
  id: string;
  name: string;
  slug: string;
  theme_id: string | null;
  theme_primary_color: string | null;
  theme_accent_color: string | null;
  theme_bg_color: string | null;
  theme_surface_color: string | null;
  theme_text_color: string | null;
  theme_font_family: string | null;
};

const loading = ref(true);
const saving = ref(false);
const stores = ref<OwnedStore[]>([]);
const selectedStoreId = ref("");
const panelTab = ref<"colors" | "typography" | "general">("colors");
const colorsSection = ref<"theme-color" | "combinations">("theme-color");

const themeIdInput = ref("default");
const themePrimaryInput = ref("");
const themeAccentInput = ref("");
const themeBgInput = ref("");
const themeSurfaceInput = ref("");
const themeTextInput = ref("");
const themeFontInput = ref("system");

const sellerPlanId = computed(() =>
  resolvePricingPlanId(user.value?.user_metadata?.signup_plan),
);
const selectedStore = computed(
  () => stores.value.find((s) => s.id === selectedStoreId.value) ?? null,
);
const allowedThemeIds = computed(() => allowedThemeIdsForPlan(sellerPlanId.value));
const canEditBasicColors = computed(
  () => sellerPlanId.value === "growth" || sellerPlanId.value === "pro",
);
const canEditFullColors = computed(() => sellerPlanId.value === "pro");
const canEditFont = computed(() => sellerPlanId.value === "pro");
const selectedPreset = computed(() => resolveThemePreset(themeIdInput.value));

const previewTheme = computed(() => ({
  bg: themeBgInput.value || selectedPreset.value.bg,
  surface: themeSurfaceInput.value || selectedPreset.value.surface,
  text: themeTextInput.value || selectedPreset.value.text,
  muted: selectedPreset.value.muted,
  border: selectedPreset.value.border,
  primary: themePrimaryInput.value || selectedPreset.value.primary,
  primaryText: selectedPreset.value.primaryText,
  accent: themeAccentInput.value || selectedPreset.value.accent,
  font: resolveThemeFont(themeFontInput.value).stack,
}));

type ColorRow = {
  label: string;
  model: "primary" | "accent" | "bg" | "surface" | "text";
  enabled: boolean;
};

const generalColorRows = computed((): ColorRow[] => [
  { label: "Primary Background", model: "bg", enabled: canEditFullColors.value },
  { label: "Secondary Background", model: "surface", enabled: canEditFullColors.value },
]);
const textColorRows = computed((): ColorRow[] => [
  { label: "Body Text", model: "text", enabled: canEditFullColors.value },
]);
const buttonColorRows = computed((): ColorRow[] => [
  { label: "Primary Button", model: "primary", enabled: canEditBasicColors.value },
  { label: "Accent / Links", model: "accent", enabled: canEditBasicColors.value },
]);

function getColorValue(model: ColorRow["model"]): string {
  switch (model) {
    case "primary": return themePrimaryInput.value || selectedPreset.value.primary;
    case "accent": return themeAccentInput.value || selectedPreset.value.accent;
    case "bg": return themeBgInput.value || selectedPreset.value.bg;
    case "surface": return themeSurfaceInput.value || selectedPreset.value.surface;
    case "text": return themeTextInput.value || selectedPreset.value.text;
  }
}

function setColorValue(model: ColorRow["model"], val: string) {
  switch (model) {
    case "primary": themePrimaryInput.value = val; break;
    case "accent": themeAccentInput.value = val; break;
    case "bg": themeBgInput.value = val; break;
    case "surface": themeSurfaceInput.value = val; break;
    case "text": themeTextInput.value = val; break;
  }
}

function syncInputsFromStore() {
  const s = selectedStore.value;
  if (!s) return;
  const allowed = allowedThemeIds.value;
  const currentTheme = (s.theme_id ?? "default").trim().toLowerCase();
  themeIdInput.value = allowed.includes(currentTheme as never)
    ? currentTheme
    : (allowed[0] ?? "default");
  themePrimaryInput.value = s.theme_primary_color ?? "";
  themeAccentInput.value = s.theme_accent_color ?? "";
  themeBgInput.value = s.theme_bg_color ?? "";
  themeSurfaceInput.value = s.theme_surface_color ?? "";
  themeTextInput.value = s.theme_text_color ?? "";
  themeFontInput.value = resolveThemeFont(s.theme_font_family).id;
}

watch([selectedStoreId, sellerPlanId], syncInputsFromStore);

async function loadStores() {
  loading.value = true;
  if (!isSupabaseConfigured() || !sessionUserId.value) {
    stores.value = [];
    loading.value = false;
    return;
  }
  const { data, error } = await getSupabaseBrowser()
    .from("stores")
    .select("id, name, slug, theme_id, theme_primary_color, theme_accent_color, theme_bg_color, theme_surface_color, theme_text_color, theme_font_family")
    .eq("owner_id", sessionUserId.value)
    .order("created_at", { ascending: false });
  if (error) {
    toast.error(error.message);
    stores.value = [];
    loading.value = false;
    return;
  }
  stores.value = (data ?? []) as OwnedStore[];
  selectedStoreId.value = stores.value[0]?.id ?? "";
  syncInputsFromStore();
  loading.value = false;
}

async function saveTheme() {
  if (!selectedStore.value || saving.value) return;
  const allowed = allowedThemeIds.value;
  const themeId = allowed.includes(themeIdInput.value as never)
    ? themeIdInput.value
    : (allowed[0] ?? "default");
  const payload: Record<string, string | null> = {
    theme_id: themeId,
    theme_primary_color: canEditBasicColors.value ? normalizeHexOrNull(themePrimaryInput.value) : null,
    theme_accent_color: canEditBasicColors.value ? normalizeHexOrNull(themeAccentInput.value) : null,
    theme_bg_color: canEditFullColors.value ? normalizeHexOrNull(themeBgInput.value) : null,
    theme_surface_color: canEditFullColors.value ? normalizeHexOrNull(themeSurfaceInput.value) : null,
    theme_text_color: canEditFullColors.value ? normalizeHexOrNull(themeTextInput.value) : null,
    theme_font_family: canEditFont.value ? resolveThemeFont(themeFontInput.value).id : "system",
  };
  saving.value = true;
  const { error } = await getSupabaseBrowser()
    .from("stores")
    .update(payload)
    .eq("id", selectedStore.value.id);
  saving.value = false;
  if (error) {
    toast.error(error.message);
    return;
  }
  stores.value = stores.value.map((s) =>
    s.id === selectedStore.value!.id ? { ...s, ...payload } : s,
  );
  toast.success("Theme saved.");
}

function resetToPreset() {
  themePrimaryInput.value = "";
  themeAccentInput.value = "";
  themeBgInput.value = "";
  themeSurfaceInput.value = "";
  themeTextInput.value = "";
}

onMounted(() => {
  void loadStores();
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div
      v-if="loading"
      class="flex min-h-0 flex-1 flex-col"
      aria-busy="true"
      aria-label="Loading theme settings"
    >
      <p class="sr-only">Loading theme settings…</p>
      <div
        class="overflow-hidden rounded-3xl border border-white/60 bg-white/90 shadow-[0_20px_50px_-30px_rgba(15,23,42,0.22)] backdrop-blur-xl"
      >
        <!-- Header skeleton -->
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/80 px-5 py-4">
          <div class="flex min-w-0 items-center gap-3">
            <UiSkeleton variant="line" width-class="w-40" height-class="h-6" :delay="1" />
            <UiSkeleton variant="line" width-class="w-16" height-class="h-5" :delay="2" class="rounded-full" />
          </div>
          <div class="flex items-center gap-2">
            <UiSkeleton variant="line" width-class="w-32" height-class="h-8" :delay="2" class="rounded-xl" />
            <UiSkeleton variant="line" width-class="w-16" height-class="h-8" :delay="3" class="rounded-xl" />
            <UiSkeleton variant="line" width-class="w-24" height-class="h-8" :delay="4" class="rounded-xl" />
          </div>
        </div>

        <div class="grid min-h-[28rem] lg:grid-cols-[200px_1fr_500px]">
          <!-- Left nav skeleton -->
          <nav class="space-y-2 border-b border-zinc-200/80 bg-zinc-50/70 p-3 lg:border-b-0 lg:border-r">
            <UiSkeleton variant="line" width-class="w-14" height-class="h-2.5" :delay="1" class="mx-2" />
            <UiSkeleton v-for="i in 3" :key="`sk-nav-${i}`" variant="rect" height-class="h-10" :delay="i" class="rounded-xl" />
            <UiSkeleton variant="line" width-class="w-16" height-class="h-2.5" :delay="2" class="mx-2 mt-4" />
            <UiSkeleton v-for="i in 4" :key="`sk-pre-${i}`" variant="rect" height-class="h-9" :delay="i + 1" class="rounded-xl" />
          </nav>

          <!-- Center skeleton -->
          <div class="divide-y divide-zinc-200/80 px-5 py-4">
            <div class="flex gap-2 pb-4">
              <UiSkeleton variant="line" width-class="w-24" height-class="h-8" :delay="1" class="rounded-xl" />
              <UiSkeleton variant="line" width-class="w-28" height-class="h-8" :delay="2" class="rounded-xl" />
            </div>
            <div class="space-y-0 pt-2">
              <UiSkeleton variant="line" width-class="w-20" height-class="h-4" :delay="1" class="mb-3" />
              <div v-for="row in 5" :key="`sk-row-${row}`" class="flex items-center justify-between py-2.5">
                <UiSkeleton variant="line" width-class="w-36" height-class="h-4" :delay="row" />
                <UiSkeleton variant="rect" width-class="w-8" height-class="h-8" :delay="row + 1" class="rounded-lg" />
              </div>
            </div>
          </div>

          <!-- Preview skeleton -->
          <aside class="border-t border-zinc-200/80 bg-zinc-50/60 p-5 lg:border-l lg:border-t-0">
            <UiSkeleton variant="line" width-class="w-24" height-class="h-3" :delay="1" />
            <div class="mt-3 overflow-hidden rounded-xl border border-zinc-200/80 bg-white p-3 shadow-sm">
              <UiSkeleton variant="rect" height-class="h-7" :delay="1" class="rounded-lg" />
              <UiSkeleton variant="rect" height-class="h-10" :delay="2" class="mt-3 rounded-lg" />
              <div class="mt-3 grid grid-cols-2 gap-2">
                <UiSkeleton v-for="c in 4" :key="`sk-card-${c}`" variant="rect" height-class="h-24" :delay="c" class="rounded-lg" />
              </div>
              <UiSkeleton variant="rect" height-class="h-8" :delay="3" class="mt-3 rounded-lg" />
            </div>
            <div class="mt-4 flex flex-wrap gap-1.5">
              <UiSkeleton v-for="t in 5" :key="`sk-tok-${t}`" variant="line" width-class="w-20" height-class="h-6" :delay="t" class="rounded-full" />
            </div>
          </aside>
        </div>
      </div>
    </div>
    <div v-else-if="!stores.length" class="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
      <div class="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-200/80 bg-zinc-50 text-2xl">🎨</div>
      <p class="font-semibold text-zinc-800">No stores yet</p>
      <p class="max-w-xs text-sm text-zinc-500">Create a store first to start customising your theme.</p>
    </div>

    <div
      v-else
      class="overflow-hidden rounded-3xl border border-white/60 bg-white/90 shadow-[0_20px_50px_-30px_rgba(15,23,42,0.22)] backdrop-blur-xl"
    >
      <!-- Top bar -->
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/80 px-5 py-4">
        <div class="flex min-w-0 items-center gap-3">
          <span class="text-xl font-bold tracking-tight text-zinc-900">Theme Settings</span>
          <span
            class="inline-flex rounded-full border border-zinc-200/80 bg-zinc-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-600"
          >
            {{ sellerPlanId }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <span
            v-if="selectedStore"
            class="flex items-center gap-1.5 rounded-xl border border-zinc-200/80 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700"
          >
            <svg class="h-3.5 w-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" />
            </svg>
            {{ selectedStore.name }}
          </span>
          <button
            type="button"
            class="rounded-xl border border-zinc-200/90 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
            :disabled="saving"
            @click="resetToPreset"
          >
            Reset
          </button>
          <button
            type="button"
            class="rounded-xl bg-zinc-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
            :disabled="saving"
            @click="saveTheme"
          >
            {{ saving ? "Saving…" : "Save theme" }}
          </button>
        </div>
      </div>

      <!-- Body -->
      <div class="grid lg:grid-cols-[200px_1fr_500px]">

        <!-- Left nav -->
        <nav class="border-b border-zinc-200/80 bg-zinc-50/70 p-3 lg:border-b-0 lg:border-r">
          <p class="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Design</p>
          <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition"
            :class="panelTab === 'colors' ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200/80' : 'text-zinc-600 hover:bg-white/80 hover:text-zinc-900'"
            @click="panelTab = 'colors'"
          >
            <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3c4.97 0 9 3.58 9 8 0 3.87-3.13 7-7 7h-.5a1.5 1.5 0 0 0 0 3H12c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12a2 2 0 0 0 2 2h.5C5.88 14 7 12.88 7 11.5S5.88 9 4.5 9" />
              <circle cx="7.5" cy="9.5" r="1" fill="currentColor" />
              <circle cx="12" cy="7" r="1" fill="currentColor" />
              <circle cx="16.5" cy="9.5" r="1" fill="currentColor" />
            </svg>
            Colors
          </button>
          <button
            type="button"
            class="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition"
            :class="panelTab === 'typography' ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200/80' : 'text-zinc-600 hover:bg-white/80 hover:text-zinc-900'"
            @click="panelTab = 'typography'"
          >
            <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 7V4h16v3M9 20h6M12 4v16" />
            </svg>
            Typography
          </button>
          <button
            type="button"
            class="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition"
            :class="panelTab === 'general' ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200/80' : 'text-zinc-600 hover:bg-white/80 hover:text-zinc-900'"
            @click="panelTab = 'general'"
          >
            <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894Z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            General
          </button>

          <p class="mb-2 mt-5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Presets</p>
          <div class="space-y-1">
            <button
              v-for="preset in STORE_THEME_PRESETS.filter((p) => allowedThemeIds.includes(p.id))"
              :key="`nav-preset-${preset.id}`"
              type="button"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition"
              :class="themeIdInput === preset.id ? 'bg-white font-semibold text-zinc-900 shadow-sm ring-1 ring-zinc-200/80' : 'font-medium text-zinc-600 hover:bg-white/80 hover:text-zinc-900'"
              @click="themeIdInput = preset.id"
            >
              <span
                class="inline-block h-3 w-3 shrink-0 rounded-full"
                :style="{ backgroundColor: preset.primary }"
              />
              {{ preset.label }}
            </button>
            <p
              v-if="STORE_THEME_PRESETS.filter((p) => !allowedThemeIds.includes(p.id)).length"
              class="px-3 pt-1 text-[11px] text-zinc-400"
            >
              Upgrade for more presets
            </p>
          </div>
        </nav>

        <!-- Center panel -->
        <div class="min-h-0 divide-y divide-zinc-200/80">
          <!-- Colors tab -->
          <template v-if="panelTab === 'colors'">
            <div class="px-5 py-3">
              <div class="flex gap-2">
                <button
                  type="button"
                  class="rounded-xl px-3 py-1.5 text-sm font-semibold transition"
                  :class="colorsSection === 'theme-color' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'"
                  @click="colorsSection = 'theme-color'"
                >
                  Theme Color
                </button>
                <button
                  type="button"
                  class="rounded-xl px-3 py-1.5 text-sm font-semibold transition"
                  :class="colorsSection === 'combinations' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'"
                  @click="colorsSection = 'combinations'"
                >
                  Combinations
                </button>
              </div>
            </div>

            <div v-if="colorsSection === 'theme-color'">
              <!-- General section -->
              <div>
                <div class="flex items-center gap-2 px-5 py-2.5">
                  <svg class="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7" /></svg>
                  <span class="text-sm font-semibold text-zinc-800">General</span>
                </div>
                <div
                  v-for="row in generalColorRows"
                  :key="`gen-${row.model}`"
                  class="flex items-center justify-between gap-3 px-5 py-2.5"
                >
                  <span class="text-sm text-zinc-700">{{ row.label }}</span>
                  <label class="relative cursor-pointer" :class="!row.enabled ? 'opacity-40' : ''">
                    <input
                      type="color"
                      class="sr-only"
                      :disabled="!row.enabled"
                      :value="getColorValue(row.model)"
                      @input="setColorValue(row.model, ($event.target as HTMLInputElement).value)"
                    />
                    <span
                      class="block h-8 w-8 rounded-lg border border-zinc-300/80 shadow-sm transition hover:scale-105"
                      :style="{ backgroundColor: getColorValue(row.model) }"
                    />
                  </label>
                </div>
              </div>

              <!-- Text section -->
              <div class="border-t border-zinc-100">
                <div class="flex items-center gap-2 px-5 py-2.5">
                  <svg class="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7" /></svg>
                  <span class="text-sm font-semibold text-zinc-800">Text</span>
                </div>
                <div
                  v-for="row in textColorRows"
                  :key="`text-${row.model}`"
                  class="flex items-center justify-between gap-3 px-5 py-2.5"
                >
                  <span class="text-sm text-zinc-700">{{ row.label }}</span>
                  <label class="relative cursor-pointer" :class="!row.enabled ? 'opacity-40' : ''">
                    <input
                      type="color"
                      class="sr-only"
                      :disabled="!row.enabled"
                      :value="getColorValue(row.model)"
                      @input="setColorValue(row.model, ($event.target as HTMLInputElement).value)"
                    />
                    <span
                      class="block h-8 w-8 rounded-lg border border-zinc-300/80 shadow-sm transition hover:scale-105"
                      :style="{ backgroundColor: getColorValue(row.model) }"
                    />
                  </label>
                </div>
              </div>

              <!-- Buttons section -->
              <div class="border-t border-zinc-100">
                <div class="flex items-center gap-2 px-5 py-2.5">
                  <svg class="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7" /></svg>
                  <span class="text-sm font-semibold text-zinc-800">Buttons</span>
                </div>
                <div
                  v-for="row in buttonColorRows"
                  :key="`btn-${row.model}`"
                  class="flex items-center justify-between gap-3 px-5 py-2.5"
                >
                  <span class="text-sm text-zinc-700">{{ row.label }}</span>
                  <label class="relative cursor-pointer" :class="!row.enabled ? 'opacity-40' : ''">
                    <input
                      type="color"
                      class="sr-only"
                      :disabled="!row.enabled"
                      :value="getColorValue(row.model)"
                      @input="setColorValue(row.model, ($event.target as HTMLInputElement).value)"
                    />
                    <span
                      class="block h-8 w-8 rounded-lg border border-zinc-300/80 shadow-sm transition hover:scale-105"
                      :style="{ backgroundColor: getColorValue(row.model) }"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div v-else class="space-y-2 px-5 py-4">
              <div class="flex flex-wrap gap-2">
                <div
                  v-for="preset in STORE_THEME_PRESETS.filter((p) => allowedThemeIds.includes(p.id))"
                  :key="`combo-${preset.id}`"
                  class="flex cursor-pointer flex-col gap-1.5 rounded-xl border p-2.5 transition hover:shadow-md"
                  :class="themeIdInput === preset.id ? 'border-zinc-900 ring-1 ring-zinc-900' : 'border-zinc-200'"
                  @click="themeIdInput = preset.id"
                >
                  <div class="flex gap-1">
                    <span class="h-5 w-5 rounded" :style="{ backgroundColor: preset.primary }" />
                    <span class="h-5 w-5 rounded" :style="{ backgroundColor: preset.accent }" />
                    <span class="h-5 w-5 rounded" :style="{ backgroundColor: preset.bg }" />
                  </div>
                  <p class="text-[11px] font-semibold text-zinc-700">{{ preset.label }}</p>
                </div>
              </div>
            </div>
          </template>

          <!-- Typography tab -->
          <template v-else-if="panelTab === 'typography'">
            <div class="border-t border-zinc-100">
              <div class="flex items-center gap-2 px-5 py-2.5">
                <svg class="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7" /></svg>
                <span class="text-sm font-semibold text-zinc-800">Font family</span>
              </div>
              <div
                v-for="font in STORE_THEME_FONTS"
                :key="`font-${font.id}`"
                class="flex cursor-pointer items-center justify-between gap-3 px-5 py-2.5 transition hover:bg-zinc-50"
                :class="!canEditFont ? 'opacity-40 pointer-events-none' : ''"
                @click="canEditFont && (themeFontInput = font.id)"
              >
                <div>
                  <p class="text-sm text-zinc-700">{{ font.label }}</p>
                  <p class="mt-0.5 text-xs text-zinc-400" :style="{ fontFamily: font.stack }">Aa — The quick brown fox</p>
                </div>
                <span
                  v-if="themeFontInput === font.id"
                  class="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-white"
                >
                  <svg class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
                </span>
              </div>
              <p v-if="!canEditFont" class="px-5 pb-3 text-xs text-zinc-400">Font customization requires Pro plan.</p>
            </div>
          </template>

          <!-- General tab -->
          <template v-else>
            <div class="space-y-3 px-5 py-4">
              <div class="rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-3.5">
                <p class="text-sm font-semibold text-zinc-800">Scope</p>
                <p class="mt-1 text-sm text-zinc-600">Theme applies only to customer-facing storefront pages.</p>
              </div>
              <div class="rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-3.5">
                <p class="text-sm font-semibold text-zinc-800">Plan access</p>
                <ul class="mt-1.5 space-y-1 text-sm text-zinc-600">
                  <li class="flex items-center gap-2"><span class="h-1.5 w-1.5 rounded-full bg-zinc-400" />Free/Starter — default preset only</li>
                  <li class="flex items-center gap-2"><span class="h-1.5 w-1.5 rounded-full bg-zinc-400" />Growth — 3 presets + primary/accent colors</li>
                  <li class="flex items-center gap-2"><span class="h-1.5 w-1.5 rounded-full bg-zinc-400" />Pro — all presets + full color + font control</li>
                </ul>
              </div>
            </div>
          </template>
        </div>

        <!-- Right preview -->
        <aside class="border-t border-zinc-200/80 bg-zinc-50/60 p-5 lg:border-l lg:border-t-0">
          <div class="flex items-center justify-between">
            <p class="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Live preview</p>
            <span class="rounded-full bg-zinc-200/80 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">Storefront</span>
          </div>

          <!-- Simulated browser chrome -->
          <div class="mt-2 overflow-hidden rounded-xl border border-zinc-300/80 shadow-md" :style="{ fontFamily: previewTheme.font }">
            <!-- Browser bar -->
            <div class="flex items-center gap-2 border-b border-zinc-200 bg-zinc-100 px-3 py-2">
              <span class="h-2 w-2 rounded-full bg-red-400/80" />
              <span class="h-2 w-2 rounded-full bg-yellow-400/80" />
              <span class="h-2 w-2 rounded-full bg-green-400/80" />
              <div class="ml-2 flex-1 rounded bg-white px-2 py-0.5 text-[10px] text-zinc-400">
                /{{ selectedStore?.slug ?? 'your-store' }}
              </div>
            </div>

            <!-- Storefront -->
            <div :style="{ backgroundColor: previewTheme.bg }">
              <!-- Nav -->
              <div
                class="flex items-center justify-between border-b px-4 py-2.5"
                :style="{ backgroundColor: previewTheme.surface, borderColor: previewTheme.border }"
              >
                <p class="text-sm font-bold" :style="{ color: previewTheme.text }">{{ selectedStore?.name ?? 'My Shop' }}</p>
                <div class="flex items-center gap-2">
                  <span class="text-[11px]" :style="{ color: previewTheme.muted }">Search</span>
                  <span
                    class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    :style="{ backgroundColor: previewTheme.primary, color: previewTheme.primaryText }"
                  >Cart 2</span>
                </div>
              </div>

              <!-- Products grid -->
              <div class="grid grid-cols-2 gap-2.5 p-3">
                <div
                  v-for="n in 4"
                  :key="`prod-${n}`"
                  class="overflow-hidden rounded-lg border"
                  :style="{ backgroundColor: previewTheme.surface, borderColor: previewTheme.border }"
                >
                  <div
                    class="h-16 w-full"
                    :style="{ backgroundColor: n % 2 === 0 ? previewTheme.accent + '33' : previewTheme.primary + '22' }"
                  />
                  <div class="p-2">
                    <p class="text-[11px] font-semibold leading-tight" :style="{ color: previewTheme.text }">
                      {{ ['Sneakers', 'Bag', 'Watch', 'Cap'][n - 1] }}
                    </p>
                    <p class="mt-0.5 text-[10px]" :style="{ color: previewTheme.muted }">In stock</p>
                    <p class="mt-0.5 text-xs font-bold" :style="{ color: previewTheme.primary }">GH₵ {{ [120, 85, 220, 45][n - 1] }}</p>
                    <button
                      type="button"
                      class="mt-1.5 w-full rounded py-1 text-[10px] font-semibold"
                      :style="{ backgroundColor: previewTheme.primary, color: previewTheme.primaryText }"
                    >
                      Add to cart
                    </button>
                  </div>
                </div>
              </div>

              <!-- Footer strip -->
              <div
                class="border-t px-4 py-2 text-center"
                :style="{ backgroundColor: previewTheme.surface, borderColor: previewTheme.border }"
              >
                <p class="text-[10px]" :style="{ color: previewTheme.muted }">Powered by UandITech</p>
              </div>
            </div>
          </div>

          <!-- Color tokens -->
          <div class="mt-4 space-y-2">
            <p class="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Color tokens</p>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="(col, label) in { Primary: previewTheme.primary, Accent: previewTheme.accent, Background: previewTheme.bg, Surface: previewTheme.surface, Text: previewTheme.text }"
                :key="`tok-${label}`"
                class="flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-[10px] font-medium text-zinc-700"
              >
                <span class="h-3 w-3 rounded-full border border-zinc-200/60" :style="{ backgroundColor: col }" />
                {{ label }}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>
