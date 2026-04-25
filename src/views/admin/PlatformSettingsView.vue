<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { useToastStore } from "../../stores/toast";
import { useAuthStore } from "../../stores/auth";
import { STORE_THEME_PRESETS } from "../../constants/storeThemes";

const toast = useToastStore();
const auth = useAuthStore();

type PlatformSettingRow = { id: string; key: string; value: string };

const rows = ref<PlatformSettingRow[]>([]);
const loading = ref(true);
const savingKey = ref<string | null>(null);
const newKey = ref("");
const newVal = ref("");
const busy = ref(false);
const addRowOpen = ref(false);
const inlineSaveError = ref("");

// ── Notifications ──────────────────────────────────────────────────────────
const renewalDaysInput = ref("7");
const renewalDaysRow = computed(
  () => rows.value.find((r) => r.key === "seller_subscription_renewal_reminder_days") ?? null,
);
const renewalReminderEnabledInput = ref(true);

const SUPER_ADMIN_SMS_KEY = "super_admin_sms_phone_e164";
const superAdminSmsInput = ref("");
const superAdminSmsRow = computed(
  () => rows.value.find((r) => r.key === SUPER_ADMIN_SMS_KEY) ?? null,
);

// ── Billing (per plan) ─────────────────────────────────────────────────────
type PaidPlanId = "starter" | "growth" | "pro";
const PLAN_PRICE_KEYS: Record<PaidPlanId, string> = {
  starter: "seller_subscription_monthly_pesewas_starter",
  growth: "seller_subscription_monthly_pesewas_growth",
  pro: "seller_subscription_monthly_pesewas_pro",
};
const planPriceLabels: Record<PaidPlanId, string> = {
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
};
const PAID_PLANS: PaidPlanId[] = ["starter", "growth", "pro"];
const starterPriceInput = ref("");
const growthPriceInput = ref("");
const proPriceInput = ref("");
const planPriceInputs: Record<PaidPlanId, typeof starterPriceInput> = {
  starter: starterPriceInput,
  growth: growthPriceInput,
  pro: proPriceInput,
};
function planPriceRow(plan: PaidPlanId) {
  const key = PLAN_PRICE_KEYS[plan];
  return rows.value.find((r) => r.key === key) ?? null;
}
function planPriceGhs(plan: PaidPlanId): string | null {
  const v = Number(planPriceInputs[plan].value);
  if (!Number.isFinite(v) || v <= 0) return null;
  return (v / 100).toFixed(2);
}

// ── Access ─────────────────────────────────────────────────────────────────
const storeReactivationGraceDaysInput = ref("0");

// ── Storefront ─────────────────────────────────────────────────────────────
const storefrontDefaultThemeInput = ref("default");

async function load() {
  loading.value = true;
  if (!isSupabaseConfigured()) {
    loading.value = false;
    return;
  }
  const { data, error } = await getSupabaseBrowser()
    .from("platform_settings")
    .select("id, key, value")
    .order("key");
  if (error) {
    toast.error(error.message);
    rows.value = [];
  } else {
    rows.value = (data ?? []) as PlatformSettingRow[];
    renewalDaysInput.value =
      rows.value.find((r) => r.key === "seller_subscription_renewal_reminder_days")?.value ?? "7";
    renewalReminderEnabledInput.value =
      (rows.value.find((r) => r.key === "seller_subscription_renewal_reminder_enabled")?.value ??
        "true") === "true";
    starterPriceInput.value =
      rows.value.find((r) => r.key === PLAN_PRICE_KEYS.starter)?.value ?? "15000";
    growthPriceInput.value =
      rows.value.find((r) => r.key === PLAN_PRICE_KEYS.growth)?.value ?? "35000";
    proPriceInput.value =
      rows.value.find((r) => r.key === PLAN_PRICE_KEYS.pro)?.value ?? "65000";
    storeReactivationGraceDaysInput.value =
      rows.value.find((r) => r.key === "seller_store_reactivation_grace_days")?.value ?? "0";
    storefrontDefaultThemeInput.value =
      rows.value.find((r) => r.key === "storefront_default_theme_id")?.value ?? "default";
    superAdminSmsInput.value =
      rows.value.find((r) => r.key === SUPER_ADMIN_SMS_KEY)?.value ?? "";
  }
  loading.value = false;
}

onMounted(load);

