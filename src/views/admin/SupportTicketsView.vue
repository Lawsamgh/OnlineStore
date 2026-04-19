<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { useRealtimeTableRefresh } from "../../composables/useRealtimeTableRefresh";
import { useToastStore } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import SkeletonAdminListCards from "../../components/skeleton/SkeletonAdminListCards.vue";
import DefaultFreeTierSellerAvatar from "../../components/admin/DefaultFreeTierSellerAvatar.vue";
import StoreLogoEmptyAvatar from "../../components/admin/StoreLogoEmptyAvatar.vue";
import { normalizeSignupPlanId } from "../../constants/planEntitlements";

const toast = useToastStore();
const ui = useUiStore();

type Author = {
  display_name: string | null;
  avatar_path: string | null;
  /** `profiles.signup_plan` (known tier from `normalizeSignupPlanId`). */
  signup_plan: string | null;
} | null;

type Row = {
  id: string;
  store_id: string;
  subject: string;
  message: string;
  status: string;
  created_at: string;
  stores: { name: string; slug: string; logo_path: string | null } | null;
  author: Author;
  /** Resolved once in `load` for template `img :src`. */
  author_avatar_url: string | null;
};

const rows = ref<Row[]>([]);
const loading = ref(true);
/** Ticket ids whose profile photo failed to load (fallback to initial / default). */
const brokenAuthorAvatarIds = ref(new Set<string>());

function markAuthorAvatarBroken(ticketId: string) {
  const next = new Set(brokenAuthorAvatarIds.value);
  next.add(ticketId);
  brokenAuthorAvatarIds.value = next;
}

const rowsOpenCount = computed(
  () => rows.value.filter((r) => (r.status || "").toLowerCase() === "open")
    .length,
);

const rowsClosedCount = computed(
  () =>
    rows.value.filter((r) => (r.status || "").toLowerCase() === "closed")
      .length,
);

