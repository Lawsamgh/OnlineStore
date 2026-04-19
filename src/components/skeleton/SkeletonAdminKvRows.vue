<script setup lang="ts">
import UiSkeleton from "./UiSkeleton.vue";
import UiSkeletonPanel from "./UiSkeletonPanel.vue";

withDefaults(
  defineProps<{
    rows?: number;
  }>(),
  { rows: 5 },
);
</script>

<template>
  <UiSkeletonPanel label="Loading settings">
    <div
      class="mt-6 space-y-4"
      aria-hidden="true"
    >
      <div
        v-for="i in rows"
        :key="i"
        class="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3"
      >
        <div class="min-w-[140px] flex-1 space-y-2">
          <UiSkeleton
            variant="line"
            width-class="w-16"
            height-class="h-3"
            tone="slate"
            :delay="i % 6"
          />
          <UiSkeleton
            variant="line"
            width-class="w-32"
            height-class="h-4"
            tone="slate"
            :delay="(i + 1) % 6"
          />
        </div>
        <div class="min-w-[200px] flex-[2] space-y-2">
          <UiSkeleton
            variant="line"
            width-class="w-14"
            height-class="h-3"
            tone="slate"
            :delay="(i + 2) % 6"
          />
          <UiSkeleton
            variant="line"
            width-class="w-full"
            height-class="h-9 rounded-md"
            tone="slate"
            :delay="(i + 3) % 6"
          />
        </div>
      </div>
    </div>
  </UiSkeletonPanel>
</template>
