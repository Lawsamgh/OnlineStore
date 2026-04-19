<script setup lang="ts">
import { Transition, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useUiStore } from "../../stores/ui";
import CreateStorePanel from "./CreateStorePanel.vue";

const ui = useUiStore();
const panelRef = ref<{ loadGate?: () => void } | null>(null);

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && ui.createStoreModalOpen) {
    e.preventDefault();
    ui.closeCreateStoreModal();
  }
}

watch(
  () => ui.createStoreModalOpen,
  async (open) => {
    document.body.style.overflow = open ? "hidden" : "";
    if (open) {
      await nextTick();
      panelRef.value?.loadGate?.();
    }
  },
);

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  document.body.style.overflow = "";
});
</script>

<template>
  <Teleport to="body">
    <Transition name="cstore">
      <div
        v-if="ui.createStoreModalOpen"
        class="cstore-root fixed inset-0 z-[280] flex items-end justify-center p-0 sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-store-modal-title"
      >
      <div
        class="absolute inset-0 bg-zinc-900/45 backdrop-blur-[2px]"
        aria-hidden="true"
      ></div>

      <div
        class="cstore-dialog relative z-10 flex min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-t-[1.75rem] border border-white/70 bg-[#f4f5f9] shadow-[0_-24px_80px_-20px_rgba(15,23,42,0.35)] max-h-[min(92svh,72rem)] sm:max-h-[min(88svh,72rem)] sm:rounded-3xl sm:shadow-[0_32px_80px_-24px_rgba(15,23,42,0.35)]"
      >
        <div
          class="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200/60 bg-white/90 px-4 py-3 backdrop-blur-sm sm:rounded-t-3xl sm:px-5"
        >
          <p
            id="create-store-modal-title"
            class="text-sm font-semibold text-zinc-900"
          >
            New storefront
          </p>
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200/80 bg-white text-lg leading-none text-zinc-500 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-800"
            aria-label="Close"
            @click="ui.closeCreateStoreModal()"
          >
            ×
          </button>
        </div>

        <div
          class="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4 sm:p-5"
        >
          <CreateStorePanel ref="panelRef" heading-level="h2" />
        </div>
      </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cstore-enter-active,
.cstore-leave-active {
  transition: opacity 0.32s ease;
}

.cstore-enter-from,
.cstore-leave-to {
  opacity: 0;
}

.cstore-enter-active .cstore-dialog,
.cstore-leave-active .cstore-dialog {
  transition:
    transform 0.45s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.38s ease;
}

.cstore-enter-from .cstore-dialog {
  opacity: 0;
  transform: translate3d(0, 1.25rem, 0) scale(0.98);
}

.cstore-leave-to .cstore-dialog {
  opacity: 0;
  transform: translate3d(0, 0.75rem, 0) scale(0.99);
}

@media (prefers-reduced-motion: reduce) {
  .cstore-enter-active,
  .cstore-leave-active,
  .cstore-enter-active .cstore-dialog,
  .cstore-leave-active .cstore-dialog {
    transition-duration: 0.01ms !important;
  }

  .cstore-enter-from .cstore-dialog,
  .cstore-leave-to .cstore-dialog {
    transform: none;
  }
}
</style>
