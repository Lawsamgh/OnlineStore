<script setup lang="ts">
import UiSkeleton from "./UiSkeleton.vue";
import UiSkeletonPanel from "./UiSkeletonPanel.vue";
</script>

<template>
  <UiSkeletonPanel label="Loading platform stats">
    <div
      class="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(16.5rem,26%)] lg:items-start lg:gap-8 xl:gap-10"
      aria-hidden="true"
    >
      <ul
        class="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4"
      >
        <li
          v-for="i in 4"
          :key="i"
          class="flex min-h-[18.5rem] flex-col rounded-[1.75rem] border border-zinc-200/80 bg-white/70 p-6 pb-8 shadow-sm sm:min-h-[20.5rem] sm:rounded-3xl sm:p-7 sm:pb-9 lg:min-h-[22rem]"
        >
          <UiSkeleton
            variant="line"
            width-class="w-24"
            height-class="h-3"
            tone="slate"
            :delay="i % 6"
          />
          <div class="mt-3 flex items-end justify-between gap-3 sm:mt-4">
            <UiSkeleton
              variant="line"
              class="min-w-0 flex-1"
              width-class="w-2/3"
              height-class="h-12 sm:h-14 lg:h-16"
              tone="slate"
              :delay="(i + 1) % 6"
            />
            <div
              class="h-16 w-16 shrink-0 overflow-hidden rounded-2xl ring-1 ring-zinc-200/70 sm:h-[4.5rem] sm:w-[4.5rem] sm:rounded-[1.35rem] lg:h-20 lg:w-20"
            >
              <UiSkeleton
                variant="rect"
                width-class="w-full"
                height-class="h-full min-h-[4rem]"
                tone="slate"
                :delay="(i + 2) % 6"
              />
            </div>
          </div>
          <UiSkeleton
            class="mt-3 rounded-full"
            variant="line"
            width-class="w-28"
            height-class="h-6"
            tone="slate"
            :delay="(i + 2) % 6"
          />
          <UiSkeleton
            class="mt-2"
            variant="line"
            width-class="w-40"
            height-class="h-3"
            tone="slate"
            :delay="(i + 3) % 6"
          />
          <div class="mt-auto space-y-2 pt-6 sm:pt-7">
            <UiSkeleton
              variant="line"
              width-class="w-32"
              height-class="h-2.5"
              tone="slate"
              :delay="(i + 4) % 6"
            />
            <div
              class="h-3 w-full overflow-hidden rounded-full bg-zinc-200/80 ring-1 ring-zinc-300/40"
            >
              <UiSkeleton
                variant="rect"
                width-class="w-3/5"
                height-class="h-full min-h-[0.75rem]"
                tone="slate"
                :delay="(i + 5) % 6"
              />
            </div>
            <UiSkeleton
              variant="line"
              width-class="w-full"
              height-class="h-2.5"
              tone="slate"
              :delay="(i + 1) % 6"
            />
          </div>
        </li>
      </ul>

      <aside
        class="flex min-h-[16.25rem] flex-col gap-5 rounded-[1.75rem] border border-zinc-200/80 bg-white/60 p-6 shadow-sm sm:rounded-3xl"
      >
        <div>
          <UiSkeleton
            variant="line"
            width-class="w-16"
            height-class="h-3"
            tone="slate"
            :delay="1"
          />
          <UiSkeleton
            class="mt-3"
            variant="line"
            width-class="w-40"
            height-class="h-5"
            tone="slate"
            :delay="2"
          />
          <UiSkeleton
            class="mt-2"
            variant="line"
            width-class="w-full"
            height-class="h-3"
            tone="slate"
            :delay="3"
          />
          <UiSkeleton
            class="mt-1"
            variant="line"
            width-class="w-4/5"
            height-class="h-3"
            tone="slate"
            :delay="4"
          />
        </div>
        <div class="flex flex-col gap-2">
          <UiSkeleton
            v-for="k in 3"
            :key="k"
            variant="rect"
            width-class="w-full"
            height-class="h-[4.25rem] rounded-2xl"
            tone="slate"
            :delay="(k + 2) % 6"
          />
        </div>
      </aside>
    </div>
  </UiSkeletonPanel>
</template>
