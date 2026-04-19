<script setup lang="ts">
import { computed, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import AppToastStack from "./components/AppToastStack.vue";
import CartDrawer from "./components/CartDrawer.vue";
import { isSupabaseConfigured } from "./lib/supabase";
import { useAuthStore } from "./stores/auth";
import { useCartStore } from "./stores/cart";
import { useUiStore } from "./stores/ui";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const cart = useCartStore();
const ui = useUiStore();
const supabaseReady = isSupabaseConfigured();

const hideMainHeader = computed(
  () =>
    route.path.startsWith("/dashboard") ||
    route.path.startsWith("/admin") ||
    route.name === "console-access-pending",
);

/** Which marketing home section is active (hash on `home` route). */
const homeNavSection = computed<"home" | "features" | "pricing" | null>(() => {
  if (route.name !== "home") return null;
  const h = route.hash || "";
  if (h === "#features") return "features";
  if (h === "#pricing") return "pricing";
  return "home";
});

const navPillBase =
  "rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 ease-out active:scale-[0.98]";
const navPillInactive =
  "text-zinc-600 hover:bg-white/75 hover:text-zinc-900 hover:shadow-sm";
const navPillActive =
  "bg-zinc-900 font-semibold text-white shadow-md shadow-zinc-900/25 ring-1 ring-zinc-800/40";

const navMobileBase =
  "rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-200";
const navMobileInactive = "text-zinc-600 hover:bg-white/60 hover:text-zinc-900";
const navMobileActive =
  "bg-zinc-900 font-semibold text-white shadow-md shadow-zinc-900/20 ring-1 ring-zinc-800/40";

async function signOut() {
  try {
    await auth.signOut();
    await router.replace({ name: "home" });
  } catch {
    /* handled in UI elsewhere if needed */
  }
}

function onNavAvatarError() {
  auth.clearProfileAvatarPreview();
}

watch(
  () => auth.sessionUserId,
  (id) => {
    if (id) void auth.refreshProfileAvatar();
  },
  { immediate: true },
);
</script>

<template>
  <div
    :class="[
      'flex flex-col bg-white text-zinc-900',
      hideMainHeader
        ? 'h-dvh max-h-dvh min-h-0 overflow-hidden'
        : 'min-h-svh',
    ]"
  >
    <header
      v-if="!hideMainHeader"
      class="sticky top-0 z-50 border-b border-white/25 bg-white/50 shadow-[0_8px_40px_-12px_rgba(15,23,42,0.12)] backdrop-blur-2xl backdrop-saturate-150 transition-[background-color,box-shadow,border-color] duration-300 supports-[backdrop-filter]:bg-white/[0.42]"
    >
      <nav
        class="mx-auto flex max-w-[min(100%,120rem)] items-center justify-between gap-3 px-4 py-3.5 sm:px-6 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:gap-6 lg:px-8 xl:px-12 2xl:px-16"
      >
        <RouterLink
          to="/"
          class="group shrink-0 inline-flex items-center gap-2.5 rounded-xl py-0.5 pr-1 text-lg font-bold tracking-tight text-zinc-950 transition-colors duration-200 hover:text-zinc-700"
          aria-label="U and I Tech Solutions — Home"
        >
          <span
            class="flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-xl bg-zinc-900 text-[11px] font-extrabold leading-none tracking-tight text-lime-400 shadow-md shadow-zinc-900/20 ring-1 ring-zinc-800/80 transition-transform duration-200 group-hover:scale-[1.04] motion-reduce:group-hover:scale-100"
            aria-hidden="true"
          >
            UI
          </span>
          <span class="min-w-0 leading-tight">U&amp;I Tech Solutions</span>
        </RouterLink>

        <div
          class="hidden items-center justify-center gap-1 rounded-full bg-zinc-900/[0.06] p-1 ring-1 ring-zinc-200/50 backdrop-blur-sm lg:flex"
        >
          <RouterLink
            to="/"
            :class="[
              navPillBase,
              homeNavSection === 'home' ? navPillActive : navPillInactive,
            ]"
          >
            Home
          </RouterLink>
          <RouterLink
            :to="{ name: 'home', hash: '#features' }"
            :class="[
              navPillBase,
              homeNavSection === 'features' ? navPillActive : navPillInactive,
            ]"
          >
            Features
          </RouterLink>
          <RouterLink
            :to="{ name: 'home', hash: '#pricing' }"
            :class="[
              navPillBase,
              homeNavSection === 'pricing' ? navPillActive : navPillInactive,
            ]"
          >
            Pricing
          </RouterLink>
          <RouterLink
            v-if="supabaseReady && auth.isSignedIn"
            to="/dashboard"
            :class="[navPillBase, navPillInactive]"
          >
            Dashboard
          </RouterLink>
          <RouterLink
            v-if="supabaseReady && auth.isSignedIn && auth.isPlatformStaff"
            to="/admin"
            class="rounded-full px-4 py-2 text-sm font-medium text-violet-700 transition-all duration-200 ease-out hover:bg-violet-100/60 hover:shadow-sm active:scale-[0.98]"
          >
            Admin
          </RouterLink>
        </div>

        <div class="flex shrink-0 items-center justify-end gap-2 sm:gap-3">
          <button
            v-if="cart.itemCount > 0"
            type="button"
            class="relative rounded-full border border-white/40 bg-white/55 px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm backdrop-blur-md transition-all duration-200 hover:border-white/60 hover:bg-white/75 hover:shadow-md active:scale-[0.98]"
            aria-label="Open cart"
            @click="ui.toggleCart()"
          >
            Cart
            <span
              class="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-lime-400 px-1 text-[10px] font-bold text-zinc-900"
              >{{ cart.itemCount }}</span
            >
          </button>
          <template v-if="supabaseReady">
            <RouterLink
              v-if="!auth.isSignedIn"
              to="/login"
              class="hidden text-sm font-medium text-zinc-600 transition hover:text-zinc-900 sm:inline"
            >
              Log in
            </RouterLink>
            <RouterLink
              v-if="!auth.isSignedIn"
              :to="{ name: 'login', query: { mode: 'sign-up' } }"
              class="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-zinc-900/25 transition-all duration-200 hover:bg-zinc-800 hover:shadow-lg active:scale-[0.98]"
            >
              Sign up
            </RouterLink>
            <RouterLink
              v-else
              to="/dashboard"
              class="hidden items-center gap-2 md:inline-flex"
              title="Dashboard"
            >
              <span
                class="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-xs font-bold text-white shadow-sm ring-2 ring-white/80"
              >
                <img
                  v-if="auth.profileAvatarPublicUrl"
                  :src="auth.profileAvatarPublicUrl"
                  alt=""
                  class="h-full w-full object-cover"
                  @error="onNavAvatarError"
                />
                <span v-else aria-hidden="true">{{
                  auth.userDisplayInitial
                }}</span>
              </span>
              <span
                class="max-w-[140px] truncate text-xs text-zinc-500 lg:max-w-[200px]"
                >{{ auth.user?.email ?? "Signed in" }}</span
              >
            </RouterLink>
            <button
              v-if="auth.isSignedIn"
              type="button"
              class="rounded-full border border-white/45 bg-white/55 px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm backdrop-blur-md transition-all duration-200 hover:border-white/65 hover:bg-white/80 active:scale-[0.98]"
              @click="signOut"
            >
              Sign out
            </button>
          </template>
        </div>
      </nav>
      <div
        class="border-t border-white/20 bg-white/35 px-4 py-2.5 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/30 lg:hidden"
      >
        <div
          class="mx-auto flex max-w-[min(100%,120rem)] flex-wrap justify-center gap-1.5 sm:px-6 xl:px-12 2xl:px-16"
        >
          <RouterLink
            to="/"
            :class="[
              navMobileBase,
              homeNavSection === 'home' ? navMobileActive : navMobileInactive,
            ]"
          >
            Home
          </RouterLink>
          <RouterLink
            :to="{ name: 'home', hash: '#features' }"
            :class="[
              navMobileBase,
              homeNavSection === 'features' ? navMobileActive : navMobileInactive,
            ]"
          >
            Features
          </RouterLink>
          <RouterLink
            :to="{ name: 'home', hash: '#pricing' }"
            :class="[
              navMobileBase,
              homeNavSection === 'pricing' ? navMobileActive : navMobileInactive,
            ]"
          >
            Pricing
          </RouterLink>
          <RouterLink
            v-if="supabaseReady && auth.isSignedIn"
            to="/dashboard"
            :class="[navMobileBase, navMobileInactive]"
          >
            Dashboard
          </RouterLink>
        </div>
      </div>
    </header>
    <main
      :class="
        route.path.startsWith('/dashboard') || route.path.startsWith('/admin')
          ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent'
          : 'min-w-0 flex-1 bg-white'
      "
    >
      <RouterView />
    </main>
    <CartDrawer />
    <AppToastStack />
  </div>
</template>
