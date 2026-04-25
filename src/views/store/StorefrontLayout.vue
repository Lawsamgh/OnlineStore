<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { resolveStoreThemeTokens } from "../../constants/storeThemes";
import { useRealtimeTableRefresh } from "../../composables/useRealtimeTableRefresh";
import { useCartStore } from "../../stores/cart";
import { useUiStore } from "../../stores/ui";

const route = useRoute();
const cart = useCartStore();
const ui = useUiStore();

const slug = computed(() => String(route.params.storeSlug ?? ""));

const headerStore = ref<{
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo_path: string | null;
  whatsapp_phone_e164: string | null;
  theme_id: string | null;
  theme_primary_color: string | null;
  theme_accent_color: string | null;
  theme_bg_color: string | null;
  theme_surface_color: string | null;
  theme_text_color: string | null;
  theme_font_family: string | null;
} | null>(null);

async function loadHeaderStore(opts?: { silent?: boolean }) {
  const silent = opts?.silent ?? false;
  if (!silent) headerStore.value = null;
  if (!isSupabaseConfigured() || !slug.value) {
    if (!silent) headerStore.value = null;
    return;
  }
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from("stores")
    .select(
      "id, slug, name, description, logo_path, whatsapp_phone_e164, theme_id, theme_primary_color, theme_accent_color, theme_bg_color, theme_surface_color, theme_text_color, theme_font_family",
    )
    .eq("slug", slug.value)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) {
    headerStore.value = null;
    return;
  }
  headerStore.value = {
    id: String(data.id),
    slug: String(data.slug),
    name: String(data.name),
    description:
      typeof data.description === "string" && data.description.trim()
        ? data.description.trim()
        : null,
    logo_path:
      typeof data.logo_path === "string" && data.logo_path.trim()
        ? data.logo_path.trim()
        : null,
    whatsapp_phone_e164:
      typeof data.whatsapp_phone_e164 === "string" &&
      data.whatsapp_phone_e164.trim()
        ? data.whatsapp_phone_e164.trim()
        : null,
    theme_id:
      typeof data.theme_id === "string" && data.theme_id.trim()
        ? data.theme_id.trim()
        : null,
    theme_primary_color:
      typeof data.theme_primary_color === "string" &&
      data.theme_primary_color.trim()
        ? data.theme_primary_color.trim()
        : null,
    theme_accent_color:
      typeof data.theme_accent_color === "string" && data.theme_accent_color.trim()
        ? data.theme_accent_color.trim()
        : null,
    theme_bg_color:
      typeof data.theme_bg_color === "string" && data.theme_bg_color.trim()
        ? data.theme_bg_color.trim()
        : null,
    theme_surface_color:
      typeof data.theme_surface_color === "string" &&
      data.theme_surface_color.trim()
        ? data.theme_surface_color.trim()
        : null,
    theme_text_color:
      typeof data.theme_text_color === "string" && data.theme_text_color.trim()
        ? data.theme_text_color.trim()
        : null,
    theme_font_family:
      typeof data.theme_font_family === "string" && data.theme_font_family.trim()
        ? data.theme_font_family.trim()
        : null,
  };
}

watch(
  slug,
  () => {
    void loadHeaderStore();
  },
  { immediate: true },
);

useRealtimeTableRefresh({
  channelName: () =>
    `storefront-header:${slug.value}:${headerStore.value?.id ?? "pending"}`,
  deps: [slug, () => headerStore.value?.id ?? ""],
  debounceMs: 400,
  getTables: () => {
    const id = headerStore.value?.id;
    if (!id) return [];
    return [{ table: "stores", filter: `id=eq.${id}` }];
  },
  onEvent: () => loadHeaderStore({ silent: true }),
});

function logoPublicUrl(): string | null {
  const s = headerStore.value;
  if (!s?.id || !isSupabaseConfigured()) return null;
  const p = s.logo_path?.trim();
  const key = p && p.length > 0 ? p : `${s.id}/logo`;
  const { data } = getSupabaseBrowser()
    .storage.from("store-logos")
    .getPublicUrl(key);
  return data.publicUrl;
}

