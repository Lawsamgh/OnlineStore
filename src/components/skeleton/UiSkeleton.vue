<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    variant?: "line" | "rect" | "circle";
    /** Tailwind width utility, e.g. w-full, w-2/3, w-24 */
    widthClass?: string;
    /** Optional fixed height (Tailwind class), e.g. h-4, h-32 */
    heightClass?: string;
    /** Wave stagger index 1–6 → ui-skel-delay-* */
    delay?: number;
    /** Use slate-tinted gradient (storefront / admin) */
    tone?: "zinc" | "slate";
    /** Merged onto root (e.g. bar chart height %) */
    extraStyle?: Record<string, string | number>;
  }>(),
  {
    variant: "line",
    widthClass: "w-full",
    heightClass: "",
    delay: 0,
    tone: "zinc",
  },
);

const delayClass = computed(() => {
  const d = Math.min(Math.max(props.delay, 0), 6);
  return d > 0 ? (`ui-skel-delay-${d}` as const) : "";
});

const shapeClass = computed(() => {
  if (props.variant === "circle") return "aspect-square rounded-full";
  if (props.variant === "rect") {
    return props.heightClass
      ? "w-full"
      : "rounded-xl min-h-[4.5rem] w-full";
  }
  return props.heightClass ? "rounded-md" : "h-3.5 rounded-md";
});
</script>

<template>
  <div
    :class="[
      props.tone === 'slate' ? 'ui-skel-muted' : 'ui-skel',
      shapeClass,
      widthClass,
      heightClass,
      delayClass,
    ]"
    :style="props.extraStyle"
    aria-hidden="true"
  />
</template>
