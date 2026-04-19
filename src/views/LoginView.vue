<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import LoginPlexusBackground from "../components/LoginPlexusBackground.vue";
import {
  PRICING_PLANS,
  formatGhsWhole,
  type PricingPlan,
} from "../constants/pricingPlans";
import { isSupabaseConfigured } from "../lib/supabase";
import {
  AUTH_PENDING_SIGNUP_FULL_NAME_KEY,
  AUTH_PENDING_SIGNUP_PLAN_KEY,
  useAuthStore,
} from "../stores/auth";
import { useToastStore } from "../stores/toast";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToastStore();

const mode = ref<"sign-in" | "sign-up">("sign-in");

function syncModeFromRoute() {
  const q = route.query.mode;
  const wantsSignUp =
    q === "sign-up" ||
    q === "signup" ||
    (Array.isArray(q) && (q.includes("sign-up") || q.includes("signup")));
  mode.value = wantsSignUp ? "sign-up" : "sign-in";
}

syncModeFromRoute();
watch(
  () => route.query.mode,
  () => {
    syncModeFromRoute();
  },
);

const fullName = ref("");
const email = ref("");
const password = ref("");
const passwordConfirm = ref("");
const busy = ref(false);

function parsePlanFromQuery(q: unknown): PricingPlan["id"] | null {
  const raw = typeof q === "string" ? q : Array.isArray(q) ? q[0] : null;
  if (!raw || typeof raw !== "string") return null;
  return PRICING_PLANS.some((p) => p.id === raw)
    ? (raw as PricingPlan["id"])
    : null;
}

const selectedPlanId = ref<PricingPlan["id"]>("free");

function syncSelectedPlanFromRoute() {
  const fromUrl = parsePlanFromQuery(route.query.plan);
  selectedPlanId.value = fromUrl ?? "free";
}

function oauthErrorFromQuery(): string | null {
  const raw = route.query.error_description ?? route.query.error;
  if (Array.isArray(raw)) return typeof raw[0] === "string" ? raw[0] : null;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

onMounted(() => {
  syncSelectedPlanFromRoute();
  const oauthErr = oauthErrorFromQuery();
  if (oauthErr) {
    toast.error(oauthErr);
    const q = { ...route.query };
    delete q.error;
    delete q.error_description;
    delete q.error_code;
    void router.replace({ name: "login", query: q });
  }
});

/** OAuth (and “open /login while already signed in”) → leave login using same rules as email sign-in. */
watch(
  () => [auth.isSignedIn, route.name] as const,
  async ([signedIn, name]) => {
    if (!signedIn || name !== "login" || busy.value) return;
    const dest = await resolvePostLoginDestination();
    await router.replace(dest);
  },
  { immediate: true },
);

watch(
  () => route.query.plan,
  () => {
    syncSelectedPlanFromRoute();
  },
);

watch(mode, (m) => {
  if (m === "sign-up") syncSelectedPlanFromRoute();
});

const selectedPlan = computed(
  () => PRICING_PLANS.find((p) => p.id === selectedPlanId.value)!,
);

function selectSignupPlan(id: PricingPlan["id"]) {
  selectedPlanId.value = id;
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(route.query)) {
    if (k === "plan") continue;
    if (typeof v === "string" && v !== "") q[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string" && v[0] !== "")
      q[k] = v[0];
  }
  q.plan = id;
  if (mode.value === "sign-up") q.mode = "sign-up";
  void router.replace({ name: "login", query: q });
}

function blockPasswordPasteIfSignUp(e: ClipboardEvent) {
  if (mode.value === "sign-up") e.preventDefault();
}

function replaceQueryMode(next: "sign-in" | "sign-up") {
  fullName.value = "";
  passwordConfirm.value = "";
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(route.query)) {
    if (k === "mode") continue;
    if (typeof v === "string" && v !== "") q[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string" && v[0] !== "")
      q[k] = v[0];
  }
  if (next === "sign-up") q.mode = "sign-up";
  else delete q.plan;
  void router.replace({ name: "login", query: q });
}

function toggleAuthMode() {
  replaceQueryMode(mode.value === "sign-in" ? "sign-up" : "sign-in");
}

/** After email or OAuth sign-in: respect `redirect`, else super admin → platform overview. */
async function resolvePostLoginDestination(): Promise<RouteLocationRaw | string> {
  await auth.refreshSuperAdminRole();
  const r = route.query.redirect;
  if (typeof r === "string" && r.startsWith("/") && !r.startsWith("//")) {
    return r;
  }
  if (auth.isSuperAdmin) {
    return { name: "admin" as const };
  }
  return { name: "dashboard" as const };
}

async function submit() {
  if (!isSupabaseConfigured()) {
    toast.error("Add Supabase keys to .env first.");
    return;
  }
  if (mode.value === "sign-up" && password.value !== passwordConfirm.value) {
    toast.error("Passwords do not match.");
    return;
  }
  if (mode.value === "sign-up" && fullName.value.trim().length < 2) {
    toast.error("Please enter your full name (at least 2 characters).");
    return;
  }
  busy.value = true;
  try {
    if (mode.value === "sign-in") {
      await auth.signInWithEmail(email.value.trim(), password.value);
      toast.success("Signed in successfully.");
    } else {
      await auth.signUpWithEmail(
        email.value.trim(),
        password.value,
        selectedPlanId.value,
        fullName.value.trim(),
      );
      toast.success(
        "Check your email to confirm the account if your project requires it.",
      );
    }
    if (mode.value === "sign-in") {
      await router.replace(await resolvePostLoginDestination());
    }
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : "Something went wrong");
  } finally {
    busy.value = false;
  }
}

