<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useToastStore } from "../../stores/toast";
import { copyTextToClipboard } from "../../lib/copyToClipboard";
import { toOrderReference } from "../../lib/orderReference";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";

const route = useRoute();
const toast = useToastStore();

const storeSlug = String(route.params.storeSlug ?? "");
const orderId = String(route.params.orderId ?? "");
const orderRef = toOrderReference(orderId);

const copied = ref(false);
const sellerPhone = ref<string | null>(null);
const sellerPhoneVisible = ref(false);
const sellerPhoneCopied = ref(false);

const maskedSellerPhone = computed(() => {
  const raw = sellerPhone.value?.trim();
  if (!raw) return "Unavailable";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return raw;
  return `${digits.slice(0, 4)}••••${digits.slice(-3)}`;
});

const sellerPhoneDialHref = computed(() => {
  const raw = sellerPhone.value?.trim();
  if (!raw) return null;
  const digitsOnly = raw.replace(/\D/g, "");
  if (!digitsOnly) return null;
  // Ghana compatibility: convert 233XXXXXXXXX to local 0XXXXXXXXX for dialers
  // that reject country-code-only format from `tel:` links.
  if (digitsOnly.startsWith("233") && digitsOnly.length === 12) {
    return `tel:0${digitsOnly.slice(3)}`;
  }
  if (digitsOnly.startsWith("0")) {
    return `tel:${digitsOnly}`;
  }
  return `tel:+${digitsOnly}`;
});

function copyOrderRef() {
  void copyTextToClipboard(orderRef).then((ok) => {
    if (ok) {
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 2000);
      return;
    }
    toast.error(
      "Could not copy automatically. Long-press the order number, then choose Copy.",
    );
  });
}

function copySellerPhone() {
  const raw = sellerPhone.value?.trim();
  if (!raw) return;
  void copyTextToClipboard(raw).then((ok) => {
    if (ok) {
      sellerPhoneCopied.value = true;
      setTimeout(() => {
        sellerPhoneCopied.value = false;
      }, 1800);
      return;
    }
    toast.error("Could not copy seller number. Please copy manually.");
  });
}

async function loadSellerPhone() {
  if (!isSupabaseConfigured() || !storeSlug) return;
  const { data } = await getSupabaseBrowser()
    .from("stores")
    .select("whatsapp_phone_e164")
    .eq("slug", storeSlug)
    .eq("is_active", true)
    .maybeSingle();
  const raw =
    data && typeof data.whatsapp_phone_e164 === "string"
      ? data.whatsapp_phone_e164.trim()
      : "";
  sellerPhone.value = raw.length ? raw : null;
}

onMounted(() => {
  const w = sessionStorage.getItem("lastOrderNotifyWarning");
  if (w) {
    toast.info(`Notifications may be delayed: ${w}`);
    sessionStorage.removeItem("lastOrderNotifyWarning");
  }
  void loadSellerPhone();
});
</script>

