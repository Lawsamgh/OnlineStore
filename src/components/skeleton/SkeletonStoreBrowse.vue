<script setup lang="ts">
import UiSkeleton from "./UiSkeleton.vue";
import UiSkeletonPanel from "./UiSkeletonPanel.vue";
</script>

<template>
  <UiSkeletonPanel label="Loading store">
    <div class="mx-auto max-w-5xl px-4 py-8">
      <div class="flex flex-col gap-6 sm:flex-row sm:items-start">
        <UiSkeleton
          variant="rect"
          width-class="h-24 w-24 shrink-0"
          height-class="h-24 rounded-xl"
          tone="slate"
          :delay="1"
        />
        <div class="min-w-0 flex-1 space-y-3">
          <UiSkeleton
            variant="line"
            width-class="max-w-md"
            height-class="h-8"
            tone="slate"
            :delay="2"
          />
          <UiSkeleton
            variant="line"
            width-class="w-full"
            tone="slate"
            :delay="3"
          />
          <UiSkeleton
            variant="line"
            width-class="w-4/5"
            tone="slate"
            :delay="4"
          />
          <div class="flex flex-wrap gap-3 pt-2">
            <UiSkeleton
              variant="line"
              width-class="w-36"
              height-class="h-10 rounded-lg"
              tone="slate"
              :delay="5"
            />
            <UiSkeleton
              variant="line"
              width-class="w-32"
              height-class="h-10 rounded-lg"
              tone="slate"
              :delay="6"
            />
          </div>
        </div>
      </div>

      <div class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="n in 6"
          :key="n"
          class="overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm"
        >
          <UiSkeleton
            variant="rect"
            width-class="w-full"
            height-class="h-36 rounded-lg"
            tone="slate"
            :delay="n % 6"
          />
          <UiSkeleton
            class="mt-3"
            variant="line"
            width-class="w-4/5"
            height-class="h-5"
            tone="slate"
            :delay="(n + 1) % 6"
          />
          <UiSkeleton
            class="mt-2"
            variant="line"
            width-class="w-full"
            tone="slate"
            :delay="(n + 2) % 6"
          />
          <UiSkeleton
            class="mt-3"
            variant="line"
            width-class="w-24"
            height-class="h-8 rounded-lg"
            tone="slate"
            :delay="(n + 3) % 6"
          />
        </div>
      </div>
    </div>
  </UiSkeletonPanel>
</template>
