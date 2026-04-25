<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { useToastStore } from "../../stores/toast";
import { useAuthStore } from "../../stores/auth";
import SkeletonAdminListCards from "../../components/skeleton/SkeletonAdminListCards.vue";
import {
  clearBodyScrollLock,
  setBodyScrollLocked,
} from "../../lib/bodyScrollLock";
import { formatFunctionsInvokeError } from "../../lib/formatFunctionsInvokeError";

const toast = useToastStore();
const auth = useAuthStore();

const COMPOSE_SCROLL_LOCK_ID = "admin-announcements-compose";

type Row = {
  id: string;
  title: string;
  message: string;
  type: string;
  is_active: boolean;
  created_at: string;
};

const rows = ref<Row[]>([]);
const loading = ref(true);
const title = ref("");
const message = ref("");
const type = ref("info");
const busy = ref(false);
const composeModalOpen = ref(false);
const composePanelRef = ref<HTMLElement | null>(null);

const typeOptions = [
  {
    value: "info",
    label: "Info",
    hint: "General updates — blue accent on seller dashboards.",
  },
  {
    value: "warning",
    label: "Warning",
    hint: "Time-sensitive or disruptive changes.",
  },
  {
    value: "urgent",
    label: "Urgent",
    hint: "Critical; use sparingly.",
  },
] as const;

const canPublish = computed(
  () => title.value.trim().length > 0 && message.value.trim().length > 0,
);

function typeBadgeClass(t: string) {
  if (t === "urgent")
    return "border-rose-200/90 bg-rose-50 text-rose-900 ring-rose-100";
  if (t === "warning")
    return "border-amber-200/90 bg-amber-50 text-amber-950 ring-amber-100";
  return "border-sky-200/90 bg-sky-50 text-sky-950 ring-sky-100";
}

function typeLabel(t: string) {
  const o = typeOptions.find((x) => x.value === t);
  return o?.label ?? t;
}

function resetDraft() {
  title.value = "";
  message.value = "";
  type.value = "info";
}

function openComposeModal() {
  resetDraft();
  composeModalOpen.value = true;
}

function closeComposeModal() {
  if (busy.value) return;
  composeModalOpen.value = false;
  resetDraft();
}

function onComposeModalKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    closeComposeModal();
  }
}

watch(composeModalOpen, async (open) => {
  setBodyScrollLocked(COMPOSE_SCROLL_LOCK_ID, open);
  if (open) {
    await nextTick();
    composePanelRef.value?.focus();
  }
});

onBeforeUnmount(() => {
  clearBodyScrollLock(COMPOSE_SCROLL_LOCK_ID);
});

async function load() {
  loading.value = true;
  if (!isSupabaseConfigured()) return;
  const { data, error } = await getSupabaseBrowser()
    .from("announcements")
    .select("id, title, message, type, is_active, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    toast.error(error.message);
    rows.value = [];
  } else rows.value = (data ?? []) as Row[];
  loading.value = false;
}

onMounted(load);

async function createAnn() {
  if (!canPublish.value) {
    toast.error("Enter a title and message.");
    return;
  }
  busy.value = true;
  const { data: inserted, error } = await getSupabaseBrowser()
    .from("announcements")
    .insert({
      title: title.value.trim(),
      message: message.value.trim(),
      type: type.value,
      is_active: true,
    })
    .select("id")
    .single();
  busy.value = false;
  if (error) toast.error(error.message);
  else {
    toast.success("Announcement published.");
    composeModalOpen.value = false;
    resetDraft();
    await load();

    const id = inserted?.id as string | undefined;
    if (id && auth.isSuperAdmin) {
      try {
        const { data: smsData, error: smsErr } =
          await getSupabaseBrowser().functions.invoke(
            "notify-platform-staff-announcement",
            { body: { announcement_id: id } },
          );
        if (smsErr) {
          console.warn(
            "[notify-platform-staff-announcement]",
            smsErr.message,
          );
          toast.error(
            formatFunctionsInvokeError(
              smsErr,
              "notify-platform-staff-announcement",
            ),
          );
        } else if (smsData && typeof smsData === "object") {
          const payload = smsData as {
            ok?: boolean;
            warnings?: string[];
            sent?: number;
          };
          const w = Array.isArray(payload.warnings) ? payload.warnings : [];
          const sent = typeof payload.sent === "number" ? payload.sent : 0;
          if (w.length > 0) {
            if (sent === 0) {
              toast.error(
                `Announcement is live, but staff SMS was not sent: ${w.join(" ")}`,
              );
            } else {
              toast.info(
                `SMS reached ${sent} number(s). Notes: ${w.join(" ")}`,
              );
            }
          }
        }
      } catch (e) {
        console.warn("[notify-platform-staff-announcement]", e);
      }
    }
  }
}

