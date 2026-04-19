<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useToastStore } from "../stores/toast";

const toast = useToastStore();
const { items } = storeToRefs(toast);

function styles(t: (typeof items.value)[0]["type"]) {
  if (t === "success")
    return "border-emerald-200/90 bg-emerald-50/95 text-emerald-950 ring-emerald-300/40";
  if (t === "info")
    return "border-amber-200/90 bg-amber-50/95 text-amber-950 ring-amber-300/35";
  return "border-red-200/90 bg-red-50/95 text-red-950 ring-red-300/40";
}
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-x-0 top-0 z-[200] flex flex-col items-end gap-2 p-4 sm:p-5"
      aria-live="polite"
    >
      <TransitionGroup name="toast">
        <div
          v-for="t in items"
          :key="t.id"
          class="pointer-events-auto w-full max-w-sm rounded-2xl border px-4 py-3 text-sm font-medium shadow-lg shadow-zinc-900/10 ring-1 backdrop-blur-sm sm:max-w-md"
          :class="styles(t.type)"
          role="status"
        >
          <div class="flex items-start gap-3">
            <span class="mt-0.5 shrink-0 text-base leading-none" aria-hidden="true">
              {{ t.type === "success" ? "✓" : "!" }}
            </span>
            <p class="min-w-0 flex-1 leading-relaxed">{{ t.message }}</p>
            <button
              type="button"
              class="shrink-0 rounded-lg px-1.5 py-0.5 text-xs font-semibold opacity-70 transition hover:opacity-100"
              aria-label="Dismiss notification"
              @click="toast.dismiss(t.id)"
            >
              ×
            </button>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-0.5rem);
}
.toast-move {
  transition: transform 0.2s ease;
}
</style>
