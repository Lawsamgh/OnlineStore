<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import {
  AUTH_SESSION_CONSOLE_ACCESS_PENDING_KEY,
  useAuthStore,
} from "../stores/auth";

onMounted(() => {
  try {
    sessionStorage.setItem(AUTH_SESSION_CONSOLE_ACCESS_PENDING_KEY, "1");
  } catch {
    /* private mode */
  }
});

const auth = useAuthStore();
const router = useRouter();

async function goHome() {
  await router.replace({ name: "home" });
}

async function signOut() {
  try {
    await auth.signOut();
    await router.replace({ name: "login" });
  } catch {
    /* noop */
  }
}
</script>

<template>
  <div
    class="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-gradient-to-br from-zinc-100 via-white to-violet-50/40 px-4 py-10 text-zinc-900 antialiased"
  >
    <div
      class="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(24,24,27,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(24,24,27,0.02)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,black,transparent)]"
      aria-hidden="true"
    />
    <div
      class="relative w-full max-w-md rounded-3xl border border-white/70 bg-white/90 p-8 shadow-[0_24px_80px_-28px_rgba(15,23,42,0.2)] ring-1 ring-zinc-200/60 backdrop-blur-xl sm:p-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby="console-pending-title"
    >
      <p
        class="text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-700/80"
      >
        Platform console
      </p>
      <h1
        id="console-pending-title"
        class="mt-3 text-center text-2xl font-bold tracking-tight text-zinc-900"
      >
        Access not ready yet
      </h1>
      <p class="mt-4 text-center text-sm leading-relaxed text-zinc-600">
        You are signed in, but your account does not have a row in
        <span class="font-semibold text-zinc-800">admin_roles</span> yet. Please
        wait until a super administrator grants you console access. Until then,
        the admin workspace is not available.
      </p>
      <div class="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          class="inline-flex w-full items-center justify-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-zinc-800 sm:w-auto"
          @click="signOut"
        >
          Sign out
        </button>
        <button
          type="button"
          class="inline-flex w-full items-center justify-center rounded-2xl border border-zinc-200/90 bg-white px-5 py-3 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 sm:w-auto"
          @click="goHome"
        >
          Back to home
        </button>
      </div>
    </div>
  </div>
</template>
