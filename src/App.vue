<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
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

const isStorefrontRoute = computed(() =>
  ["store", "store-checkout", "order-success"].includes(String(route.name)),
);

/** Marketing + cart header hidden on dashboard, admin, storefront, and console-pending. */
const hideMainHeader = computed(
  () =>
    route.path.startsWith("/dashboard") ||
    route.path.startsWith("/admin") ||
    route.name === "console-access-pending" ||
    isStorefrontRoute.value,
);

/** Lock document height (no outer scroll) only for app shells, not customer storefronts. */
const lockRootShellViewport = computed(
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

const navProfileOpen = ref(false);
const navProfileWrapRef = ref<HTMLElement | null>(null);

function closeNavProfileMenu() {
  navProfileOpen.value = false;
}

function toggleNavProfileMenu() {
  navProfileOpen.value = !navProfileOpen.value;
}

function onNavProfilePointerDownCapture(ev: MouseEvent | PointerEvent) {
  const root = navProfileWrapRef.value;
  if (!root || !navProfileOpen.value) return;
  const t = ev.target;
  if (t instanceof Node && !root.contains(t)) {
    closeNavProfileMenu();
  }
}

function onNavProfileKeydown(ev: KeyboardEvent) {
  if (ev.key === "Escape") closeNavProfileMenu();
}

async function signOut() {
  try {
    closeNavProfileMenu();
    await auth.signOut();
    await router.replace({ name: "home" });
  } catch {
    /* handled in UI elsewhere if needed */
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", onNavProfilePointerDownCapture, true);
  document.addEventListener("keydown", onNavProfileKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener(
    "pointerdown",
    onNavProfilePointerDownCapture,
    true,
  );
  document.removeEventListener("keydown", onNavProfileKeydown);
});

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

watch(
  () => route.fullPath,
  () => {
    closeNavProfileMenu();
  },
);
</script>

<template>
  <div
    :class="[
      'flex flex-col bg-white text-zinc-900',
      lockRootShellViewport
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
            v-if="supabaseReady && auth.isSignedIn && !auth.isSuperAdmin"
            to="/dashboard"
            :class="[navPillBase, navPillInactive]"
          >
            Dashboard
          </RouterLink>
          <RouterLink
            v-if="supabaseReady && auth.isSignedIn && auth.isSuperAdmin"
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
            <div
              v-else
              ref="navProfileWrapRef"
              class="relative shrink-0"
            >
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/90 bg-white py-1 pl-1 pr-2 shadow-md shadow-zinc-900/10 transition-all duration-200 hover:border-zinc-300 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-[0.98]"
                aria-label="Account menu"
                :aria-expanded="navProfileOpen"
                aria-haspopup="menu"
                aria-controls="nav-profile-menu"
                @click.stop="toggleNavProfileMenu()"
              >
                <span
                  class="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-[11px] font-bold text-white shadow-inner ring-1 ring-violet-400/40"
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
                <svg
                  class="h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200"
                  :class="navProfileOpen ? 'rotate-180' : ''"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="m19.5 8.25-7.5 7.5-7.5-7.5"
                  />
                </svg>
              </button>
              <div
                v-show="navProfileOpen"
                id="nav-profile-menu"
                role="menu"
                class="absolute right-0 top-[calc(100%+0.5rem)] z-[60] w-[min(23rem,calc(100vw-1.5rem))] max-w-[26rem] overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-2xl shadow-zinc-900/20 ring-1 ring-zinc-950/[0.04]"
              >
                <div
                  class="border-b border-zinc-200/70 bg-gradient-to-br from-zinc-50 via-white to-violet-50/40 px-5 py-4"
                >
                  <p
                    class="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400"
                  >
                    Signed in as
                  </p>
                  <div class="mt-3 flex items-center gap-3">
                    <span
                      class="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white shadow-md shadow-violet-900/25 ring-2 ring-white"
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
                    <div class="min-w-0 flex-1">
                      <p
                        class="truncate text-[15px] font-semibold leading-snug text-zinc-900"
                      >
                        {{ auth.user?.email ?? "Signed in" }}
                      </p>
                      <p class="mt-0.5 text-xs font-medium text-zinc-500">
                        {{
                          auth.isSuperAdmin
                            ? "Platform administrator"
                            : auth.isPlatformStaff
                              ? "Platform staff"
                              : "Seller account"
                        }}
                      </p>
                    </div>
                  </div>
                </div>
                <div class="p-2">
                  <RouterLink
                    role="menuitem"
                    :to="auth.isSuperAdmin ? '/admin' : '/dashboard'"
                    class="flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition-colors hover:bg-zinc-50 active:bg-zinc-100/80"
                    @click="closeNavProfileMenu"
                  >
                    <span
                      class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 ring-1 ring-violet-200/80"
                      aria-hidden="true"
                    >
                      <svg
                        class="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="1.75"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75a2.25 2.25 0 012.25-2.25h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25v-2.25z"
                        />
                      </svg>
                    </span>
                    <span class="min-w-0 flex-1">
                      <span
                        class="block text-sm font-semibold text-zinc-900"
                        >{{
                          auth.isSuperAdmin ? "Platform admin" : "Dashboard"
                        }}</span
                      >
                      <span class="mt-0.5 block text-xs font-medium text-zinc-500">
                        {{
                          auth.isSuperAdmin
                            ? "Network tools & oversight"
                            : "Orders, catalog & storefront"
                        }}
                      </span>
                    </span>
                    <svg
                      class="h-4 w-4 shrink-0 text-zinc-300"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="m8.25 4.5 7.5 7.5-7.5 7.5"
                      />
                    </svg>
                  </RouterLink>
                  <button
                    type="button"
                    role="menuitem"
                    class="mt-0.5 flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition-colors hover:bg-red-50 active:bg-red-100/60"
                    @click="signOut"
                  >
                    <span
                      class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 ring-1 ring-red-200/80"
                      aria-hidden="true"
                    >
                      <svg
                        class="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="1.75"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75"
                        />
                      </svg>
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block text-sm font-semibold text-zinc-800"
                        >Sign out</span
                      >
                      <span class="mt-0.5 block text-xs font-medium text-zinc-500"
                        >End session on this device</span
                      >
                    </span>
                  </button>
                </div>
              </div>
            </div>
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
            v-if="supabaseReady && auth.isSignedIn && !auth.isSuperAdmin"
            to="/dashboard"
            :class="[navMobileBase, navMobileInactive]"
          >
            Dashboard
          </RouterLink>
          <RouterLink
            v-if="supabaseReady && auth.isSignedIn && auth.isSuperAdmin"
            to="/admin"
            :class="[navMobileBase, navMobileInactive, 'text-violet-700']"
          >
            Admin
          </RouterLink>
        </div>
      </div>
    </header>
    <main
      :class="
        route.path.startsWith('/dashboard') || route.path.startsWith('/admin')
          ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent'
          : isStorefrontRoute
            ? 'min-w-0 flex-1 bg-slate-50'
            : 'min-w-0 flex-1 bg-white'
      "
    >
      <RouterView />
    </main>
    <CartDrawer />
    <AppToastStack />
  </div>
</template>
