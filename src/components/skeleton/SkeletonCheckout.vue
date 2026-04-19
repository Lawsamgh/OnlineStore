<script setup lang="ts">
import UiSkeleton from "./UiSkeleton.vue";
import UiSkeletonPanel from "./UiSkeletonPanel.vue";
</script>

<template>
  <UiSkeletonPanel label="Loading checkout">
    <div class="mt-6 space-y-5">
      <div
        v-for="block in 4"
        :key="block"
        class="space-y-2"
      >
        <UiSkeleton
          variant="line"
          width-class="w-40"
          height-class="h-4"
          tone="slate"
          :delay="block % 6"
        />
        <UiSkeleton
          variant="rect"
          width-class="w-full"
          height-class="min-h-[4.5rem]"
          tone="slate"
          :delay="(block + 1) % 6"
        />
      </div>
      <div class="flex gap-3 pt-2">
        <UiSkeleton
          variant="line"
          width-class="flex-1"
          height-class="h-11 rounded-lg"
          tone="slate"
          :delay="4"
        />
      </div>
    </div>
  </UiSkeletonPanel>
</template>
