<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { clearBodyScrollLock, setBodyScrollLocked } from "../../lib/bodyScrollLock";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { useRealtimeTableRefresh } from "../../composables/useRealtimeTableRefresh";
import { useToastStore } from "../../stores/toast";

const toast = useToastStore();

async function notifySellerViaSms(
  sellerId: string,
  status: "approved" | "rejected",
  rejectReason: string | null,
  storeName: string | null,
) {
  try {
    const { error } = await getSupabaseBrowser().functions.invoke(
      "notify-seller-verification",
      { body: { seller_id: sellerId, status, reject_reason: rejectReason, store_name: storeName } },
    );
    if (error) {
      console.warn("[notify-seller-verification] SMS edge function error:", error);
      toast.error(
        "Verification SMS could not be sent (Edge Function error). Redeploy `notify-seller-verification` after updating `supabase/config.toml`, and set Arkesel secrets in Supabase.",
      );
    }
  } catch (err) {
    console.warn("[notify-seller-verification] Unexpected error:", err);
  }
}

type VerificationRow = {
  id: string;
  seller_id: string;
  store_id: string | null;
  status: "pending" | "approved" | "rejected";
  full_legal_name: string;
  ghana_card_number: string;
  contact_phone_e164: string | null;
  reject_reason: string | null;
  card_front_path: string;
  card_back_path: string;
  selfie_with_card_path: string;
  profiles: { display_name: string | null; avatar_path: string | null } | null;
  stores: { name: string | null } | null;
  avatarPublicUrl: string | null;
};

const loading = ref(true);
const busyId = ref<string | null>(null);
const rows = ref<VerificationRow[]>([]);
const rejectReasonById = ref<Record<string, string>>({});
const signedUrlCache = ref<Record<string, string>>({});

/* ── Image preview modal ── */
const previewUrl = ref<string | null>(null);
const previewLabel = ref("");
const previewLoading = ref(false);

async function openPreview(path: string, label: string) {
  if (!path) return;
  previewLabel.value = label;
  previewUrl.value = null;
  previewLoading.value = true;
  setBodyScrollLocked("seller-verification-preview", true);
  const url = await signedUrl(path);
  previewLoading.value = false;
  if (!url) {
    toast.error("Could not load image.");
    clearBodyScrollLock("seller-verification-preview");
    return;
  }
  previewUrl.value = url;
}

function closePreview() {
  previewUrl.value = null;
  previewLoading.value = false;
  clearBodyScrollLock("seller-verification-preview");
}

function onPreviewKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") closePreview();
}

async function signedUrl(path: string): Promise<string | null> {
  if (!path) return null;
  if (signedUrlCache.value[path]) return signedUrlCache.value[path]!;
  const { data, error } = await getSupabaseBrowser()
    .storage.from("seller-verification-docs")
    .createSignedUrl(path, 60 * 30);
  if (error) return null;
  const url = data.signedUrl;
  signedUrlCache.value = { ...signedUrlCache.value, [path]: url };
  return url;
}

