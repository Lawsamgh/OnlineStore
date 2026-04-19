<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Screen-reader status */
    label?: string;
  }>(),
  { label: "Loading" },
);
</script>

<template>
  <div
    class="contents"
    role="status"
    aria-busy="true"
    aria-live="polite"
  >
    <span class="sr-only">{{ label }}</span>
    <slot />
  </div>
</template>
