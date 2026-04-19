<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { waMeLink } from "../../lib/whatsapp";
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
} | null>(null);

async function loadHeaderStore() {
  headerStore.value = null;
  if (!isSupabaseConfigured() || !slug.value) return;
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from("stores")
    .select("id, slug, name, description, logo_path, whatsapp_phone_e164")
    .eq("slug", slug.value)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return;
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
  };
}

watch(slug, loadHeaderStore, { immediate: true });

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

const whatsappHref = computed(() => {
  const w = headerStore.value?.whatsapp_phone_e164;
  if (!w) return null;
  const text = encodeURIComponent(
    `Hi ${headerStore.value?.name ?? "there"}, I have a question about your shop.`,
  );
  return waMeLink(w, text);
});

const cartForThisStore = computed(
  () =>
    !!headerStore.value &&
    cart.lines.length > 0 &&
    cart.storeSlug === headerStore.value.slug,
);

const showCheckoutLink = computed(() => cartForThisStore.value);
</script>

<template>
  <div class="flex min-h-svh flex-col bg-slate-50 text-slate-900">
    <header
      class="sticky top-0 z-40 border-b border-slate-200/90 bg-white/90 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.12)] backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/75"
    >
      <div
        class="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-5"
      >
        <RouterLink
          :to="`/${slug}`"
          class="group flex min-w-0 flex-1 items-center gap-3 rounded-xl py-0.5 pr-2 outline-none ring-slate-900/10 transition hover:bg-slate-50/80 focus-visible:ring-2"
        >
          <div
            class="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200/90 bg-slate-100 shadow-sm ring-1 ring-white/80 transition group-hover:border-slate-300 sm:h-12 sm:w-12 sm:rounded-2xl"
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
              class="truncate text-base font-bold tracking-tight text-slate-900 sm:text-lg"
            >
              {{ headerStore?.name ?? "Shop" }}
            </p>
            <p
              v-if="headerStore?.description"
              class="truncate text-[11px] font-medium leading-snug text-slate-500 sm:text-xs"
            >
              {{ headerStore.description }}
            </p>
          </div>
        </RouterLink>

        <div class="flex shrink-0 items-center gap-2 sm:gap-2.5">
          <a
            v-if="whatsappHref"
            :href="whatsappHref"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-10 items-center justify-center rounded-xl border border-emerald-200/90 bg-emerald-50/90 px-3 text-xs font-bold uppercase tracking-wide text-emerald-900 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-100/90 sm:px-3.5"
          >
            <span class="hidden sm:inline">WhatsApp</span>
            <span class="sm:hidden" aria-hidden="true">WA</span>
          </a>
          <button
            v-if="cartForThisStore"
            type="button"
            class="relative inline-flex h-10 min-w-[2.5rem] items-center justify-center rounded-xl border border-slate-200/90 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            aria-label="Open cart"
            @click="ui.toggleCart()"
          >
            Cart
            <span
              class="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-lime-400 px-1 text-[10px] font-bold text-slate-900 shadow-sm ring-2 ring-white"
              >{{ cart.itemCount > 9 ? "9+" : cart.itemCount }}</span
            >
          </button>
          <RouterLink
            v-if="showCheckoutLink"
            :to="`/${slug}/checkout`"
            class="inline-flex h-10 items-center justify-center rounded-xl bg-slate-900 px-3.5 text-xs font-bold text-white shadow-md transition hover:bg-slate-800 sm:text-sm"
          >
            Checkout
          </RouterLink>
        </div>
      </div>
    </header>

    <main class="min-w-0 flex-1">
      <RouterView />
    </main>
  </div>
</template>