async function loadRows(opts?: { silent?: boolean }) {
  const silent = opts?.silent ?? false;
  if (!isSupabaseConfigured()) {
    if (!silent) loading.value = false;
    return;
  }
  if (!silent) loading.value = true;
  try {
    const { data, error } = await getSupabaseBrowser()
      .from("seller_verifications")
      .select(
        "id, seller_id, store_id, status, full_legal_name, ghana_card_number, contact_phone_e164, reject_reason, card_front_path, card_back_path, selfie_with_card_path, profiles:seller_id(display_name, avatar_path), stores:store_id(name)",
      )
      .order("submitted_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      rows.value = [];
    } else {
      const mapped: VerificationRow[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      // PostgREST returns many-to-one joins as a single object, not an array.
      // Handle both shapes defensively.
      type ProfileShape = { display_name?: string | null; avatar_path?: string | null };
      type StoreShape = { name?: string | null };
      const profileObj: ProfileShape | null = Array.isArray(r.profiles)
        ? ((r.profiles as ProfileShape[])[0] ?? null)
        : (r.profiles as ProfileShape | null) ?? null;
      const storeObj: StoreShape | null = Array.isArray(r.stores)
        ? ((r.stores as StoreShape[])[0] ?? null)
        : (r.stores as StoreShape | null) ?? null;

      const avatarPath = profileObj?.avatar_path?.trim() || null;
      let avatarPublicUrl: string | null = null;
      if (avatarPath) {
        const { data: urlData } = getSupabaseBrowser()
          .storage.from("profile-avatars")
          .getPublicUrl(avatarPath);
        avatarPublicUrl = urlData.publicUrl ?? null;
      }
      return {
        id: String(r.id),
        seller_id: String(r.seller_id),
        store_id: r.store_id ? String(r.store_id) : null,
        status: (r.status as VerificationRow["status"]) ?? "pending",
        full_legal_name: String(r.full_legal_name ?? ""),
        ghana_card_number: String(r.ghana_card_number ?? ""),
        contact_phone_e164:
          typeof r.contact_phone_e164 === "string" && r.contact_phone_e164.trim()
            ? r.contact_phone_e164.trim()
            : null,
        reject_reason:
          typeof r.reject_reason === "string" && r.reject_reason.trim()
            ? r.reject_reason.trim()
            : null,
        card_front_path: String(r.card_front_path ?? ""),
        card_back_path: String(r.card_back_path ?? ""),
        selfie_with_card_path: String(r.selfie_with_card_path ?? ""),
        profiles: profileObj
          ? { display_name: profileObj.display_name ?? null, avatar_path: avatarPath }
          : null,
        stores: storeObj ? { name: storeObj.name ?? null } : null,
        avatarPublicUrl,
      };
      });

      // For rows where store_id was null (old records), fall back to looking up
      // the store by owner_id = seller_id.
      const missingStoreSellerIds = mapped
        .filter((r) => !r.stores)
        .map((r) => r.seller_id);

      if (missingStoreSellerIds.length > 0) {
        const { data: storeData } = await getSupabaseBrowser()
          .from("stores")
          .select("id, name, owner_id")
          .in("owner_id", missingStoreSellerIds);

        const storeByOwner: Record<string, { id: string; name: string }> = {};
        for (const s of (storeData ?? []) as Array<{ id: string; name: string; owner_id: string }>) {
          storeByOwner[s.owner_id] = { id: s.id, name: s.name };
        }

        for (const row of mapped) {
          if (!row.stores && storeByOwner[row.seller_id]) {
            row.stores = { name: storeByOwner[row.seller_id].name };
            if (!row.store_id) row.store_id = storeByOwner[row.seller_id].id;
          }
        }
      }

      rows.value = mapped;
    }
  } finally {
    if (!silent) loading.value = false;
  }
}

async function approve(row: VerificationRow) {
  if (busyId.value) return;
  busyId.value = row.id;
  const now = new Date().toISOString();
  const uid = (await getSupabaseBrowser().auth.getUser()).data.user?.id ?? null;
  const sb = getSupabaseBrowser();
  const [vRes, pRes, sRes] = await Promise.all([
    sb
      .from("seller_verifications")
      .update({ status: "approved", reject_reason: null, reviewed_at: now, reviewed_by: uid })
      .eq("id", row.id),
    sb
      .from("profiles")
      .update({
        seller_verification_status: "approved",
        seller_verification_reject_reason: null,
        seller_verification_reviewed_at: now,
        seller_verification_reviewed_by: uid,
      })
      .eq("id", row.seller_id),
    row.store_id
      ? sb
          .from("stores")
          .update({
            verification_status: "approved",
            verification_reject_reason: null,
            verification_reviewed_at: now,
            verification_reviewed_by: uid,
            is_active: true,
          })
          .eq("id", row.store_id)
      : Promise.resolve({ error: null }),
  ]);
  busyId.value = null;
  if (vRes.error || pRes.error || sRes.error) {
    toast.error(vRes.error?.message || pRes.error?.message || sRes.error?.message || "Approve failed.");
    return;
  }
  toast.success("Seller verification approved.");
  void notifySellerViaSms(row.seller_id, "approved", null, row.stores?.name ?? null);
  await loadRows({ silent: true });
}