function formatTicketOpened(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function ticketShortId(id: string): string {
  const t = id.replace(/-/g, "");
  return t.length >= 10 ? `${t.slice(0, 6)}…${t.slice(-4)}` : id;
}

function profileAvatarPublicUrl(
  path: string | null | undefined,
): string | null {
  const p = path?.trim();
  if (!p || !isSupabaseConfigured()) return null;
  return getSupabaseBrowser().storage.from("profile-avatars").getPublicUrl(p)
    .data.publicUrl;
}

function sellerDisplayName(author: Author): string {
  const n = author?.display_name?.trim();
  if (n) return n;
  return "Seller";
}

function sellerInitial(author: Author): string {
  const n = sellerDisplayName(author);
  if (!n || n === "Seller") return "?";
  return n[0]!.toUpperCase();
}

function isFreeTierSignupPlan(plan: string | null | undefined): boolean {
  const p = (plan ?? "").trim().toLowerCase();
  return p === "" || p === "free";
}

function authorHasSelectedPlan(author: Author): boolean {
  return normalizeSignupPlanId(author?.signup_plan ?? undefined) !== null;
}

function storeLogoNotUploaded(stores: Row["stores"]): boolean {
  return !stores?.logo_path?.trim();
}

/**
 * Seller chose a plan (can upload shop logo) but `stores.logo_path` is still empty —
 * same empty tile as store manage header before first logo upload.
 */
function shouldShowStoreLogoEmptyAvatar(r: Row): boolean {
  if (!authorHasSelectedPlan(r.author) || !storeLogoNotUploaded(r.stores)) {
    return false;
  }
  const photoVisible =
    Boolean(r.author_avatar_url) && !brokenAuthorAvatarIds.value.has(r.id);
  if (photoVisible) return false;
  return true;
}

/** No plan / free-unset and no working profile photo — neutral silhouette. */
function shouldShowDefaultFreeTierAvatar(r: Row): boolean {
  if (shouldShowStoreLogoEmptyAvatar(r)) return false;
  const photoVisible =
    Boolean(r.author_avatar_url) && !brokenAuthorAvatarIds.value.has(r.id);
  if (photoVisible) return false;
  return isFreeTierSignupPlan(r.author?.signup_plan);
}

function ticketStatusBadgeClass(status: string): string {
  const s = (status || "").toLowerCase();
  const base =
    "inline-flex shrink-0 items-center justify-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize tabular-nums ring-1";
  if (s === "open") {
    return `${base} bg-amber-50 text-amber-950 ring-amber-200/85`;
  }
  if (s === "closed") {
    return `${base} bg-zinc-100 text-zinc-700 ring-zinc-200/80`;
  }
  return `${base} bg-violet-50 text-violet-900 ring-violet-200/80`;
}

async function load(opts?: { silent?: boolean }) {
  const silent = opts?.silent ?? false;
  if (!silent) loading.value = true;
  if (!isSupabaseConfigured()) {
    if (!silent) loading.value = false;
    return;
  }
  if (!silent) brokenAuthorAvatarIds.value = new Set();
  try {
    const { data, error } = await getSupabaseBrowser()
      .from("support_tickets")
      .select(
        "id, store_id, subject, message, status, created_at, stores(name, slug, logo_path), author:profiles!support_tickets_author_id_fkey(display_name, avatar_path, signup_plan)",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      toast.error(error.message);
      rows.value = [];
    } else {
      rows.value = (data ?? []).map((r: Record<string, unknown>) => {
        const author =
          (r.author as Author | undefined) ??
          (r.profiles as Author | undefined) ??
          null;
        return {
          ...r,
          stores: r.stores as Row["stores"],
          author,
          author_avatar_url: profileAvatarPublicUrl(author?.avatar_path),
        } as Row;
      });
    }
  } finally {
    if (!silent) loading.value = false;
    void ui.refreshAdminOpenTicketCount();
  }
}

onMounted(() => {
  void load();
});

useRealtimeTableRefresh({
  channelName: "admin-support-tickets",
  deps: [loading],
  getTables: () => [{ table: "support_tickets" }],
  onEvent: () => load({ silent: true }),
});

async function setStatus(id: string, status: string) {
  const { error } = await getSupabaseBrowser()
    .from("support_tickets")
    .update({ status })
    .eq("id", id);
  if (error) toast.error(error.message);
  else {
    toast.success(status === "closed" ? "Ticket closed." : "Ticket reopened.");
    await load({ silent: true });
  }
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold tracking-tight text-zinc-900">
      Support tickets
    </h1>
    <p class="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600">
      Tickets opened by sellers from their stores.
    </p>

    <SkeletonAdminListCards
      v-if="loading"
      class="mt-8"
      label="Loading support tickets"
      :rows="5"
    />

    <div
      v-else
      class="mt-8 flex max-h-[min(60dvh,40rem)] min-h-[12rem] min-w-0 w-full flex-col overflow-hidden rounded-t-3xl rounded-b-none border border-zinc-200/70 bg-white/95 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.14)] ring-1 ring-zinc-100/80 backdrop-blur-md lg:max-h-[min(60dvh,46rem)]"
      role="region"
      aria-label="All support tickets"
    >
      <div
        class="flex shrink-0 flex-col gap-2 border-b border-zinc-100 bg-gradient-to-r from-violet-50/90 to-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
      >
        <div class="min-w-0">
          <h2 class="text-sm font-bold tracking-tight text-zinc-900">
            Ticket queue
          </h2>
          <p
            class="mt-0.5 text-[11px] font-medium leading-snug text-zinc-500"
          >
            Seller, subject, store, status, and opened time — newest first.
            Empty shop-logo tile when the seller has picked a plan but no logo
            yet. Use actions to close or reopen.
          </p>
        </div>
        <span
          class="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-zinc-900/[0.06] px-2.5 py-1 text-[11px] font-bold tabular-nums text-zinc-700 ring-1 ring-zinc-200/80 sm:self-auto"
        >
          <span class="text-zinc-500">Tickets</span>
          {{ rows.length }}
        </span>
      </div>

      <template v-if="rows.length">
        <div
          class="hidden shrink-0 grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_minmax(0,7.5rem)_6.5rem_9rem_minmax(0,0.95fr)_5.5rem] gap-x-3 border-b border-zinc-200 bg-zinc-100/90 px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500 lg:grid"
        >
          <span class="text-left">Seller</span>
          <span class="text-left">Subject</span>
          <span class="text-left">Store</span>
          <span class="text-left">Status</span>
          <span class="text-left">Opened</span>
          <span class="text-left">Message</span>
          <span class="text-right">Action</span>
        </div>
        <ul
          class="min-h-0 flex-1 divide-y divide-zinc-100 overflow-x-auto overflow-y-auto overscroll-y-contain"
        >
          <li
            v-for="r in rows"
            :key="r.id"
            class="transition-colors hover:bg-zinc-50/90 motion-safe:duration-150"
          >
            <div class="space-y-3 p-4 lg:hidden">
              <div class="flex items-center gap-2.5">
                <img
                  v-if="
                    r.author_avatar_url &&
                    !brokenAuthorAvatarIds.has(r.id)
                  "
                  :src="r.author_avatar_url"
                  alt=""
                  class="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-zinc-200/80"
                  @error="markAuthorAvatarBroken(r.id)"
                />
                <StoreLogoEmptyAvatar
                  v-else-if="shouldShowStoreLogoEmptyAvatar(r)"
                  class="h-10 w-10 shrink-0"
                />
                <DefaultFreeTierSellerAvatar
                  v-else-if="shouldShowDefaultFreeTierAvatar(r)"
                  class="h-10 w-10 shrink-0"
                />
                <span
                  v-else
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-100 to-zinc-100 text-sm font-bold text-violet-900 ring-1 ring-zinc-200/80"
                  aria-hidden="true"
                >
                  {{ sellerInitial(r.author) }}
                </span>
                <p class="min-w-0 text-xs font-semibold text-zinc-900">
                  {{ sellerDisplayName(r.author) }}
                </p>
              </div>
              <div class="flex flex-wrap items-start justify-between gap-2">
                <p
                  class="min-w-0 flex-1 text-[0.9375rem] font-semibold leading-snug tracking-tight text-zinc-900"
                >
                  {{ r.subject }}
                </p>
                <span :class="ticketStatusBadgeClass(r.status)">{{
                  r.status
                }}</span>
              </div>
              <p class="text-xs font-medium text-zinc-700">
                <span class="font-semibold text-zinc-900">{{
                  r.stores?.name ?? "Store"
                }}</span>
                <span v-if="r.stores?.slug" class="text-zinc-500">
                  ({{ r.stores.slug }})</span
                >
              </p>
              <p class="text-[11px] font-medium tabular-nums text-zinc-500">
                Opened {{ formatTicketOpened(r.created_at) }}
              </p>
              <p
                class="line-clamp-4 text-xs leading-relaxed text-zinc-600 whitespace-pre-wrap"
              >
                {{ r.message }}
              </p>
              <div class="flex justify-end border-t border-zinc-100/90 pt-3">
                <button
                  v-if="r.status === 'open'"
                  type="button"
                  class="rounded-full px-4 py-2 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200/90 transition hover:bg-zinc-100"
                  @click="setStatus(r.id, 'closed')"
                >
                  Close
                </button>
                <button
                  v-else
                  type="button"
                  class="rounded-full px-4 py-2 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200/80 transition hover:bg-emerald-50"
                  @click="setStatus(r.id, 'open')"
                >
                  Reopen
                </button>
              </div>
            </div>

            <div
              class="hidden min-w-[60rem] grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_minmax(0,7.5rem)_6.5rem_9rem_minmax(0,0.95fr)_5.5rem] gap-x-3 px-4 py-3.5 lg:grid lg:items-start"
            >
              <div class="flex min-w-0 items-center gap-2.5 pt-0.5">
                <img
                  v-if="
                    r.author_avatar_url &&
                    !brokenAuthorAvatarIds.has(r.id)
                  "
                  :src="r.author_avatar_url"
                  alt=""
                  class="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-zinc-200/80"
                  @error="markAuthorAvatarBroken(r.id)"
                />
                <StoreLogoEmptyAvatar
                  v-else-if="shouldShowStoreLogoEmptyAvatar(r)"
                  class="h-9 w-9 shrink-0"
                />
                <DefaultFreeTierSellerAvatar
                  v-else-if="shouldShowDefaultFreeTierAvatar(r)"
                  class="h-9 w-9 shrink-0"
                />
                <span
                  v-else
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-100 to-zinc-100 text-xs font-bold text-violet-900 ring-1 ring-zinc-200/80"
                  aria-hidden="true"
                >
                  {{ sellerInitial(r.author) }}
                </span>
                <p
                  class="min-w-0 truncate text-xs font-semibold text-zinc-900"
                  :title="sellerDisplayName(r.author)"
                >
                  {{ sellerDisplayName(r.author) }}
                </p>
              </div>
              <div class="min-w-0">
                <p
                  class="truncate text-sm font-semibold tracking-tight text-zinc-900"
                >
                  {{ r.subject }}
                </p>
                <p
                  class="mt-1 font-mono text-[10px] text-zinc-400"
                  :title="r.id"
                >
                  {{ ticketShortId(r.id) }}
                </p>
              </div>
              <div class="min-w-0 pt-0.5">
                <p class="truncate text-xs font-semibold text-zinc-900">
                  {{ r.stores?.name ?? "—" }}
                </p>
                <p
                  v-if="r.stores?.slug"
                  class="mt-0.5 truncate font-mono text-[10px] text-zinc-500"
                >
                  {{ r.stores.slug }}
                </p>
                <p v-else class="mt-0.5 text-[10px] text-zinc-400">—</p>
              </div>
              <div class="pt-0.5">
                <span :class="ticketStatusBadgeClass(r.status)">{{
                  r.status
                }}</span>
              </div>
              <p
                class="pt-0.5 text-xs tabular-nums leading-snug text-zinc-600"
              >
                {{ formatTicketOpened(r.created_at) }}
              </p>
              <p
                class="line-clamp-3 min-w-0 pt-0.5 text-xs leading-relaxed text-zinc-600 whitespace-pre-wrap"
              >
                {{ r.message }}
              </p>
              <div class="flex justify-end pt-0.5">
                <button
                  v-if="r.status === 'open'"
                  type="button"
                  class="text-sm font-semibold text-zinc-700 underline-offset-2 transition hover:text-zinc-900 hover:underline"
                  @click="setStatus(r.id, 'closed')"
                >
                  Close
                </button>
                <button
                  v-else
                  type="button"
                  class="text-sm font-semibold text-emerald-700 underline-offset-2 transition hover:text-emerald-900 hover:underline"
                  @click="setStatus(r.id, 'open')"
                >
                  Reopen
                </button>
              </div>
            </div>
          </li>
        </ul>

        <footer
          class="shrink-0 border-t border-zinc-200/90 bg-gradient-to-r from-zinc-50/95 to-zinc-100/80 px-4 py-3 sm:px-5"
        >
          <div class="flex flex-col gap-2 text-xs text-zinc-600 lg:hidden">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-semibold text-zinc-800">Summary</span>
              <span class="tabular-nums text-zinc-500"
                >{{ rows.length }} total</span
              >
            </div>
            <div class="flex flex-wrap gap-x-4 gap-y-1">
              <span
                >Open
                <span class="font-semibold text-amber-800">{{
                  rowsOpenCount
                }}</span></span
              >
              <span
                >Closed
                <span class="font-semibold text-zinc-800">{{
                  rowsClosedCount
                }}</span></span
              >
            </div>
          </div>
          <div
            class="hidden min-w-[60rem] grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_minmax(0,7.5rem)_6.5rem_9rem_minmax(0,0.95fr)_5.5rem] gap-x-3 text-[11px] lg:grid lg:items-center"
          >
            <span class="font-bold uppercase tracking-wider text-zinc-500"
              >Summary</span
            >
            <span class="text-zinc-500" aria-hidden="true">—</span>
            <span class="text-zinc-500" aria-hidden="true">—</span>
            <span class="text-zinc-500" aria-hidden="true">—</span>
            <span class="text-zinc-500" aria-hidden="true">—</span>
            <div
              class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right font-medium text-zinc-600"
            >
              <span
                ><span class="tabular-nums font-bold text-zinc-900">{{
                  rows.length
                }}</span>
                total</span
              >
              <span class="text-zinc-300" aria-hidden="true">·</span>
              <span class="text-amber-800"
                ><span class="font-bold tabular-nums">{{
                  rowsOpenCount
                }}</span>
                open</span
              >
              <span class="text-zinc-300" aria-hidden="true">·</span>
              <span
                ><span class="font-bold tabular-nums text-zinc-800">{{
                  rowsClosedCount
                }}</span>
                closed</span
              >
            </div>
            <span class="text-right text-zinc-400" aria-hidden="true">—</span>
          </div>
        </footer>
      </template>

      <div
        v-else
        class="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-14 text-center"
      >
        <span
          class="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-violet-400 ring-1 ring-violet-100/90"
          aria-hidden="true"
        >
          <svg
            class="h-7 w-7"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 5.25a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0-10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zM12 18.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 5.25a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 6.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm13.5 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0-5.25a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0-5.25a.375.375 0 11-.75 0 .375.375 0 01.75 0zM12 3.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0-5.25a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0-5.25a.375.375 0 11-.75 0 .375.375 0 01.75 0zM12 8.25a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
            />
          </svg>
        </span>
        <p class="text-sm font-semibold text-zinc-800">No tickets yet</p>
        <p class="max-w-sm text-xs leading-relaxed text-zinc-500">
          When sellers open tickets from their store dashboard, they will
          appear in this queue.
        </p>
      </div>
    </div>
  </div>
</template>