<template>
  <div class="flex min-h-[calc(100vh-80px)] items-center justify-center bg-gradient-to-br from-emerald-50/60 via-white to-slate-50 px-4 py-12">
    <div class="w-full max-w-md">

      <!-- Success card -->
      <div class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60">

        <!-- Top accent band -->
        <div class="h-1.5 w-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500" />

        <div class="px-8 pb-8 pt-7 text-center">
          <!-- Checkmark circle -->
          <span
            class="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 shadow-inner"
            aria-hidden="true"
          >
            <svg class="h-10 w-10 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>

          <h1 class="mt-5 text-2xl font-extrabold tracking-tight text-slate-900">Order placed!</h1>
          <p class="mt-2 text-sm leading-relaxed text-slate-500">
            Your order has been sent to the seller. You'll receive a confirmation at the email you provided.
          </p>

          <!-- Order reference -->
          <div class="mt-6 rounded-2xl border border-dashed border-emerald-200 bg-emerald-50 px-5 py-4">
            <p class="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">Order reference</p>
            <div class="mt-2 flex items-center justify-center gap-2">
              <p class="font-mono text-xl font-bold tracking-tight text-slate-900 select-all">{{ orderRef }}</p>
              <button
                type="button"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition"
                :class="copied
                  ? 'border-emerald-300 bg-emerald-100 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-400 hover:border-emerald-300 hover:text-emerald-600'"
                :aria-label="copied ? 'Copied!' : 'Copy order reference'"
                @click="copyOrderRef"
              >
                <!-- Checkmark when copied -->
                <svg v-if="copied" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                <!-- Copy icon -->
                <svg v-else class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
            <p
              class="mt-1.5 text-[11px] font-medium transition-colors"
              :class="copied ? 'text-emerald-600' : 'text-slate-400'"
            >
              {{ copied ? 'Copied to clipboard!' : 'Tap the icon to copy' }}
            </p>
          </div>

          <!-- Info bullets -->
          <ul class="mt-6 space-y-2.5 text-left">
            <li class="flex items-start gap-2.5">
              <svg class="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
              <span class="text-xs text-slate-600">The seller has been notified and will prepare your order.</span>
            </li>
            <li class="flex items-start gap-2.5">
              <svg class="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
              <span class="text-xs text-slate-600">Payment is made directly to the seller (cash, MoMo, etc.).</span>
            </li>
            <li class="flex items-start gap-2.5">
              <svg class="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
              <span class="text-xs text-slate-600">Save your reference number to track or enquire about this order.</span>
            </li>
          </ul>

          <div
            class="mt-6 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 text-left shadow-sm shadow-emerald-900/5"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <p
                  class="text-[11px] font-semibold uppercase tracking-wider text-emerald-700"
                >
                  Seller contact
                </p>
                <p class="mt-1 text-xs text-emerald-900/80">
                  Call now for delivery updates or directions.
                </p>
              </div>
              <a
                v-if="sellerPhoneDialHref"
                :href="sellerPhoneDialHref"
                class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-white shadow-sm transition hover:bg-emerald-800"
                aria-label="Call seller now"
                title="Call seller now"
              >
                <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.9.32 1.78.59 2.63a2 2 0 0 1-.45 2.11L8 9.91a16 16 0 0 0 6.09 6.09l1.45-1.2a2 2 0 0 1 2.11-.45c.85.27 1.73.47 2.63.59A2 2 0 0 1 22 16.92z"/></svg>
              </a>
            </div>
            <div
              class="mt-3 rounded-xl border border-emerald-200 bg-white px-3 py-3"
            >
              <p class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Mobile number
              </p>
              <p
                class="mt-1 font-mono text-lg font-extrabold tracking-wide text-slate-900"
              >
                {{
                  sellerPhoneVisible
                    ? (sellerPhone || "Unavailable")
                    : maskedSellerPhone
                }}
              </p>
            </div>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:pointer-events-none disabled:opacity-50"
                :disabled="!sellerPhone"
                @click="sellerPhoneVisible = !sellerPhoneVisible"
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
                {{ sellerPhoneVisible ? "Hide" : "Show" }}
              </button>
              <button
                type="button"
                class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:pointer-events-none disabled:opacity-50"
                :disabled="!sellerPhone"
                @click="copySellerPhone"
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                {{ sellerPhoneCopied ? "Copied" : "Copy number" }}
              </button>
            </div>
          </div>

          <!-- CTAs -->
          <RouterLink
            :to="{ name: 'store-order-track', params: { storeSlug }, query: { ref: orderRef } }"
            class="mt-7 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-emerald-600 bg-white py-3.5 text-sm font-bold text-emerald-800 shadow-sm transition hover:bg-emerald-50 active:scale-[0.98]"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            Track delivery
          </RouterLink>
          <RouterLink
            :to="`/${storeSlug}`"
            class="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 py-3.5 text-sm font-bold text-white shadow-sm shadow-emerald-900/20 transition hover:bg-emerald-800 active:scale-[0.98]"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            Continue shopping
          </RouterLink>
        </div>
      </div>

      <p class="mt-4 text-center text-xs text-slate-400">
        Need help? Contact the seller directly using the number you provided.
      </p>
    </div>
  </div>
</template>