async function reject(row: VerificationRow) {
  const reason = (rejectReasonById.value[row.id] ?? "").trim();
  if (!reason) {
    toast.error("Provide a rejection reason before rejecting.");
    return;
  }
  if (busyId.value) return;
  busyId.value = row.id;
  const now = new Date().toISOString();
  const uid = (await getSupabaseBrowser().auth.getUser()).data.user?.id ?? null;
  const sb = getSupabaseBrowser();
  const [vRes, pRes, sRes] = await Promise.all([
    sb
      .from("seller_verifications")
      .update({ status: "rejected", reject_reason: reason, reviewed_at: now, reviewed_by: uid })
      .eq("id", row.id),
    sb
      .from("profiles")
      .update({
        seller_verification_status: "rejected",
        seller_verification_reject_reason: reason,
        seller_verification_reviewed_at: now,
        seller_verification_reviewed_by: uid,
      })
      .eq("id", row.seller_id),
    row.store_id
      ? sb
          .from("stores")
          .update({
            verification_status: "rejected",
            verification_reject_reason: reason,
            verification_reviewed_at: now,
            verification_reviewed_by: uid,
            is_active: false,
          })
          .eq("id", row.store_id)
      : Promise.resolve({ error: null }),
  ]);
  busyId.value = null;
  if (vRes.error || pRes.error || sRes.error) {
    toast.error(vRes.error?.message || pRes.error?.message || sRes.error?.message || "Reject failed.");
    return;
  }
  toast.success("Seller verification rejected.");
  void notifySellerViaSms(row.seller_id, "rejected", reason, row.stores?.name ?? null);
  await loadRows({ silent: true });
}

function statusBadgeClass(status: VerificationRow["status"]) {
  if (status === "approved")
    return "bg-emerald-100/90 text-emerald-800 ring-1 ring-emerald-200/70";
  if (status === "rejected")
    return "bg-rose-100/90 text-rose-800 ring-1 ring-rose-200/70";
  return "bg-amber-100/90 text-amber-800 ring-1 ring-amber-200/70";
}

function statusDotClass(status: VerificationRow["status"]) {
  if (status === "approved") return "bg-emerald-500";
  if (status === "rejected") return "bg-rose-500";
  return "bg-amber-400";
}

function sellerInitial(name: string | null | undefined): string {
  return (name?.trim()[0] ?? "?").toUpperCase();
}

onMounted(() => {
  void loadRows();
});

onBeforeUnmount(() => {
  clearBodyScrollLock("seller-verification-preview");
});

useRealtimeTableRefresh({
  channelName: "admin-seller-verifications",
  deps: [loading],
  debounceMs: 450,
  getTables: () => [{ table: "seller_verifications" }],
  onEvent: () => loadRows({ silent: true }),
});
</script>

