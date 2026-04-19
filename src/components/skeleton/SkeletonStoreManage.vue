<script setup lang="ts">
import UiSkeleton from "./UiSkeleton.vue";
import UiSkeletonPanel from "./UiSkeletonPanel.vue";
</script>

<template>
  <UiSkeletonPanel label="Loading store workspace">
    <div class="space-y-6">
      <header
        class="rounded-3xl border border-white/60 bg-white/70 p-6 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.12)] backdrop-blur-xl sm:p-8"
      >
        <div
          class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
        >
          <div class="min-w-0 flex-1 space-y-3">
            <UiSkeleton
              variant="line"
              width-class="max-w-xs"
              height-class="h-9"
              :delay="1"
            />
            <UiSkeleton
              variant="line"
              width-class="w-56"
              height-class="h-4"
              :delay="2"
            />
          </div>
          <UiSkeleton
            variant="line"
            width-class="w-56"
            height-class="h-11 rounded-full"
            :delay="3"
          />
        </div>
        <div class="mt-6 flex gap-2 border-b border-zinc-200/60 pb-3">
          <UiSkeleton
            v-for="t in 3"
            :key="t"
            variant="line"
            width-class="w-28"
            height-class="h-9 rounded-lg"
            :delay="t % 6"
          />
        </div>
      </header>

      <div
        class="rounded-3xl border border-zinc-200/50 bg-white/80 p-5 shadow-sm sm:p-6"
      >
        <div class="flex flex-wrap items-end justify-between gap-3">
          <UiSkeleton
            variant="line"
            width-class="w-48"
            height-class="h-6"
            :delay="1"
          />
          <UiSkeleton
            variant="line"
            width-class="w-32"
            height-class="h-9 rounded-lg"
            :delay="2"
          />
        </div>
        <div class="mt-6 grid gap-4 lg:grid-cols-2">
          <div class="space-y-3 rounded-2xl border border-zinc-100 bg-zinc-50/50 p-4">
            <UiSkeleton
              v-for="f in 5"
              :key="f"
              variant="line"
              width-class="w-full"
              height-class="h-10 rounded-xl"
              :delay="f % 6"
            />
          </div>
          <div class="space-y-3">
            <div
              v-for="r in 4"
              :key="r"
              class="flex gap-3 rounded-2xl border border-zinc-100 bg-white p-3"
            >
              <UiSkeleton
                variant="rect"
                width-class="w-16 shrink-0"
                height-class="h-16 rounded-lg"
                :delay="r % 6"
              />
              <div class="min-w-0 flex-1 space-y-2">
                <UiSkeleton
                  variant="line"
                  width-class="w-3/4"
                  height-class="h-4"
                  :delay="(r + 1) % 6"
                />
                <UiSkeleton
                  variant="line"
                  width-class="w-20"
                  height-class="h-5"
                  :delay="(r + 2) % 6"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </UiSkeletonPanel>
</template>
