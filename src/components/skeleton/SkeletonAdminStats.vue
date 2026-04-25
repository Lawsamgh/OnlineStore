<script setup lang="ts">
import UiSkeleton from "./UiSkeleton.vue";
import UiSkeletonPanel from "./UiSkeletonPanel.vue";
</script>

<template>
  <UiSkeletonPanel label="Loading platform stats">
    <div
      class="mt-6 grid min-h-0 grid-cols-1 gap-6 md:mt-8 md:grid-cols-[minmax(0,1fr)_minmax(13.5rem,18%)] md:items-stretch md:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,22%)] lg:gap-8"
      aria-hidden="true"
    >
      <div class="flex h-full min-h-0 min-w-0 flex-col gap-6 lg:gap-8">
        <ul
          class="grid min-w-0 shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 lg:gap-4"
        >
          <li
            v-for="i in 4"
            :key="i"
            class="flex min-h-[12.5rem] flex-col rounded-2xl border border-zinc-200/80 bg-white/70 p-4 pb-4 shadow-sm sm:min-h-[13.5rem] sm:rounded-[1.35rem] sm:p-4 sm:pb-5 lg:min-h-[14rem] lg:p-5"
          >
            <UiSkeleton
              variant="line"
              width-class="w-24"
              height-class="h-3"
              tone="slate"
              :delay="i % 6"
            />
            <div class="mt-2 flex items-end justify-between gap-2.5 sm:mt-3">
              <UiSkeleton
                variant="line"
                class="min-w-0 flex-1"
                width-class="w-2/3"
                height-class="h-9 sm:h-10 lg:h-11"
                tone="slate"
                :delay="(i + 1) % 6"
              />
              <div
                class="h-12 w-12 shrink-0 overflow-hidden rounded-xl ring-1 ring-zinc-200/70 sm:h-14 sm:w-14 sm:rounded-[1.1rem]"
              >
                <UiSkeleton
                  variant="rect"
                  width-class="w-full"
                  height-class="h-full min-h-[2.75rem]"
                  tone="slate"
                  :delay="(i + 2) % 6"
                />
              </div>
            </div>
            <UiSkeleton
              class="mt-2 rounded-full"
              variant="line"
              width-class="w-28"
              height-class="h-6"
              tone="slate"
              :delay="(i + 2) % 6"
            />
            <UiSkeleton
              class="mt-1.5"
              variant="line"
              width-class="w-40"
              height-class="h-3"
              tone="slate"
              :delay="(i + 3) % 6"
            />
            <div class="mt-auto space-y-1.5 pt-3 sm:pt-4">
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

        <section
          class="rounded-3xl border border-zinc-200/70 bg-white/60 p-5 shadow-sm sm:p-6"
        >
          <UiSkeleton
            variant="line"
            width-class="w-44"
            height-class="h-6"
            tone="slate"
            :delay="1"
          />
          <UiSkeleton
            class="mt-2"
            variant="line"
            width-class="w-36"
            height-class="h-4"
            tone="slate"
            :delay="2"
          />
          <UiSkeleton
            class="mt-1"
            variant="line"
            width-class="w-40"
            height-class="h-8"
            tone="slate"
            :delay="3"
          />
          <UiSkeleton
            class="mt-5"
            variant="rect"
            width-class="w-full"
            height-class="h-44 rounded-2xl"
            tone="slate"
            :delay="4"
          />
        </section>

        <div
          class="flex min-h-[16rem] flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-zinc-200/60 bg-white shadow-[0_28px_70px_-40px_rgba(15,23,42,0.18)] sm:min-h-[17rem] sm:rounded-3xl md:min-h-0"
        >
          <div
            class="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 sm:px-6"
          >
            <UiSkeleton
              variant="line"
              width-class="w-36"
              height-class="h-6"
              tone="slate"
              :delay="1"
            />
            <UiSkeleton
              variant="rect"
              width-class="w-10"
              height-class="h-10 rounded-full"
              tone="slate"
              :delay="2"
            />
          </div>
          <div class="min-h-0 flex-1 overflow-hidden">
            <div class="border-b border-zinc-200 bg-zinc-100/90 px-5 py-3 sm:px-6">
              <UiSkeleton
                variant="line"
                width-class="w-full"
                height-class="h-3"
                tone="slate"
                :delay="2"
              />
            </div>
            <div class="space-y-3 p-4 sm:p-5">
              <div
                v-for="r in 4"
                :key="`pipeline-row-${r}`"
                class="rounded-2xl border border-zinc-200/70 bg-white/85 p-4"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-3">
                    <UiSkeleton
                      variant="rect"
                      width-class="w-10"
                      height-class="h-10 rounded-full"
                      tone="slate"
                      :delay="(r + 1) % 6"
                    />
                    <UiSkeleton
                      variant="line"
                      width-class="w-32"
                      height-class="h-4"
                      tone="slate"
                      :delay="(r + 2) % 6"
                    />
                  </div>
                  <UiSkeleton
                    variant="rect"
                    width-class="w-10"
                    height-class="h-10 rounded-full"
                    tone="slate"
                    :delay="(r + 3) % 6"
                  />
                </div>
                <UiSkeleton
                  class="mt-3"
                  variant="line"
                  width-class="w-full"
                  height-class="h-3"
                  tone="slate"
                  :delay="(r + 4) % 6"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside
        class="flex h-full min-h-0 self-stretch flex-col gap-5 rounded-[1.75rem] border border-zinc-200/80 bg-white/60 p-6 shadow-sm sm:rounded-3xl"
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