async function upsertSetting(key: string, value: string): Promise<boolean> {
  inlineSaveError.value = "";
  savingKey.value = key;
  try {
    const sb = getSupabaseBrowser();
    const { data: updated, error: updateError } = await sb
      .from("platform_settings")
      .update({ value })
      .eq("key", key)
      .select("id")
      .maybeSingle();

    if (updateError) {
      inlineSaveError.value = updateError.message;
      toast.error(updateError.message);
      return false;
    }

    if (!updated) {
      const { error: insertError } = await sb
        .from("platform_settings")
        .insert({ key, value });
      if (insertError) {
        inlineSaveError.value = insertError.message;
        toast.error(insertError.message);
        return false;
      }
    }
  } finally {
    savingKey.value = null;
  }

  await load();
  return true;
}

async function saveRenewalReminderDays() {
  const raw = String(renewalDaysInput.value ?? "").trim();
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 30) {
    toast.error("Enter a number between 1 and 30.");
    return;
  }
  const ok = await upsertSetting("seller_subscription_renewal_reminder_days", String(n));
  if (ok) toast.success("Reminder window saved.");
}

async function saveRenewalReminderEnabled() {
  const ok = await upsertSetting(
    "seller_subscription_renewal_reminder_enabled",
    renewalReminderEnabledInput.value ? "true" : "false",
  );
  if (ok) toast.success("Reminder status saved.");
}

async function saveSuperAdminSmsPhone() {
  const raw = superAdminSmsInput.value.trim();
  if (raw.length > 0) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 9) {
      toast.error("Enter a valid phone number (e.g. 0594042786 or +233594042786).");
      return;
    }
  }
  const ok = await upsertSetting(SUPER_ADMIN_SMS_KEY, raw);
  if (ok) {
    toast.success(
      raw
        ? "Super admin SMS number saved. New-seller alerts go here."
        : "Cleared. New-seller SMS falls back to the super admin profile phone.",
    );
  }
}

async function savePlanPricing(plan: PaidPlanId) {
  const raw = String(planPriceInputs[plan].value ?? "").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 100) {
    toast.error("Enter a valid amount in pesewas (minimum 100 = GH₵ 1.00).");
    return;
  }
  const ok = await upsertSetting(PLAN_PRICE_KEYS[plan], String(Math.round(n)));
  if (ok) toast.success(`${planPriceLabels[plan]} monthly price saved.`);
}

async function saveStoreReactivationGraceDays() {
  const n = Number.parseInt(storeReactivationGraceDaysInput.value.trim(), 10);
  if (!Number.isFinite(n) || n < 0 || n > 30) {
    toast.error("Grace days must be a whole number between 0 and 30.");
    return;
  }
  const ok = await upsertSetting("seller_store_reactivation_grace_days", String(n));
  if (ok) toast.success("Access grace window saved.");
}

async function saveStorefrontDefaultTheme() {
  const allowed = new Set(STORE_THEME_PRESETS.map((t) => t.id));
  const v = storefrontDefaultThemeInput.value.trim().toLowerCase();
  if (!allowed.has(v as (typeof STORE_THEME_PRESETS)[number]["id"])) {
    toast.error("Invalid default storefront theme.");
    return;
  }
  const ok = await upsertSetting("storefront_default_theme_id", v);
  if (ok) toast.success("Storefront default theme saved.");
}

async function addRow() {
  if (!newKey.value.trim() || !newVal.value.trim()) {
    toast.error("Enter both key and value.");
    return;
  }
  busy.value = true;
  const { error } = await getSupabaseBrowser()
    .from("platform_settings")
    .insert({ key: newKey.value.trim(), value: newVal.value.trim() });
  busy.value = false;
  if (error) {
    toast.error(error.message);
    return;
  }
  newKey.value = "";
  newVal.value = "";
  addRowOpen.value = false;
  toast.success("Setting added.");
  await load();
}

async function saveRaw(r: PlatformSettingRow) {
  const ok = await upsertSetting(r.key, r.value);
  if (ok) toast.success("Setting saved.");
}

// hide managed keys from the raw editor to avoid duplication
const MANAGED_KEYS = new Set([
  "seller_subscription_renewal_reminder_days",
  "seller_subscription_renewal_reminder_enabled",
  "seller_store_reactivation_grace_days",
  "storefront_default_theme_id",
  "seller_subscription_monthly_pesewas",
  PLAN_PRICE_KEYS.starter,
  PLAN_PRICE_KEYS.growth,
  PLAN_PRICE_KEYS.pro,
  SUPER_ADMIN_SMS_KEY,
]);
const unmanagedRows = computed(() => rows.value.filter((r) => !MANAGED_KEYS.has(r.key)));
</script>

