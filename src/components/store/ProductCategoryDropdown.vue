<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  useId,
  watch,
} from "vue";

/** Above dashboard modals (e.g. add-product `z-[260]`, overlays `z-[275]`). */
const MENU_Z = "320";

const props = withDefaults(
  defineProps<{
    categoryId: string | null;
    categories: { id: string; name: string }[];
    pending?: boolean;
    /** Trigger + menu typography */
    size?: "sm" | "md";
    /** Optional id of a visible label element (e.g. modal field label). */
    labelledBy?: string | null;
  }>(),
  { pending: false, size: "sm", labelledBy: null },
);

const emit = defineEmits<{ pick: [value: string | null] }>();

const listboxId = useId();
const open = ref(false);
const triggerRef = ref<HTMLButtonElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);

const displayLabel = computed(() => {
  if (!props.categoryId) return "No category";
  const c = props.categories.find((x) => x.id === props.categoryId);
  return c?.name?.trim() || "No category";
});

const panelStyle = ref<Record<string, string>>({});

function close() {
  open.value = false;
}

function measure() {
  const el = triggerRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const spaceBelow = window.innerHeight - r.bottom - 12;
  const spaceAbove = r.top - 12;
  const wantUp = spaceBelow < 140 && spaceAbove > spaceBelow;
  const maxH = Math.max(
    120,
    Math.min(288, wantUp ? spaceAbove - 8 : spaceBelow - 8),
  );
  const left = Math.min(
    Math.max(8, r.left),
    Math.max(8, window.innerWidth - r.width - 8),
  );
  if (wantUp) {
    panelStyle.value = {
      position: "fixed",
      left: `${left}px`,
      width: `${r.width}px`,
      bottom: `${window.innerHeight - r.top + 6}px`,
      maxHeight: `${maxH}px`,
      zIndex: MENU_Z,
    };
  } else {
    panelStyle.value = {
      position: "fixed",
      top: `${r.bottom + 6}px`,
      left: `${left}px`,
      width: `${r.width}px`,
      maxHeight: `${maxH}px`,
      zIndex: MENU_Z,
    };
  }
}

function onDocPointerDown(ev: PointerEvent) {
  if (!open.value) return;
  const t = ev.target as Node;
  if (triggerRef.value?.contains(t) || menuRef.value?.contains(t)) return;
  close();
}

function onKeydown(ev: KeyboardEvent) {
  if (ev.key === "Escape") close();
}

function toggle() {
  if (props.pending) return;
  open.value = !open.value;
  if (open.value) void nextTick(() => measure());
}

function pick(v: string | null) {
  emit("pick", v);
  close();
}

watch(open, (is) => {
  if (is) {
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onKeydown, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    void nextTick(() => measure());
  } else {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onKeydown, true);
    window.removeEventListener("resize", close);
    window.removeEventListener("scroll", close, true);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onKeydown, true);
  window.removeEventListener("resize", close);
  window.removeEventListener("scroll", close, true);
});

const triggerClass = computed(() =>
  [
    "flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-zinc-200/90 bg-white text-left font-semibold text-zinc-900 shadow-sm outline-none transition hover:border-zinc-300 hover:bg-zinc-50/80 focus-visible:border-teal-400 focus-visible:ring-2 focus-visible:ring-teal-500/20 disabled:cursor-wait disabled:opacity-60",
    props.size === "md" ? "py-2.5 pl-3 pr-2.5 text-sm" : "py-2 pl-2.5 pr-2 text-xs",
  ].join(" "),
);
</script>

<template>
  <div class="min-w-0">
    <button
      ref="triggerRef"
      type="button"
      role="combobox"
      :class="triggerClass"
      :aria-expanded="open"
      :aria-controls="listboxId"
      :aria-labelledby="labelledBy ?? undefined"
      :disabled="pending"
      @click="toggle"
    >
      <span class="min-w-0 flex-1 truncate">{{ displayLabel }}</span>
      <span
        v-if="pending"
        class="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-200 border-t-teal-600"
        aria-hidden="true"
      />
      <svg
        v-else
        class="h-4 w-4 shrink-0 text-zinc-400 transition duration-200"
        :class="open ? 'rotate-180' : ''"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fill-rule="evenodd"
          d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
          clip-rule="evenodd"
        />
      </svg>
    </button>

    <Teleport to="body">
      <div
        v-show="open"
        :id="listboxId"
        ref="menuRef"
        role="listbox"
        class="flex flex-col overflow-hidden rounded-xl border border-zinc-200/90 bg-white py-1 shadow-xl shadow-zinc-900/15 ring-1 ring-black/[0.04]"
        :style="panelStyle"
      >
        <div
          class="min-h-0 flex-1 overflow-y-auto overscroll-y-contain py-0.5"
        >
          <button
            type="button"
            role="option"
            :aria-selected="!categoryId"
            class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-800 transition hover:bg-teal-50/90"
            @click="pick(null)"
          >
            <span class="min-w-0 flex-1 font-medium">No category</span>
            <svg
              v-if="!categoryId"
              class="h-4 w-4 shrink-0 text-teal-600"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
          <button
            v-for="c in categories"
            :key="c.id"
            type="button"
            role="option"
            :aria-selected="categoryId === c.id"
            class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-800 transition hover:bg-teal-50/90"
            @click="pick(c.id)"
          >
            <span class="min-w-0 flex-1 truncate font-medium">{{ c.name }}</span>
            <svg
              v-if="categoryId === c.id"
              class="h-4 w-4 shrink-0 text-teal-600"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
          <p
            v-if="!categories.length"
            class="px-3 py-4 text-center text-xs leading-relaxed text-zinc-500"
          >
            No labels yet — add categories in the panel beside this list.
          </p>
        </div>
      </div>
    </Teleport>
  </div>
</template>
