<script setup lang="ts">
import UiSkeleton from "./UiSkeleton.vue";
import UiSkeletonPanel from "./UiSkeletonPanel.vue";
</script>

<template>
  <UiSkeletonPanel label="Checking plan and stores">
    <div class="mt-8 space-y-4">
      <UiSkeleton
        variant="line"
        width-class="w-48"
        height-class="h-5"
        :delay="1"
      />
      <UiSkeleton
        variant="line"
        width-class="w-full"
        :delay="2"
      />
      <UiSkeleton
        variant="line"
        width-class="w-5/6"
        :delay="3"
      />
      <div class="grid gap-3 pt-2 sm:grid-cols-2">
        <UiSkeleton
          v-for="n in 4"
          :key="n"
          variant="rect"
          width-class="w-full"
          height-class="min-h-[4.25rem]"
          :delay="n % 6"
        />
      </div>
    </div>
  </UiSkeletonPanel>
</template>