<template>
  <div class="space-y-6">

    <!-- Page header -->
    <div class="flex flex-col gap-4 rounded-3xl border border-white/60 bg-white/70 px-6 py-5 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.15)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div class="flex items-center gap-2.5">
          <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-900 text-white">
            <svg class="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894Z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          </div>
          <h1 class="text-xl font-bold tracking-tight text-zinc-900">Platform Settings</h1>
        </div>
        <p class="mt-2 text-sm text-zinc-600">Super admin controls for platform-wide behavior and configuration.</p>
      </div>
      <span
        class="inline-flex items-center gap-1.5 self-start rounded-full border border-violet-200/80 bg-violet-50 px-3 py-1 text-[11px] font-semibold text-violet-800 ring-1 ring-violet-100/60 sm:self-auto"
      >
        <span class="h-1.5 w-1.5 rounded-full bg-violet-500" />
        Super admin only
      </span>
    </div>

    <!-- Read-only notice for non-super admins -->
    <div
      v-if="auth.isPlatformStaff && !auth.isSuperAdmin"
      class="flex items-start gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/80 px-5 py-4"
    >
      <svg class="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
      </svg>
      <p class="text-sm text-amber-900">
        You are signed in as <strong>Admin</strong>. Settings are read-only.
        A <strong>Super admin</strong> account is required to make changes.
      </p>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 4" :key="`skel-${i}`" class="h-28 animate-pulse rounded-2xl bg-zinc-100/80" />
    </div>

    <template v-else>
      <!-- ── SECTION: Billing ─────────────────────────────────────────────── -->
      <div class="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white/95 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.16)] ring-1 ring-zinc-100/80">
        <!-- Section header -->
        <div class="flex items-center gap-3 border-b border-zinc-100 bg-gradient-to-r from-zinc-50/95 to-white px-6 py-4">
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
            </svg>
          </span>
          <div>
            <p class="text-sm font-bold text-zinc-900">Billing</p>
            <p class="text-[11px] text-zinc-500">Manage paid plan monthly fees.</p>
          </div>
        </div>

        <div class="divide-y divide-zinc-100">
          <div
            v-if="inlineSaveError"
            class="mx-6 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
          >
            Save failed: {{ inlineSaveError }}
          </div>

          <!-- Monthly prices per plan -->
          <div
            v-for="plan in PAID_PLANS"
            :key="`price-${plan}`"
            class="grid gap-4 px-6 py-5 sm:grid-cols-[1fr_auto]"
          >
            <div>
              <p class="text-sm font-semibold text-zinc-800">{{ planPriceLabels[plan] }} monthly price</p>
              <p class="mt-0.5 text-xs text-zinc-500">
                Monthly fee charged for the {{ planPriceLabels[plan] }} plan. Value stored in pesewas.
              </p>
              <p class="mt-1 text-[10px] font-mono text-zinc-400">{{ PLAN_PRICE_KEYS[plan] }}</p>
            </div>
            <div class="flex shrink-0 flex-col gap-1.5 sm:items-end">
              <div class="flex items-center gap-2">
                <div class="relative">
                  <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-400">pesewas</span>
                  <input
                    v-model="planPriceInputs[plan].value"
                    type="number"
                    min="100"
                    step="100"
                    placeholder="e.g. 10000"
                    class="w-40 rounded-xl border border-zinc-300 py-2 pl-[4.5rem] pr-3 text-sm outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/20 disabled:bg-zinc-50"
                    :disabled="!auth.isSuperAdmin || savingKey === PLAN_PRICE_KEYS[plan]"
                  />
                </div>
                <button
                  type="button"
                  class="rounded-xl bg-zinc-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50"
                  :disabled="!auth.isSuperAdmin || savingKey === PLAN_PRICE_KEYS[plan]"
                  @click.prevent="savePlanPricing(plan)"
                >
                  {{ savingKey === PLAN_PRICE_KEYS[plan] ? "Saving…" : "Save" }}
                </button>
              </div>
              <div class="flex items-center gap-1.5">
                <p v-if="planPriceGhs(plan)" class="text-xs text-zinc-500">
                  = <strong class="text-zinc-800">GH₵ {{ planPriceGhs(plan) }}</strong> / month
                </p>
                <span v-if="planPriceRow(plan)" class="text-[10px] text-zinc-400">
                  · currently saved: {{ planPriceRow(plan)?.value }}
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- ── SECTION: Notifications ───────────────────────────────────────── -->
      <div class="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white/95 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.16)] ring-1 ring-zinc-100/80">
        <div class="flex items-center gap-3 border-b border-zinc-100 bg-gradient-to-r from-zinc-50/95 to-white px-6 py-4">
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.25 17.25a2.25 2.25 0 11-4.5 0m7.5-6v-2.25a5.25 5.25 0 10-10.5 0v2.25l-1.5 2.25h13.5l-1.5-2.25z" />
            </svg>
          </span>
          <div>
            <p class="text-sm font-bold text-zinc-900">Notifications</p>
            <p class="text-[11px] text-zinc-500">
              Renewal reminders, super admin SMS alerts, and related options.
            </p>
          </div>
        </div>
        <div class="divide-y divide-zinc-100">
          <div class="grid gap-4 px-6 py-5 sm:grid-cols-[1fr_auto]">
            <div>
              <p class="text-sm font-semibold text-zinc-800">Renewal reminder enabled</p>
              <p class="mt-0.5 text-xs text-zinc-500">Turn seller renewal reminder emails on or off globally.</p>
              <p class="mt-1 text-[10px] font-mono text-zinc-400">seller_subscription_renewal_reminder_enabled</p>
            </div>
            <div class="flex items-center gap-2">
              <select
                v-model="renewalReminderEnabledInput"
                class="w-28 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/20 disabled:bg-zinc-50"
                :disabled="!auth.isSuperAdmin || savingKey === 'seller_subscription_renewal_reminder_enabled'"
              >
                <option :value="true">Enabled</option>
                <option :value="false">Disabled</option>
              </select>
              <button
                type="button"
                class="rounded-xl bg-zinc-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50"
                :disabled="!auth.isSuperAdmin || savingKey === 'seller_subscription_renewal_reminder_enabled'"
                @click.prevent="saveRenewalReminderEnabled"
              >
                {{ savingKey === "seller_subscription_renewal_reminder_enabled" ? "Saving…" : "Save" }}
              </button>
            </div>
          </div>
          <div class="grid gap-4 px-6 py-5 sm:grid-cols-[1fr_auto]">
            <div>
              <p class="text-sm font-semibold text-zinc-800">Renewal reminder window</p>
              <p class="mt-0.5 text-xs text-zinc-500">
                Days before subscription expiry when the reminder email is sent.
              </p>
              <p class="mt-1 text-[10px] font-mono text-zinc-400">seller_subscription_renewal_reminder_days</p>
            </div>
            <div class="flex shrink-0 flex-col gap-1.5 sm:items-end">
              <div class="flex items-center gap-2">
                <div class="relative">
                  <input
                    v-model="renewalDaysInput"
                    type="number"
                    min="1"
                    max="30"
                    class="w-24 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/20 disabled:bg-zinc-50"
                    :disabled="!auth.isSuperAdmin || savingKey === 'seller_subscription_renewal_reminder_days'"
                  />
                  <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">days</span>
                </div>
                <button
                  type="button"
                  class="rounded-xl bg-zinc-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50"
                  :disabled="!auth.isSuperAdmin || savingKey === 'seller_subscription_renewal_reminder_days'"
                  @click.prevent="saveRenewalReminderDays"
                >
                  {{ savingKey === "seller_subscription_renewal_reminder_days" ? "Saving…" : "Save" }}
                </button>
              </div>
              <div class="flex items-center gap-1.5">
                <p class="text-[10px] text-zinc-400">Range: 1 – 30 days</p>
                <span v-if="renewalDaysRow" class="text-[10px] text-zinc-400">
                  · currently saved: {{ renewalDaysRow.value }}
                </span>
              </div>
            </div>
          </div>
          <div class="grid gap-4 px-6 py-5 sm:grid-cols-[1fr_auto]">
            <div>
              <p class="text-sm font-semibold text-zinc-800">Super admin SMS number</p>
              <p class="mt-0.5 text-xs text-zinc-500">
                All new-seller join alerts are sent to this number (Arkesel). Use Ghana local
                (059…), international (+233…), or digits only. Leave empty to use the super
                admin user’s profile phone instead.
              </p>
              <p class="mt-1 text-[10px] font-mono text-zinc-400">{{ SUPER_ADMIN_SMS_KEY }}</p>
            </div>
            <div class="flex shrink-0 flex-col gap-1.5 sm:items-end">
              <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <input
                  v-model="superAdminSmsInput"
                  type="tel"
                  autocomplete="tel"
                  placeholder="e.g. 0594042786"
                  class="min-w-0 flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/20 disabled:bg-zinc-50 sm:w-52"
                  :disabled="!auth.isSuperAdmin || savingKey === SUPER_ADMIN_SMS_KEY"
                />
                <button
                  type="button"
                  class="rounded-xl bg-zinc-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50"
                  :disabled="!auth.isSuperAdmin || savingKey === SUPER_ADMIN_SMS_KEY"
                  @click.prevent="saveSuperAdminSmsPhone"
                >
                  {{ savingKey === SUPER_ADMIN_SMS_KEY ? "Saving…" : "Save" }}
                </button>
              </div>
              <p v-if="superAdminSmsRow" class="text-[10px] text-zinc-400">
                Saved: {{ superAdminSmsRow.value || "(empty)" }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- ── SECTION: Access ──────────────────────────────────────────────── -->
      <div class="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white/95 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.16)] ring-1 ring-zinc-100/80">
        <div class="flex items-center gap-3 border-b border-zinc-100 bg-gradient-to-r from-zinc-50/95 to-white px-6 py-4">
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 00-9 0v3.75m-1.5 0h12a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5h-12A1.5 1.5 0 014.5 18v-6A1.5 1.5 0 016 10.5z" />
            </svg>
          </span>
          <div>
            <p class="text-sm font-bold text-zinc-900">Access</p>
            <p class="text-[11px] text-zinc-500">Policy and access behavior defaults.</p>
          </div>
        </div>
        <div class="grid gap-4 px-6 py-5 sm:grid-cols-[1fr_auto]">
          <div>
            <p class="text-sm font-semibold text-zinc-800">Store reactivation grace days</p>
            <p class="mt-0.5 text-xs text-zinc-500">Grace period (days) for reactivating seller store links.</p>
            <p class="mt-1 text-[10px] font-mono text-zinc-400">seller_store_reactivation_grace_days</p>
          </div>
          <div class="flex items-center gap-2">
            <div class="relative">
              <input
                v-model="storeReactivationGraceDaysInput"
                type="number"
                min="0"
                max="30"
                class="w-24 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/20 disabled:bg-zinc-50"
                :disabled="!auth.isSuperAdmin || savingKey === 'seller_store_reactivation_grace_days'"
              />
              <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">days</span>
            </div>
            <button
              type="button"
              class="rounded-xl bg-zinc-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50"
              :disabled="!auth.isSuperAdmin || savingKey === 'seller_store_reactivation_grace_days'"
              @click.prevent="saveStoreReactivationGraceDays"
            >
              {{ savingKey === "seller_store_reactivation_grace_days" ? "Saving…" : "Save" }}
            </button>
          </div>
        </div>
      </div>

      <!-- ── SECTION: Storefront ──────────────────────────────────────────── -->
      <div class="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white/95 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.16)] ring-1 ring-zinc-100/80">
        <div class="flex items-center gap-3 border-b border-zinc-100 bg-gradient-to-r from-zinc-50/95 to-white px-6 py-4">
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-fuchsia-100 text-fuchsia-700">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 4.5h16.5A1.5 1.5 0 0121.75 6v12a1.5 1.5 0 01-1.5 1.5H3.75a1.5 1.5 0 01-1.5-1.5V6a1.5 1.5 0 011.5-1.5zM7.5 9.75a1.125 1.125 0 100-2.25 1.125 1.125 0 000 2.25z" />
            </svg>
          </span>
          <div>
            <p class="text-sm font-bold text-zinc-900">Storefront</p>
            <p class="text-[11px] text-zinc-500">Default storefront experience settings.</p>
          </div>
        </div>
        <div class="grid gap-4 px-6 py-5 sm:grid-cols-[1fr_auto]">
          <div>
            <p class="text-sm font-semibold text-zinc-800">Default storefront theme</p>
            <p class="mt-0.5 text-xs text-zinc-500">Theme preselected when a store has no saved theme.</p>
            <p class="mt-1 text-[10px] font-mono text-zinc-400">storefront_default_theme_id</p>
          </div>
          <div class="flex items-center gap-2">
            <select
              v-model="storefrontDefaultThemeInput"
              class="w-40 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/20 disabled:bg-zinc-50"
              :disabled="!auth.isSuperAdmin || savingKey === 'storefront_default_theme_id'"
            >
              <option v-for="theme in STORE_THEME_PRESETS" :key="theme.id" :value="theme.id">
                {{ theme.label }}
              </option>
            </select>
            <button
              type="button"
              class="rounded-xl bg-zinc-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50"
              :disabled="!auth.isSuperAdmin || savingKey === 'storefront_default_theme_id'"
              @click.prevent="saveStorefrontDefaultTheme"
            >
              {{ savingKey === "storefront_default_theme_id" ? "Saving…" : "Save" }}
            </button>
          </div>
        </div>
      </div>

      <!-- ── SECTION: Raw key/value (unmanaged keys only) ──────────────────── -->
      <div class="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white/95 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.16)] ring-1 ring-zinc-100/80">
        <div class="flex items-center justify-between gap-3 border-b border-zinc-100 bg-gradient-to-r from-zinc-50/95 to-white px-6 py-4">
          <div class="flex items-center gap-3">
            <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
              </svg>
            </span>
            <div>
              <p class="text-sm font-bold text-zinc-900">Custom settings</p>
              <p class="text-[11px] text-zinc-500">Arbitrary key/value pairs for advanced configuration.</p>
            </div>
          </div>
          <button
            v-if="auth.isSuperAdmin"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-2xl bg-zinc-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-zinc-800"
            @click="addRowOpen = !addRowOpen"
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Add key
          </button>
        </div>

        <!-- Add row form -->
        <div v-if="addRowOpen && auth.isSuperAdmin" class="border-b border-zinc-100 bg-zinc-50/60 px-6 py-4">
          <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">New key/value pair</p>
          <div class="flex flex-wrap items-end gap-2">
            <div class="flex-1">
              <label class="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Key</label>
              <input
                v-model="newKey"
                type="text"
                placeholder="setting_key"
                class="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 font-mono text-sm outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/20"
              />
            </div>
            <div class="flex-[2]">
              <label class="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Value</label>
              <input
                v-model="newVal"
                type="text"
                placeholder="value"
                class="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/20"
              />
            </div>
            <div class="flex gap-2">
              <button
                type="button"
                class="rounded-xl border border-zinc-200/80 bg-white px-3.5 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
                @click="addRowOpen = false; newKey = ''; newVal = ''"
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-xl bg-zinc-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50"
                :disabled="busy"
                @click="addRow"
              >
                {{ busy ? "Adding…" : "Add" }}
              </button>
            </div>
          </div>
        </div>

        <!-- Rows -->
        <div v-if="unmanagedRows.length" class="divide-y divide-zinc-100">
          <div
            v-for="r in unmanagedRows"
            :key="r.id"
            class="grid items-center gap-3 px-6 py-3.5 transition hover:bg-zinc-50/60 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)_auto]"
          >
            <div class="min-w-0">
              <p class="truncate font-mono text-[12px] font-semibold text-zinc-700" :title="r.key">{{ r.key }}</p>
            </div>
            <div class="min-w-0">
              <input
                v-model="r.value"
                type="text"
                class="w-full rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 py-1.5 text-sm outline-none transition focus:border-zinc-500 focus:bg-white focus:ring-2 focus:ring-zinc-500/20 disabled:text-zinc-400"
                :disabled="!auth.isSuperAdmin || savingKey === r.key"
                @change="saveRaw(r)"
              />
            </div>
            <button
              type="button"
              class="shrink-0 rounded-xl border border-zinc-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50"
              :disabled="!auth.isSuperAdmin || savingKey === r.key"
              @click="saveRaw(r)"
            >
              {{ savingKey === r.key ? "Saving…" : "Save" }}
            </button>
          </div>
        </div>
        <div v-else class="px-6 py-8 text-center text-sm text-zinc-400">
          No custom settings yet.
          <span v-if="auth.isSuperAdmin" class="block mt-1 text-xs">Use the "Add key" button above to add one.</span>
        </div>
      </div>
    </template>
  </div>
</template>
