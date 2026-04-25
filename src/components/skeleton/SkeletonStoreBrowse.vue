<script setup lang="ts">
import UiSkeleton from "./UiSkeleton.vue";
import UiSkeletonPanel from "./UiSkeletonPanel.vue";
</script>

<template>
  <UiSkeletonPanel label="Loading store">
    <!-- Search bar -->
    <div class="px-4 pt-4 pb-2">
      <UiSkeleton
        variant="rect"
        width-class="w-full"
        height-class="h-11 rounded-2xl"
        tone="slate"
        :delay="1"
      />
    </div>

    <!-- Category pills -->
    <div class="flex gap-2 px-4 py-3">
      <UiSkeleton
        v-for="n in 5"
        :key="n"
        variant="rect"
        :width-class="n === 1 ? 'w-14' : n === 2 ? 'w-20' : n === 3 ? 'w-16' : n === 4 ? 'w-24' : 'w-18'"
        height-class="h-7 rounded-full"
        tone="slate"
        :delay="n % 4"
      />
    </div>

    <!-- Section heading -->
    <div class="flex items-center gap-3 px-4 pt-3 pb-2">
      <UiSkeleton
        variant="line"
        width-class="w-24"
        height-class="h-5"
        tone="slate"
        :delay="2"
      />
      <UiSkeleton
        variant="rect"
        width-class="w-7"
        height-class="h-5 rounded-full"
        tone="slate"
        :delay="3"
      />
    </div>

    <!-- Product grid (2-column to mirror mobile layout) -->
    <div class="grid grid-cols-2 gap-3 px-4 pb-10 sm:grid-cols-3 lg:grid-cols-4">
      <div
        v-for="n in 6"
        :key="n"
        class="overflow-hidden rounded-2xl border border-slate-200/80 bg-white"
      >
        <!-- Image placeholder -->
        <UiSkeleton
          variant="rect"
          width-class="w-full"
          height-class="aspect-square h-auto rounded-none"
          tone="slate"
          :delay="n % 4"
        />
        <!-- Body -->
        <div class="flex flex-col gap-2 p-3">
          <UiSkeleton
            variant="line"
            width-class="w-4/5"
            height-class="h-4"
            tone="slate"
            :delay="(n + 1) % 6"
          />
          <UiSkeleton
            variant="line"
            width-class="w-3/5"
            height-class="h-3"
            tone="slate"
            :delay="(n + 2) % 6"
          />
          <div class="mt-1 flex items-center justify-between">
            <UiSkeleton
              variant="line"
              width-class="w-14"
              height-class="h-5"
              tone="slate"
              :delay="(n + 3) % 6"
            />
            <UiSkeleton
              variant="circle"
              width-class="w-8"
              height-class="h-8"
              tone="slate"
              :delay="(n + 4) % 6"
            />
          </div>
        </div>
      </div>
    </div>
  </UiSkeletonPanel>
</template>
