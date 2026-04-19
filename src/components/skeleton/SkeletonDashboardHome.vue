<script setup lang="ts">
import UiSkeleton from "./UiSkeleton.vue";
import UiSkeletonPanel from "./UiSkeletonPanel.vue";
</script>

<template>
  <UiSkeletonPanel label="Loading your dashboard">
    <!-- Main column -->
    <div class="min-w-0 space-y-8">
      <div class="grid gap-4 sm:grid-cols-3 sm:gap-5">
        <div
          v-for="card in 3"
          :key="card"
          class="flex min-h-[18.5rem] flex-col rounded-[1.75rem] border border-zinc-200/60 bg-zinc-50/80 p-6 pb-8 sm:min-h-[20.5rem] sm:rounded-3xl sm:p-7 sm:pb-9 lg:min-h-[22rem]"
        >
          <UiSkeleton
            variant="line"
            width-class="w-24"
            :delay="card"
          />
          <UiSkeleton
            class="mt-4"
            variant="line"
            width-class="w-20"
            height-class="h-10"
            :delay="card + 1"
          />
          <UiSkeleton
            class="mt-4"
            variant="line"
            width-class="w-32"
            height-class="h-6 rounded-full"
            :delay="card + 2"
          />
          <UiSkeleton
            class="mt-3"
            variant="line"
            width-class="w-40"
            :delay="card + 3"
          />
          <div class="mt-auto flex h-28 items-end gap-1.5 pt-6 sm:h-32 sm:gap-2 sm:pt-7 lg:h-36">
            <UiSkeleton
              v-for="(pct, b) in [38, 62, 44, 78, 52, 68, 48]"
              :key="b"
              variant="rect"
              width-class="flex-1"
              height-class="rounded-t-xl self-end"
              :extra-style="{ height: `${pct}%` }"
              :delay="(card + b) % 6"
            />
          </div>
        </div>
      </div>

      <div
        class="overflow-hidden rounded-[1.75rem] border border-zinc-200/60 bg-white shadow-[0_28px_70px_-40px_rgba(15,23,42,0.12)]"
      >
        <div
          class="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 sm:px-6"
        >
          <UiSkeleton
            variant="line"
            width-class="w-40"
            height-class="h-6"
            :delay="1"
          />
          <UiSkeleton
            variant="circle"
            width-class="w-10"
            height-class="h-10"
            :delay="2"
          />
        </div>
        <div class="px-5 py-4 sm:px-6">
          <div class="flex gap-4 border-b border-zinc-100 pb-3">
            <UiSkeleton
              v-for="h in 4"
              :key="h"
              variant="line"
              width-class="flex-1"
              height-class="h-3"
              :delay="h"
            />
          </div>
          <div
            v-for="row in 5"
            :key="row"
            class="flex items-center gap-4 border-b border-zinc-50 py-4 last:border-0"
          >
            <UiSkeleton
              variant="line"
              width-class="min-w-0 flex-[1.2]"
              height-class="h-4"
              :delay="row % 6"
            />
            <UiSkeleton
              variant="line"
              width-class="hidden w-28 sm:block"
              height-class="h-4"
              :delay="(row + 1) % 6"
            />
            <UiSkeleton
              variant="line"
              width-class="w-20"
              height-class="h-8 rounded-lg"
              :delay="(row + 2) % 6"
            />
            <div class="ml-auto flex gap-2">
              <UiSkeleton
                variant="line"
                width-class="w-16"
                height-class="h-8 rounded-full"
                :delay="(row + 3) % 6"
              />
              <UiSkeleton
                variant="line"
                width-class="w-20"
                height-class="h-8 rounded-full"
                :delay="(row + 4) % 6"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Sidebar -->
    <div
      class="flex min-w-0 flex-col gap-5 lg:sticky lg:top-2 lg:self-start"
    >
      <div
        class="rounded-[1.75rem] border border-zinc-200/50 bg-[#f6f6fa] p-5 sm:rounded-3xl sm:p-6"
      >
        <div class="flex items-center justify-between gap-3">
          <UiSkeleton
            variant="line"
            width-class="w-36"
            height-class="h-5"
            :delay="1"
          />
          <UiSkeleton
            variant="line"
            width-class="w-10"
            height-class="h-9 rounded-lg"
            :delay="2"
          />
        </div>
        <ul class="mt-5 space-y-4">
          <li
            v-for="i in 5"
            :key="i"
            class="flex items-center gap-3"
          >
            <UiSkeleton
              variant="circle"
              width-class="w-9"
              height-class="h-9"
              :delay="i % 6"
            />
            <div class="min-w-0 flex-1 space-y-2">
              <UiSkeleton
                variant="line"
                width-class="w-full"
                height-class="h-3.5"
                :delay="(i + 1) % 6"
              />
              <UiSkeleton
                variant="line"
                width-class="w-3/4"
                height-class="h-1.5 rounded-full"
                :delay="(i + 2) % 6"
              />
            </div>
          </li>
        </ul>
      </div>

      <div
        class="rounded-[1.75rem] border border-zinc-200/50 bg-[#f3f3f7] p-5 sm:rounded-3xl sm:p-6"
      >
        <UiSkeleton
          variant="line"
          width-class="w-32"
          height-class="h-5"
          :delay="1"
        />
        <UiSkeleton
          class="mt-2"
          variant="line"
          width-class="w-full"
          height-class="h-3"
          :delay="2"
        />
        <ul class="mt-5 space-y-5">
          <li
            v-for="j in 3"
            :key="j"
            class="flex gap-3"
          >
            <UiSkeleton
              variant="circle"
              width-class="w-11"
              height-class="h-11"
              :delay="j % 6"
            />
            <div class="min-w-0 flex-1 space-y-2 pt-0.5">
              <UiSkeleton
                variant="line"
                width-class="w-4/5"
                height-class="h-4"
                :delay="(j + 1) % 6"
              />
              <UiSkeleton
                variant="line"
                width-class="w-1/2"
                height-class="h-3"
                :delay="(j + 2) % 6"
              />
              <UiSkeleton
                variant="line"
                width-class="w-24"
                height-class="h-6 rounded-full"
                :delay="(j + 3) % 6"
              />
            </div>
          </li>
        </ul>
        <div class="mt-6 rounded-2xl border border-zinc-200/50 bg-white/70 px-4 py-3">
          <UiSkeleton
            variant="line"
            width-class="w-28"
            height-class="h-3"
            :delay="4"
          />
          <div class="mt-3 space-y-2">
            <UiSkeleton
              v-for="k in 3"
              :key="k"
              variant="line"
              width-class="w-full"
              height-class="h-2.5"
              :delay="k % 6"
            />
          </div>
        </div>
      </div>
    </div>
  </UiSkeletonPanel>
</template>