<template>
  <section class="flex min-h-0 flex-col gap-6">
    <!-- Page header -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-zinc-900 sm:text-[1.65rem]">
          Seller verifications
        </h1>
        <p class="mt-1 text-sm text-zinc-500">
          Review submitted identity documents and approve or reject with reason.
        </p>
      </div>
      <span
        v-if="!loading"
        class="inline-flex items-center gap-2 rounded-full border border-zinc-200/80 bg-white px-3.5 py-1.5 text-[13px] font-semibold text-zinc-600 shadow-sm"
      >
        <span
          class="h-2 w-2 rounded-full"
          :class="rows.filter(r => r.status === 'pending').length > 0 ? 'bg-amber-400' : 'bg-zinc-300'"
        />
        {{ rows.filter(r => r.status === 'pending').length }} pending
      </span>
    </div>

    <!-- Loading skeleton -->
    <div
      v-if="loading"
      class="space-y-3"
    >
      <div
        v-for="i in 3"
        :key="i"
        class="h-36 animate-pulse rounded-2xl border border-zinc-200/70 bg-zinc-100/60"
      />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!rows.length"
      class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300/80 bg-zinc-50/60 py-20 text-center"
    >
      <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 ring-1 ring-zinc-200/80">
        <svg class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
        </svg>
      </div>
      <p class="mt-4 text-base font-semibold text-zinc-800">No verification requests</p>
      <p class="mt-1.5 text-sm text-zinc-500">New seller submissions will appear here.</p>
    </div>

    <!-- Verification list: single card shell + vertical scroll when many rows -->
    <div
      v-else
      class="min-h-0 w-full overflow-hidden rounded-2xl border border-zinc-200/80 bg-zinc-50/40 shadow-[0_8px_32px_-12px_rgba(15,23,42,0.08)] ring-1 ring-zinc-100/80"
    >
      <div
        class="max-h-[min(70dvh,48rem)] overflow-y-auto overscroll-y-contain px-3 py-3 sm:px-4 sm:py-4"
      >
        <div class="space-y-4">
          <article
            v-for="row in rows"
            :key="row.id"
            class="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-[0_8px_32px_-12px_rgba(15,23,42,0.1)] ring-1 ring-zinc-100/80 transition-shadow hover:shadow-[0_12px_40px_-12px_rgba(15,23,42,0.14)]"
          >
        <!-- Card header -->
        <div class="flex flex-wrap items-center gap-4 border-b border-zinc-100 bg-zinc-50/60 px-5 py-4 sm:px-6">
          <!-- Avatar -->
          <div
            class="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl text-base font-bold text-white shadow-md ring-2 ring-white"
            :class="row.avatarPublicUrl ? 'bg-white' : 'bg-gradient-to-br from-violet-500 to-indigo-600'"
          >
            <img
              v-if="row.avatarPublicUrl"
              :src="row.avatarPublicUrl"
              alt=""
              class="h-full w-full bg-white object-cover"
              @error="($event.target as HTMLImageElement).classList.add('hidden')"
            />
            <span v-else>{{ sellerInitial(row.profiles?.display_name || row.full_legal_name) }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-lg font-bold tracking-tight text-zinc-900">
              {{ row.profiles?.display_name || row.full_legal_name || "Unknown seller" }}
            </p>
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
              <span class="inline-flex items-center gap-1.5">
                <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39-9.91c.29.29.29.77 0 1.06L15 16.17M4.5 9.75l-.463.463M12 3v.01M6.52 6.52l-.01.01M3 12H3.01M18 12h.01M6.99 17.01l-.01.01" />
                </svg>
                {{ row.stores?.name || "No store" }}
              </span>
              <span class="inline-flex items-center gap-1.5">
                <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 6.75Z" />
                </svg>
                {{ row.contact_phone_e164 || "No phone" }}
              </span>
            </div>
          </div>
          <!-- Status badge -->
          <span
            class="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold capitalize"
            :class="statusBadgeClass(row.status)"
          >
            <span class="h-2 w-2 rounded-full" :class="statusDotClass(row.status)" />
            {{ row.status }}
          </span>
        </div>

        <!-- Identity details + document previews in one row -->
        <div class="px-5 py-4 sm:px-6">
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div class="rounded-xl border border-zinc-100 bg-zinc-50/70 px-4 py-3 sm:col-span-1">
              <p class="text-xs font-bold uppercase tracking-wider text-zinc-400">Full legal name</p>
              <p class="mt-1.5 text-base font-semibold text-zinc-900">{{ row.full_legal_name }}</p>
            </div>
            <div class="rounded-xl border border-zinc-100 bg-zinc-50/70 px-4 py-3 sm:col-span-1">
              <p class="text-xs font-bold uppercase tracking-wider text-zinc-400">Ghana card number</p>
              <p class="mt-1.5 font-mono text-base font-semibold text-zinc-900">{{ row.ghana_card_number }}</p>
            </div>

          <!-- Document previews -->
          <div class="col-span-2 grid grid-cols-3 gap-3 sm:col-span-3">
            <button
              v-for="doc in [
                { path: row.card_front_path, label: 'Card Front' },
                { path: row.card_back_path, label: 'Card Back' },
                { path: row.selfie_with_card_path, label: 'Selfie' },
              ]"
              :key="doc.label"
              type="button"
              class="group relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-50 py-4 text-center transition hover:border-indigo-200 hover:bg-indigo-50/40 hover:shadow-sm active:scale-[0.98]"
              @click="openPreview(doc.path, doc.label)"
            >
              <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-zinc-200/70 transition group-hover:ring-indigo-200">
                <svg class="h-5 w-5 text-zinc-500 group-hover:text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                </svg>
              </div>
              <span class="text-sm font-semibold text-zinc-600 group-hover:text-indigo-700">{{ doc.label }}</span>
            </button>
          </div>
          </div>

          <!-- Rejection reason (if already rejected) -->
          <div
            v-if="row.status === 'rejected' && row.reject_reason"
            class="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-200/70 bg-rose-50/80 px-4 py-3"
          >
            <svg class="mt-0.5 h-4 w-4 shrink-0 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <p class="text-sm leading-relaxed text-rose-800">
              <span class="font-bold">Rejection reason:</span> {{ row.reject_reason }}
            </p>
          </div>
        </div>

        <!-- Action bar -->
        <div
          v-if="row.status === 'pending'"
          class="flex flex-col gap-3 border-t border-zinc-100 bg-zinc-50/60 px-5 py-4 sm:flex-row sm:items-center sm:px-6"
        >
          <input
            v-model="rejectReasonById[row.id]"
            type="text"
            placeholder="Enter reason before rejecting…"
            class="min-w-0 flex-1 rounded-xl border border-zinc-200/90 bg-white px-3.5 py-2.5 text-base text-zinc-900 shadow-inner outline-none transition placeholder:text-zinc-400 focus:border-rose-300 focus:ring-2 focus:ring-rose-200/70"
          />
          <div class="flex shrink-0 gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-base font-semibold text-white shadow-md shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="busyId === row.id"
              @click="approve(row)"
            >
              <svg v-if="busyId !== row.id" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              <span
                v-else
                class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
              />
              {{ busyId === row.id ? "Saving…" : "Approve" }}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-5 py-2.5 text-base font-semibold text-white shadow-md shadow-rose-600/20 transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="busyId === row.id"
              @click="reject(row)"
            >
              <svg v-if="busyId !== row.id" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              <span
                v-else
                class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
              />
              {{ busyId === row.id ? "Saving…" : "Reject" }}
            </button>
          </div>
        </div>
          </article>
        </div>
      </div>
    </div>

    <!-- Image preview modal (in-page, no full screen) -->
    <Teleport to="body">
      <Transition name="preview-modal">
        <div
          v-if="previewUrl || previewLoading"
          class="fixed inset-0 z-[360] flex items-center justify-center p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          :aria-label="`Preview: ${previewLabel}`"
          @keydown="onPreviewKeydown"
        >
          <!-- Backdrop -->
          <div
            class="absolute inset-0 bg-zinc-900/70 backdrop-blur-sm"
            aria-hidden="true"
          />

          <!-- Modal card -->
          <div class="relative z-10 flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-zinc-900 shadow-[0_32px_80px_-16px_rgba(0,0,0,0.6)]">
            <!-- Modal header -->
            <div class="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <p class="text-sm font-semibold text-white">{{ previewLabel }}</p>
              <button
                type="button"
                class="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-zinc-400 transition hover:bg-white/20 hover:text-white"
                aria-label="Close preview"
                @click="closePreview"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <!-- Image area -->
            <div class="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-zinc-950/60 p-5">
              <div
                v-if="previewLoading"
                class="flex flex-col items-center gap-3 py-20"
              >
                <span class="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                <p class="text-sm text-zinc-400">Loading image…</p>
              </div>
              <img
                v-else-if="previewUrl"
                :src="previewUrl"
                :alt="previewLabel"
                class="max-h-[82dvh] w-auto max-w-full rounded-xl object-contain shadow-2xl ring-1 ring-white/10"
              />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.preview-modal-enter-active,
.preview-modal-leave-active {
  transition: opacity 0.22s ease;
}
.preview-modal-enter-active .relative.z-10,
.preview-modal-leave-active .relative.z-10 {
  transition:
    opacity 0.22s ease,
    transform 0.26s cubic-bezier(0.22, 1, 0.36, 1);
}
.preview-modal-enter-from,
.preview-modal-leave-to {
  opacity: 0;
}
.preview-modal-enter-from .relative.z-10,
.preview-modal-leave-to .relative.z-10 {
  opacity: 0;
  transform: scale(0.95) translateY(0.5rem);
}
</style>