const storeInitial = computed(() => {
  const n = headerStore.value?.name?.trim();
  if (!n) return "?";
  return n[0]!.toUpperCase();
});

const cartForThisStore = computed(
  () =>
    !!headerStore.value &&
    cart.lines.length > 0 &&
    cart.storeSlug === headerStore.value.slug,
);


const storefrontTheme = computed(() =>
  resolveStoreThemeTokens(headerStore.value ?? {}),
);
</script>

<template>
  <div
    class="flex min-h-svh flex-col"
    :style="{
      backgroundColor: storefrontTheme.bg,
      color: storefrontTheme.text,
      fontFamily: storefrontTheme.fontFamily,
    }"
  >
    <header
      class="sticky top-0 z-40 border-b shadow-[0_8px_30px_-12px_rgba(15,23,42,0.12)] backdrop-blur-xl backdrop-saturate-150"
      :style="{
        borderColor: storefrontTheme.border,
        backgroundColor: `${storefrontTheme.surface}e6`,
      }"
    >
      <div
        class="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-5"
      >
        <RouterLink
          :to="`/${slug}`"
          class="group flex min-w-0 flex-1 items-center gap-3 rounded-xl py-0.5 pr-2 outline-none transition focus-visible:ring-2"
          :style="{ '--store-hover': `${storefrontTheme.bg}` }"
        >
          <div
            class="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border shadow-sm ring-1 ring-white/80 transition sm:h-12 sm:w-12 sm:rounded-2xl"
            :style="{
              borderColor: storefrontTheme.border,
              backgroundColor: storefrontTheme.bg,
            }"
          >
            <img
              v-if="logoPublicUrl()"
              :src="logoPublicUrl()!"
              alt=""
              class="h-full w-full object-cover"
              @error="
                ($event.target as HTMLImageElement).style.display = 'none'
              "
            />
            <span
              v-if="!logoPublicUrl()"
              class="text-lg font-bold tracking-tight text-slate-500 sm:text-xl"
              aria-hidden="true"
              >{{ storeInitial }}</span
            >
          </div>
          <div class="min-w-0 flex-1 text-left">
            <p
              class="truncate text-base font-bold tracking-tight sm:text-lg"
              :style="{ color: storefrontTheme.text }"
            >
              {{ headerStore?.name ?? "Shop" }}
            </p>
            <p
              v-if="headerStore?.description"
              class="truncate text-[11px] font-medium leading-snug sm:text-xs"
              :style="{ color: storefrontTheme.muted }"
            >
              {{ headerStore.description }}
            </p>
          </div>
        </RouterLink>

        <div class="flex shrink-0 items-center gap-2 sm:gap-2.5">
          <RouterLink
            :to="{ name: 'store-order-track', params: { storeSlug: slug } }"
            class="inline-flex h-10 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold shadow-sm transition active:scale-95 sm:px-3 sm:text-sm"
            :style="{
              borderColor: storefrontTheme.border,
              backgroundColor: storefrontTheme.surface,
              color: storefrontTheme.text,
            }"
          >
            <svg class="h-4 w-4 shrink-0 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            <span class="hidden sm:inline">Track</span>
          </RouterLink>
          <button
            v-if="cartForThisStore"
            type="button"
            class="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border shadow-sm transition active:scale-95"
            :style="{
              borderColor: storefrontTheme.border,
              backgroundColor: storefrontTheme.surface,
              color: storefrontTheme.text,
            }"
            aria-label="Open cart"
            @click="ui.toggleCart()"
          >
            <!-- Shopping bag icon -->
            <svg
              class="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            <!-- Item count badge -->
            <span
              class="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold shadow ring-2 ring-white"
              :style="{
                backgroundColor: storefrontTheme.primary,
                color: storefrontTheme.primaryText,
              }"
            >{{ cart.itemCount > 9 ? "9+" : cart.itemCount }}</span>
          </button>
        </div>
      </div>
    </header>

    <main class="min-w-0 flex-1">
      <RouterView />
    </main>
  </div>
</template>