async function google() {
  if (!isSupabaseConfigured()) {
    toast.error("Add Supabase keys to .env first.");
    return;
  }
  busy.value = true;
  try {
    if (mode.value === "sign-up") {
      sessionStorage.setItem(
        AUTH_PENDING_SIGNUP_PLAN_KEY,
        selectedPlanId.value,
      );
      const fn = fullName.value.trim();
      if (fn.length >= 2) {
        sessionStorage.setItem(AUTH_PENDING_SIGNUP_FULL_NAME_KEY, fn);
      } else {
        sessionStorage.removeItem(AUTH_PENDING_SIGNUP_FULL_NAME_KEY);
      }
    }
    await auth.signInWithGoogle();
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : "Something went wrong");
  } finally {
    busy.value = false;
  }
}

const segmentBase =
  "flex-1 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200";
const segmentActive =
  "bg-zinc-900 text-white shadow-md shadow-zinc-900/20 ring-1 ring-zinc-800/40";
const segmentInactive = "text-zinc-600 hover:bg-white/80 hover:text-zinc-900";
</script>

<template>
  <div
    class="relative min-h-svh overflow-hidden bg-gradient-to-br from-zinc-100 via-white to-emerald-50/35 antialiased"
  >
    <div
      class="pointer-events-none absolute -right-32 top-0 h-96 w-96 rounded-full bg-lime-300/25 blur-3xl"
      aria-hidden="true"
    />
    <div
      class="pointer-events-none absolute -left-24 bottom-0 h-80 w-80 rounded-full bg-emerald-200/30 blur-3xl"
      aria-hidden="true"
    />
    <LoginPlexusBackground />
    <div
      class="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(24,24,27,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(24,24,27,0.02)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
      aria-hidden="true"
    />

    <div
      class="relative flex min-h-svh flex-col px-4 py-6 sm:px-6 sm:py-10 lg:px-8"
    >
      <main
        class="flex flex-1 flex-col items-center justify-center pb-10 pt-6 sm:pb-16 sm:pt-10"
      >
        <div
          class="w-full max-w-lg rounded-3xl border border-white/60 bg-white/75 p-8 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.18)] ring-1 ring-zinc-200/60 backdrop-blur-xl sm:max-w-xl sm:p-10 md:p-11"
        >
          <div
            class="flex rounded-full bg-zinc-100/90 p-1 ring-1 ring-zinc-200/80"
            role="tablist"
            aria-label="Account mode"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="mode === 'sign-in'"
              :class="[
                segmentBase,
                mode === 'sign-in' ? segmentActive : segmentInactive,
              ]"
              @click="replaceQueryMode('sign-in')"
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="mode === 'sign-up'"
              :class="[
                segmentBase,
                mode === 'sign-up' ? segmentActive : segmentInactive,
              ]"
              @click="replaceQueryMode('sign-up')"
            >
              Create account
            </button>
          </div>

          <div class="mt-8">
            <h1
              class="text-balance text-2xl font-semibold tracking-tight text-zinc-950 sm:text-[1.65rem]"
            >
              {{
                mode === "sign-in"
                  ? "Welcome back"
                  : "Create your seller account"
              }}
            </h1>
            <p class="mt-2 text-pretty text-sm leading-relaxed text-zinc-600">
              {{
                mode === "sign-in"
                  ? "Sign in with email or Google. Your account is protected with industry-standard security."
                  : "Start in minutes. If we need to verify your email, we will send you a short confirmation link."
              }}
            </p>
          </div>

          <div v-if="mode === 'sign-up'" class="mt-6">
            <fieldset>
              <legend
                class="text-xs font-semibold uppercase tracking-wider text-zinc-500"
              >
                Starting plan
              </legend>
              <p
                class="mt-1.5 text-pretty text-xs leading-relaxed text-zinc-500"
              >
                Choose where you want to begin. Paid tiers are selected here
                first; you complete payment from your dashboard when you are
                ready.
              </p>
              <div
                class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
                role="radiogroup"
                aria-label="Subscription plan"
              >
                <button
                  v-for="plan in PRICING_PLANS"
                  :key="plan.id"
                  type="button"
                  role="radio"
                  :aria-checked="selectedPlanId === plan.id"
                  class="rounded-2xl border px-3 py-3 text-left text-sm transition-all outline-none focus-visible:ring-4 focus-visible:ring-zinc-900/15"
                  :class="
                    selectedPlanId === plan.id
                      ? 'border-lime-400/90 bg-lime-50/90 ring-2 ring-lime-400/50'
                      : 'border-zinc-200/90 bg-white/80 hover:border-zinc-300'
                  "
                  @click="selectSignupPlan(plan.id)"
                >
                  <span class="font-semibold text-zinc-900">{{
                    plan.name
                  }}</span>
                  <span class="mt-0.5 block text-xs text-zinc-600">
                    <template v-if="plan.monthlyGhs === 0"
                      >Free — no card</template
                    >
                    <template v-else
                      >{{ formatGhsWhole(plan.monthlyGhs) }} / month</template
                    >
                  </span>
                </button>
              </div>
            </fieldset>
            <p class="mt-3 text-pretty text-xs leading-relaxed text-zinc-500">
              <span class="font-medium text-zinc-700">{{
                selectedPlan.name
              }}</span>
              <span v-if="selectedPlan.monthlyGhs === 0" class="text-zinc-600">
                — use the free limits right after sign-up; upgrade anytime from
                your dashboard.
              </span>
              <span v-else class="text-zinc-600">
                — after sign-up, continue from your dashboard to activate this
                tier when you pay.
              </span>
            </p>
          </div>

          <div
            v-if="!isSupabaseConfigured()"
            class="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          >
            Add
            <code
              class="rounded bg-amber-100/80 px-1.5 py-0.5 font-mono text-xs"
              >VITE_SUPABASE_URL</code
            >
            and
            <code
              class="rounded bg-amber-100/80 px-1.5 py-0.5 font-mono text-xs"
              >VITE_SUPABASE_ANON_KEY</code
            >
            to <code class="font-mono text-xs">.env</code> to enable auth.
          </div>

          <button
            type="button"
            :disabled="busy"
            class="mt-8 flex w-full items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 text-sm font-semibold text-zinc-800 shadow-sm transition-all hover:border-zinc-300 hover:bg-zinc-50 hover:shadow-md disabled:pointer-events-none disabled:opacity-50 active:scale-[0.99]"
            @click="google"
          >
            <svg
              class="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </button>

          <div class="relative my-8">
            <div class="absolute inset-0 flex items-center" aria-hidden="true">
              <div class="w-full border-t border-zinc-200" />
            </div>
            <div class="relative flex justify-center">
              <span
                class="bg-white/90 px-3 text-xs font-medium uppercase tracking-wider text-zinc-400"
                >Or email</span
              >
            </div>
          </div>

          <form class="space-y-5" @submit.prevent="submit">
            <div v-if="mode === 'sign-up'">
              <label
                class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-500"
                for="full-name"
                >Full name</label
              >
              <input
                id="full-name"
                v-model="fullName"
                type="text"
                autocomplete="name"
                required
                minlength="2"
                maxlength="120"
                class="w-full rounded-2xl border border-zinc-200 bg-white/90 px-4 py-3.5 text-sm text-zinc-900 shadow-inner shadow-zinc-900/5 outline-none ring-zinc-900/0 transition-[border-color,box-shadow,ring] placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-900/10"
                placeholder="e.g. Yaw Oppong"
              />
            </div>
            <div>
              <label
                class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-500"
                for="email"
                >Email</label
              >
              <input
                id="email"
                v-model="email"
                type="email"
                autocomplete="email"
                required
                class="w-full rounded-2xl border border-zinc-200 bg-white/90 px-4 py-3.5 text-sm text-zinc-900 shadow-inner shadow-zinc-900/5 outline-none ring-zinc-900/0 transition-[border-color,box-shadow,ring] placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-900/10"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label
                class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-500"
                for="password"
                >Password</label
              >
              <input
                id="password"
                v-model="password"
                type="password"
                :autocomplete="
                  mode === 'sign-in' ? 'current-password' : 'new-password'
                "
                required
                minlength="6"
                class="w-full rounded-2xl border border-zinc-200 bg-white/90 px-4 py-3.5 text-sm text-zinc-900 shadow-inner shadow-zinc-900/5 outline-none transition-[border-color,box-shadow,ring] placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-900/10"
                placeholder="At least 6 characters"
                @paste="blockPasswordPasteIfSignUp"
              />
            </div>
            <div v-if="mode === 'sign-up'">
              <label
                class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-500"
                for="password-confirm"
                >Confirm password</label
              >
              <input
                id="password-confirm"
                v-model="passwordConfirm"
                type="password"
                autocomplete="new-password"
                required
                minlength="6"
                class="w-full rounded-2xl border border-zinc-200 bg-white/90 px-4 py-3.5 text-sm text-zinc-900 shadow-inner shadow-zinc-900/5 outline-none transition-[border-color,box-shadow,ring] placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-900/10"
                placeholder="Re-enter your password"
                @paste="blockPasswordPasteIfSignUp"
              />
            </div>

            <button
              type="submit"
              :disabled="busy"
              class="w-full rounded-full bg-zinc-900 py-3.5 text-sm font-semibold text-white shadow-lg shadow-zinc-900/25 transition-all hover:bg-zinc-800 hover:shadow-xl disabled:pointer-events-none disabled:opacity-50 active:scale-[0.99]"
            >
              {{ mode === "sign-in" ? "Sign in" : "Create account" }}
            </button>
          </form>

          <p class="mt-8 text-center text-sm text-zinc-600">
            <button
              type="button"
              class="font-semibold text-emerald-700 underline-offset-4 transition-colors hover:text-emerald-800 hover:underline"
              @click="toggleAuthMode"
            >
              {{
                mode === "sign-in"
                  ? "Need an account? Sign up"
                  : "Already have an account? Sign in"
              }}
            </button>
          </p>
        </div>
      </main>
    </div>
  </div>
</template>
