<script setup lang="ts">
import UiSkeleton from "./UiSkeleton.vue";
import UiSkeletonPanel from "./UiSkeletonPanel.vue";
</script>

<template>
  <UiSkeletonPanel label="Loading delivery status">
    <div
      class="mt-3 space-y-2"
      aria-hidden="true"
    >
      <UiSkeleton
        variant="line"
        width-class="w-40"
        height-class="h-4"
        tone="slate"
        :delay="1"
      />
      <UiSkeleton
        variant="line"
        width-class="w-3/4"
        tone="slate"
        :delay="2"
      />
      <UiSkeleton
        variant="line"
        width-class="w-1/2"
        height-class="h-3"
        tone="slate"
        :delay="3"
      />
    </div>
  </UiSkeletonPanel>
</template>
