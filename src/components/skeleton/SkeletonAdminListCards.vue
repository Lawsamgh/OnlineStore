<script setup lang="ts">
import UiSkeleton from "./UiSkeleton.vue";
import UiSkeletonPanel from "./UiSkeletonPanel.vue";

withDefaults(
  defineProps<{
    rows?: number;
    label?: string;
  }>(),
  { rows: 4, label: "Loading list" },
);
</script>

<template>
  <UiSkeletonPanel :label="label">
    <ul
      class="mt-6 space-y-4"
      aria-hidden="true"
    >
      <li
        v-for="i in rows"
        :key="i"
        class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1 space-y-2">
            <UiSkeleton
              variant="line"
              width-class="max-w-sm"
              height-class="h-5"
              tone="slate"
              :delay="i % 6"
            />
            <UiSkeleton
              variant="line"
              width-class="w-48"
              height-class="h-3"
              tone="slate"
              :delay="(i + 1) % 6"
            />
            <UiSkeleton
              variant="line"
              width-class="w-full"
              tone="slate"
              :delay="(i + 2) % 6"
            />
            <UiSkeleton
              variant="line"
              width-class="w-5/6"
              tone="slate"
              :delay="(i + 3) % 6"
            />
          </div>
          <UiSkeleton
            variant="line"
            width-class="w-20"
            height-class="h-8 shrink-0 rounded-md"
            tone="slate"
            :delay="(i + 4) % 6"
          />
        </div>
      </li>
    </ul>
  </UiSkeletonPanel>
</template>