async function toggle(r: Row) {
  const { error } = await getSupabaseBrowser()
    .from("announcements")
    .update({ is_active: !r.is_active })
    .eq("id", r.id);
  if (error) toast.error(error.message);
  else {
    toast.success(
      r.is_active ? "Announcement deactivated." : "Announcement activated.",
    );
    await load();
  }
}
</script>

<template>
  <div class="w-full min-w-0 max-w-none space-y-8 px-4 pb-10 sm:px-6 lg:px-8">
    <header
      class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div class="min-w-0 space-y-2">
        <h1
          class="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.65rem]"
        >
          Announcements
        </h1>
        <p class="max-w-2xl text-sm leading-relaxed text-slate-600">
          Only <strong class="font-semibold text-slate-800">active</strong>
          announcements appear on seller dashboards; you can deactivate older
          items without deleting them.
        </p>
      </div>
      <button
        v-if="auth.isSuperAdmin"
        type="button"
        class="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-2xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-violet-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 sm:self-center"
        @click="openComposeModal"
      >
        <svg
          class="h-5 w-5 opacity-95"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 4.5v15m7.5-7.5h-15"
          />
        </svg>
        New announcement
      </button>
    </header>

    <p
      v-if="auth.isPlatformStaff && !auth.isSuperAdmin"
      class="rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-sm leading-relaxed text-amber-950 shadow-sm ring-1 ring-amber-100"
    >
      You are signed in as <strong>Admin</strong>. Publishing and activating
      announcements is limited to <strong>Super admin</strong> accounts.
    </p>

    <!-- List -->
    <section aria-labelledby="announcements-list-heading">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h2
          id="announcements-list-heading"
          class="text-base font-semibold text-slate-900"
        >
          Library
        </h2>
        <p v-if="!loading" class="text-xs font-medium text-slate-500">
          {{ rows.length }}
          {{ rows.length === 1 ? "item" : "items" }}
        </p>
      </div>

      <SkeletonAdminListCards
        v-if="loading"
        label="Loading announcements"
        :rows="4"
      />

      <div
        v-else-if="rows.length"
        class="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100/80"
      >
        <div class="overflow-x-auto">
          <table class="w-full min-w-[52rem] border-collapse text-left text-sm">
            <thead>
              <tr
                class="border-b border-slate-200 bg-slate-50/95 text-[11px] font-bold uppercase tracking-wide text-slate-500"
              >
                <th scope="col" class="whitespace-nowrap px-4 py-3">Type</th>
                <th scope="col" class="whitespace-nowrap px-4 py-3">Status</th>
                <th scope="col" class="whitespace-nowrap px-4 py-3">Created</th>
                <th scope="col" class="min-w-[8rem] px-4 py-3">Title</th>
                <th scope="col" class="min-w-[12rem] px-4 py-3">Message</th>
                <th
                  scope="col"
                  class="whitespace-nowrap px-4 py-3 text-right sm:pr-5"
                >
                  Action
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr
                v-for="r in rows"
                :key="r.id"
                class="transition hover:bg-slate-50/70"
              >
                <td class="align-middle px-4 py-3">
                  <span
                    class="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1"
                    :class="typeBadgeClass(r.type)"
                  >
                    {{ typeLabel(r.type) }}
                  </span>
                </td>
                <td class="align-middle px-4 py-3">
                  <span
                    class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    :class="
                      r.is_active
                        ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80'
                        : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/80'
                    "
                  >
                    <span
                      class="h-1.5 w-1.5 shrink-0 rounded-full"
                      :class="r.is_active ? 'bg-emerald-500' : 'bg-slate-400'"
                      aria-hidden="true"
                    />
                    {{ r.is_active ? "Active" : "Inactive" }}
                  </span>
                </td>
                <td class="align-middle whitespace-nowrap px-4 py-3 tabular-nums text-xs text-slate-500">
                  <time :datetime="r.created_at">{{
                    new Date(r.created_at).toLocaleString()
                  }}</time>
                </td>
                <td class="max-w-[14rem] align-middle px-4 py-3">
                  <p class="truncate font-semibold text-slate-900" :title="r.title">
                    {{ r.title }}
                  </p>
                </td>
                <td class="max-w-[22rem] align-middle px-4 py-3">
                  <p
                    class="line-clamp-2 text-xs leading-relaxed text-slate-600"
                    :title="r.message"
                  >
                    {{ r.message }}
                  </p>
                </td>
                <td class="align-middle px-4 py-3 text-right sm:pr-5">
                  <button
                    v-if="auth.isSuperAdmin"
                    type="button"
                    class="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                    @click="toggle(r)"
                  >
                    {{ r.is_active ? "Deactivate" : "Activate" }}
                  </button>
                  <span v-else class="text-xs text-slate-400">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div
        v-else
        class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center"
      >
        <p class="text-sm font-medium text-slate-700">No announcements yet</p>
        <p class="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-500">
          When you publish one, it will appear here and on seller dashboards
          (if active).
        </p>
        <button
          v-if="auth.isSuperAdmin"
          type="button"
          class="mt-6 inline-flex items-center justify-center rounded-2xl bg-violet-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800"
          @click="openComposeModal"
        >
          Create announcement
        </button>
      </div>
    </section>

    <!-- Compose modal -->
    <Teleport to="body">
      <Transition name="ann-modal">
        <div
          v-if="composeModalOpen"
          class="fixed inset-0 z-[380] flex items-end justify-center p-0 sm:items-center sm:p-4"
        >
          <div
            class="absolute inset-0 bg-zinc-900/50 backdrop-blur-[2px]"
            aria-hidden="true"
          />

          <div
            ref="composePanelRef"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ann-modal-heading"
            tabindex="-1"
            class="relative z-10 flex max-h-[min(92dvh,52rem)] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-slate-200/90 bg-white shadow-[0_-24px_60px_-20px_rgba(15,23,42,0.35)] ring-1 ring-slate-200/60 sm:max-h-[90dvh] sm:rounded-3xl sm:shadow-2xl lg:max-w-4xl"
            @keydown="onComposeModalKeydown"
          >
            <div
              class="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"
            >
              <h2
                id="ann-modal-heading"
                class="text-base font-semibold text-slate-900"
              >
                New announcement
              </h2>
              <button
                type="button"
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close"
                :disabled="busy"
                @click="closeComposeModal"
              >
                <svg
                  class="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div class="space-y-5">
                <div>
                  <label
                    for="ann-modal-title"
                    class="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-700"
                  >
                    Title
                  </label>
                  <input
                    id="ann-modal-title"
                    v-model="title"
                    type="text"
                    name="title"
                    autocomplete="off"
                    maxlength="200"
                    placeholder="e.g. Planned maintenance Saturday 10pm"
                    class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none ring-violet-500/0 transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/25"
                  />
                </div>

                <div>
                  <label
                    for="ann-modal-message"
                    class="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-700"
                  >
                    Message
                  </label>
                  <textarea
                    id="ann-modal-message"
                    v-model="message"
                    name="message"
                    rows="5"
                    maxlength="4000"
                    placeholder="What sellers need to know, links, and any dates in plain language."
                    class="min-h-[7.5rem] w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-900 shadow-sm outline-none ring-violet-500/0 transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/25"
                  />
                </div>

                <div>
                  <p
                    id="ann-modal-type-legend"
                    class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700"
                  >
                    Tone
                  </p>
                  <div
                    class="grid gap-2 sm:grid-cols-3"
                    role="group"
                    aria-labelledby="ann-modal-type-legend"
                  >
                    <label
                      v-for="opt in typeOptions"
                      :key="opt.value"
                      class="relative flex cursor-pointer flex-col rounded-2xl border p-3 text-left shadow-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-violet-500/40"
                      :class="
                        type === opt.value
                          ? 'border-violet-400 bg-violet-50/90 ring-1 ring-violet-200/80'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      "
                    >
                      <input
                        v-model="type"
                        type="radio"
                        name="announcement-type-modal"
                        :value="opt.value"
                        class="sr-only"
                      />
                      <span class="text-sm font-semibold text-slate-900">{{
                        opt.label
                      }}</span>
                      <span
                        class="mt-1 text-[11px] leading-snug text-slate-600"
                        >{{ opt.hint }}</span
                      >
                    </label>
                  </div>
                </div>

                <p class="text-[11px] leading-relaxed text-slate-500">
                  Publishing sets the announcement to
                  <strong class="text-slate-700">active</strong> immediately.
                </p>
              </div>
            </div>

            <div
              class="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50/80 px-5 py-4 sm:flex-row sm:justify-end"
            >
              <button
                type="button"
                class="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
                :disabled="busy"
                @click="closeComposeModal"
              >
                Cancel
              </button>
              <button
                type="button"
                class="inline-flex min-h-[2.75rem] min-w-[9rem] items-center justify-center rounded-2xl bg-violet-700 px-6 text-sm font-semibold text-white shadow-md transition hover:bg-violet-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:pointer-events-none disabled:opacity-45"
                :disabled="busy || !canPublish"
                :aria-busy="busy"
                @click="createAnn"
              >
                {{ busy ? "Publishing…" : "Publish" }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.ann-modal-enter-active,
.ann-modal-leave-active {
  transition: opacity 0.2s ease;
}
.ann-modal-enter-active .relative.z-10,
.ann-modal-leave-active .relative.z-10 {
  transition:
    opacity 0.2s ease,
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
.ann-modal-enter-from,
.ann-modal-leave-to {
  opacity: 0;
}
.ann-modal-enter-from .relative.z-10,
.ann-modal-leave-to .relative.z-10 {
  opacity: 0;
  transform: translateY(0.75rem) scale(0.98);
}
@media (min-width: 640px) {
  .ann-modal-enter-from .relative.z-10,
  .ann-modal-leave-to .relative.z-10 {
    transform: scale(0.98);
  }
}
</style>
