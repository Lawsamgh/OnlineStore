<script setup lang="ts">
import { Transition, computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import {
  MAX_STORES_BY_PLAN,
  maxStoresDisplayText,
  maxStoresForPlan,
  normalizeSignupPlanId,
} from "../../constants/planEntitlements";
import { PRICING_PLANS } from "../../constants/pricingPlans";
import { formatFunctionsInvokeError } from "../../lib/formatFunctionsInvokeError";
import { refreshSessionForEdgeFunctions } from "../../lib/refreshSessionForEdgeFunctions";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import SkeletonCreateStoreGate from "../skeleton/SkeletonCreateStoreGate.vue";

withDefaults(
  defineProps<{
    /** `h1` on dedicated page, `h2` inside modal for heading order */
    headingLevel?: "h1" | "h2";
  }>(),
  { headingLevel: "h1" },
);

const router = useRouter();
const auth = useAuthStore();
const toast = useToastStore();
const ui = useUiStore();

const name = ref("");
const slug = ref("");
const description = ref("");
const smsPhone = ref("");
const busy = ref(false);
const profilePhotoFile = ref<File | null>(null);
const cardFrontFile = ref<File | null>(null);
const cardBackFile = ref<File | null>(null);
const selfieFile = ref<File | null>(null);
const profilePhotoInput = ref<HTMLInputElement | null>(null);
const cardFrontInput = ref<HTMLInputElement | null>(null);
const cardBackInput = ref<HTMLInputElement | null>(null);
const selfieInput = ref<HTMLInputElement | null>(null);
const fullLegalName = ref("");
const ghanaCardNumber = ref("");
const profileVerificationStatus = ref<
  "not_submitted" | "pending" | "approved" | "rejected"
>("not_submitted");
const profileVerificationRejectReason = ref<string | null>(null);
const gateLoading = ref(true);
const storeCount = ref(0);
const planBusy = ref(false);
const autoPlanSetError = ref<string | null>(null);

const currentPlanId = computed(() =>
  normalizeSignupPlanId(
    typeof auth.user?.user_metadata?.signup_plan === "string"
      ? auth.user.user_metadata.signup_plan
      : undefined,
  ),
);

const hasSelectedPlan = computed(() => currentPlanId.value !== null);

/** Sellers need `signup_plan` before creating stores; super admins do not (platform / QA). */
const sellerNeedsPlanPicker = computed(
  () => !auth.isSuperAdmin && !hasSelectedPlan.value,
);

const maxStores = computed(() => {
  if (auth.isSuperAdmin) return 9999;
  return currentPlanId.value ? maxStoresForPlan(currentPlanId.value) : 0;
});

const unlimitedStores = computed(
  () =>
    !auth.isSuperAdmin &&
    currentPlanId.value != null &&
    MAX_STORES_BY_PLAN[currentPlanId.value] == null,
);

/** Human-readable store cap for the current plan (`"1"` … `"unlimited"`). */
const storeCapLabel = computed(() =>
  currentPlanId.value ? maxStoresDisplayText(currentPlanId.value) : "",
);

const atStoreLimit = computed(() => {
  if (auth.isSuperAdmin) return false;
  // Resubmissions never create a new store — bypass the limit entirely.
  if (isResubmission.value) return false;
  return hasSelectedPlan.value && storeCount.value >= maxStores.value;
});

const canUseCreateForm = computed(() => {
  if (auth.isSuperAdmin) return true;
  // Resubmissions always show the form — they don't need a paid plan slot.
  if (isResubmission.value) return true;
  return hasSelectedPlan.value && !atStoreLimit.value;
});
const requiresMandatoryVerification = computed(
  () => !auth.isSuperAdmin && profileVerificationStatus.value !== "approved",
);
const verificationPending = computed(
  () => profileVerificationStatus.value === "pending",
);
// True when seller already has a store but was rejected — resubmitting documents only
const isResubmission = computed(
  () => profileVerificationStatus.value === "rejected" && storeCount.value > 0,
);
const existingStoreId = ref<string | null>(null);
const canSubmitWithVerification = computed(() => !verificationPending.value);
const wizardStep = ref(1);
const wizardTotalSteps = computed(() =>
  requiresMandatoryVerification.value ? 4 : 1,
);
const isLastWizardStep = computed(
  () => wizardStep.value >= wizardTotalSteps.value,
);
const storeNameChecking = ref(false);
const storeNameExists = ref(false);
const storeNameCheckError = ref<string | null>(null);
const storeNameLastChecked = ref("");
const storeNameAvailabilityLabel = computed(() => {
  const raw = name.value.trim();
  if (!raw) return null;
  if (storeNameCheckError.value) return storeNameCheckError.value;
  if (storeNameChecking.value) return "Checking store name...";
  if (storeNameLastChecked.value !== raw) return null;
  return storeNameExists.value
    ? "Store name already exists."
    : "Store name is available.";
});

function setImageFile(
  ev: Event,
  targetKey: "profile" | "front" | "back" | "selfie",
  opts?: { jpegOnly?: boolean },
) {
  const target =
    targetKey === "profile"
      ? profilePhotoFile
      : targetKey === "front"
        ? cardFrontFile
        : targetKey === "back"
          ? cardBackFile
          : selfieFile;
  const file = (ev.target as HTMLInputElement).files?.[0] ?? null;
  if (!file) {
    target.value = null;
    return;
  }
  if (opts?.jpegOnly && !/^image\/jpeg$/i.test(file.type)) {
    toast.error("Only JPG/JPEG image files are allowed.");
    target.value = null;
    return;
  }
  if (!file.type.startsWith("image/")) {
    toast.error("Please choose an image file.");
    target.value = null;
    return;
  }
  target.value = file;
}

function openUploadPicker(targetKey: "profile" | "front" | "back" | "selfie") {
  if (targetKey === "profile") profilePhotoInput.value?.click();
  else if (targetKey === "front") cardFrontInput.value?.click();
  else if (targetKey === "back") cardBackInput.value?.click();
  else selfieInput.value?.click();
}

function selectedFileName(file: File | null, fallback: string): string {
  return file?.name?.trim() || fallback;
}

let storeNameCheckTimer: number | null = null;
let storeNameCheckSeq = 0;

function resetStoreNameCheckState() {
  storeNameChecking.value = false;
  storeNameExists.value = false;
  storeNameCheckError.value = null;
  storeNameLastChecked.value = "";
}

async function checkStoreNameAvailability(rawName: string) {
  const trimmed = rawName.trim();
  if (!trimmed || !isSupabaseConfigured()) {
    resetStoreNameCheckState();
    return;
  }
  const seq = ++storeNameCheckSeq;
  storeNameChecking.value = true;
  storeNameCheckError.value = null;
  const { count, error } = await getSupabaseBrowser()
    .from("stores")
    .select("id", { head: true, count: "exact" })
    .ilike("name", trimmed);
  if (seq !== storeNameCheckSeq) return;
  storeNameChecking.value = false;
  storeNameLastChecked.value = trimmed;
  if (error) {
    storeNameCheckError.value = "Could not check name right now.";
    return;
  }
  storeNameExists.value = (count ?? 0) > 0;
}

function normalizeWizardStep() {
  if (wizardStep.value < 1) wizardStep.value = 1;
  if (wizardStep.value > wizardTotalSteps.value) {
    wizardStep.value = wizardTotalSteps.value;
  }
}

function validateWizardStep(step: number): boolean {
  if (step === 1) {
    if (!name.value.trim()) {
      toast.error("Store name is required.");
      return false;
    }
    if (!isResubmission.value) {
      if (!slug.value.trim()) {
        toast.error("URL slug is required.");
        return false;
      }
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.value.trim())) {
        toast.error(
          "Slug: lowercase letters, numbers, and single hyphens only.",
        );
        return false;
      }
    }
    if (storeNameChecking.value) {
      toast.info("Please wait while we confirm store name availability.");
      return false;
    }
    if (storeNameExists.value) {
      toast.error("Store name already exists. Please choose a different name.");
      return false;
    }
    return true;
  }
  if (step === 3 && requiresMandatoryVerification.value) {
    if (!profilePhotoFile.value) {
      toast.error("Upload your profile photo.");
      return false;
    }
    return true;
  }
  if (step === 4 && requiresMandatoryVerification.value) {
    if (!fullLegalName.value.trim()) {
      toast.error("Enter your full legal name.");
      return false;
    }
    if (!/^GHA-[0-9]{9}-[0-9]$/.test(ghanaCardNumber.value.trim())) {
      toast.error("Ghana Card must match GHA-XXXXXXXXX-X.");
      return false;
    }
    if (!cardFrontFile.value || !cardBackFile.value || !selfieFile.value) {
      toast.error("Upload card front, card back, and selfie holding card.");
      return false;
    }
    return true;
  }
  return true;
}

function goToNextWizardStep() {
  normalizeWizardStep();
  if (!validateWizardStep(wizardStep.value)) return;
  wizardStep.value = Math.min(wizardTotalSteps.value, wizardStep.value + 1);
}

function goToPrevWizardStep() {
  normalizeWizardStep();
  wizardStep.value = Math.max(1, wizardStep.value - 1);
}

const currentPlanName = computed(() => {
  const id = currentPlanId.value;
  if (!id) return "";
  return PRICING_PLANS.find((p) => p.id === id)?.name ?? id;
});

async function loadGate() {
  gateLoading.value = true;
  storeCount.value = 0;
  autoPlanSetError.value = null;
  if (!isSupabaseConfigured() || !auth.sessionUserId) {
    gateLoading.value = false;
    return;
  }
  await ensureDefaultFreePlan();
  const supabase = getSupabaseBrowser();
  const [profResult, verifResult] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "seller_verification_status, seller_verification_reject_reason, phone_e164",
      )
      .eq("id", auth.sessionUserId)
      .maybeSingle(),
    supabase
      .from("seller_verifications")
      .select("status, reject_reason")
      .eq("seller_id", auth.sessionUserId)
      .maybeSingle(),
  ]);
  const prof = profResult.data;
  const verif = verifResult.data;

  // seller_verifications is the authoritative source; fall back to profiles
  const resolvedStatus =
    (verif?.status as "pending" | "approved" | "rejected" | undefined) ??
    (prof?.seller_verification_status as
      | "not_submitted"
      | "pending"
      | "approved"
      | "rejected"
      | undefined) ??
    "not_submitted";
  profileVerificationStatus.value = resolvedStatus;

  profileVerificationRejectReason.value =
    (typeof verif?.reject_reason === "string" && verif.reject_reason.trim()
      ? verif.reject_reason.trim()
      : null) ??
    (typeof prof?.seller_verification_reject_reason === "string" &&
    prof.seller_verification_reject_reason.trim()
      ? prof.seller_verification_reject_reason.trim()
      : null);
  const [storeResult, verifDocsResult] = await Promise.all([
    supabase
      .from("stores")
      .select("id, name, slug, description, whatsapp_phone_e164", {
        count: "exact",
      })
      .eq("owner_id", auth.sessionUserId)
      .limit(1),
    supabase
      .from("seller_verifications")
      .select("full_legal_name, ghana_card_number")
      .eq("seller_id", auth.sessionUserId)
      .maybeSingle(),
  ]);
  if (storeResult.error) toast.error(storeResult.error.message);
  else {
    storeCount.value = storeResult.count ?? 0;
    const existingStore = storeResult.data?.[0];
    existingStoreId.value = (existingStore?.id as string | undefined) ?? null;
    // Pre-populate store fields so nothing is lost on resubmission
    if (existingStore) {
      name.value = (existingStore.name as string) ?? "";
      slug.value = (existingStore.slug as string) ?? "";
      description.value = (existingStore.description as string) ?? "";
      smsPhone.value =
        (existingStore.whatsapp_phone_e164 as string) ||
        (prof?.phone_e164 as string) ||
        "";
    }
  }
  // Pre-populate identity fields from the previous submission
  const existingVerif = verifDocsResult.data;
  if (existingVerif) {
    fullLegalName.value = (existingVerif.full_legal_name as string) ?? "";
    ghanaCardNumber.value = (existingVerif.ghana_card_number as string) ?? "";
  }
  // If resubmitting, skip straight to Step 4 (document uploads) —
  // store, contact info, and profile photo are already saved.
  if (
    profileVerificationStatus.value === "rejected" &&
    (storeCount.value ?? 0) > 0
  ) {
    wizardStep.value = 4;
  }
  gateLoading.value = false;
}

onMounted(() => {
  void loadGate();
});

watch(
  () => auth.sessionUserId,
  () => {
    void loadGate();
  },
);

watch(
  () => auth.user?.user_metadata?.signup_plan,
  () => {
    void loadGate();
  },
);
watch(
  () => name.value,
  (next) => {
    slugify();
    if (storeNameCheckTimer != null) {
      clearTimeout(storeNameCheckTimer);
      storeNameCheckTimer = null;
    }
    if (!next.trim()) {
      resetStoreNameCheckState();
      return;
    }
    storeNameCheckTimer = window.setTimeout(() => {
      void checkStoreNameAvailability(next);
    }, 350);
  },
);
watch(requiresMandatoryVerification, () => {
  normalizeWizardStep();
});

function slugify() {
  slug.value = name.value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function sanitizeSmsPhoneInput() {
  const raw = smsPhone.value;
  const hasLeadingPlus = raw.trim().startsWith("+");
  const digitsOnly = raw.replace(/\D/g, "");
  smsPhone.value = hasLeadingPlus ? `+${digitsOnly}` : digitsOnly;
}

async function ensureDefaultFreePlan() {
  if (!isSupabaseConfigured() || !auth.user) return;
  if (auth.isSuperAdmin) return;
  if (!sellerNeedsPlanPicker.value) return;
  if (planBusy.value) return;
  planBusy.value = true;
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.auth.updateUser({
    data: {
      ...auth.user.user_metadata,
      signup_plan: "free",
    },
  });
  planBusy.value = false;
  if (error) {
    autoPlanSetError.value = error.message;
    toast.error(error.message);
    return;
  }
  await auth.refreshSessionFromSupabase();
}

async function submit() {
  if (busy.value) return;
  if (!canUseCreateForm.value) {
    if (!auth.isSuperAdmin && !hasSelectedPlan.value) {
      toast.error("Select a subscription plan before creating a store.");
    } else if (atStoreLimit.value) {
      const cap =
        currentPlanId.value && MAX_STORES_BY_PLAN[currentPlanId.value] != null
          ? maxStoresDisplayText(currentPlanId.value)
          : "unlimited";
      toast.error(
        cap === "unlimited"
          ? `You cannot add another storefront right now.`
          : `Your ${currentPlanName.value} plan allows up to ${cap} shop${cap === "1" ? "" : "s"}. Upgrade to add more.`,
      );
    }
    return;
  }
  if (!isSupabaseConfigured() || !auth.sessionUserId) {
    toast.error("Sign in required.");
    return;
  }
  if (!isResubmission.value && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.value)) {
    toast.error("Slug: lowercase letters, numbers, and single hyphens only.");
    return;
  }
  busy.value = true;
  try {
    const supabase = getSupabaseBrowser();
    const resubmit = isResubmission.value;
    if (!resubmit) {
      if (storeNameChecking.value) {
        toast.info("Please wait while we confirm store name availability.");
        return;
      }
      if (storeNameExists.value) {
        toast.error(
          "Store name already exists. Please choose a different name.",
        );
        return;
      }
    }
    const trimmedSms = smsPhone.value.trim();
    const shouldCreatePending = requiresMandatoryVerification.value;
    if (shouldCreatePending) {
      if (!fullLegalName.value.trim()) {
        toast.error("Enter your full legal name.");
        return;
      }
      if (!/^GHA-[0-9]{9}-[0-9]$/.test(ghanaCardNumber.value.trim())) {
        toast.error("Ghana Card must match GHA-XXXXXXXXX-X.");
        return;
      }
      // Profile photo is optional on resubmission (already stored from first submission)
      if (!resubmit && !profilePhotoFile.value) {
        toast.error("Upload your profile photo.");
        return;
      }
      if (!cardFrontFile.value || !cardBackFile.value || !selfieFile.value) {
        toast.error("Upload card front, card back, and selfie holding card.");
        return;
      }
      if (verificationPending.value) {
        toast.info("Verification is already pending review.");
        return;
      }
    }
    let storeId: string;
    if (resubmit && existingStoreId.value) {
      // Resubmission: reuse the existing store and reset its verification status
      const { error: updateErr } = await supabase
        .from("stores")
        .update({
          verification_status: "pending",
          verification_reject_reason: null,
          verification_reviewed_at: null,
          verification_reviewed_by: null,
          is_active: false,
        })
        .eq("id", existingStoreId.value);
      if (updateErr) {
        toast.error(updateErr.message);
        return;
      }
      storeId = existingStoreId.value;
    } else {
      const { data, error } = await supabase
        .from("stores")
        .insert({
          owner_id: auth.sessionUserId,
          slug: slug.value.trim(),
          name: name.value.trim(),
          description: description.value.trim() || null,
          whatsapp_phone_e164: trimmedSms || null,
          is_active: !shouldCreatePending,
          verification_status: shouldCreatePending ? "pending" : "approved",
          verification_reject_reason: null,
          verification_reviewed_at: shouldCreatePending
            ? null
            : new Date().toISOString(),
          verification_reviewed_by: null,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") {
          toast.error(
            "Store name already exists. Please choose a different name.",
          );
        } else {
          toast.error(error.message);
        }
        return;
      }
      storeId = data.id as string;
    }
    // Alias for the rest of the function
    const data = { id: storeId };
    if (shouldCreatePending) {
      const uid = auth.sessionUserId;
      const frontPath = `${uid}/ghana-front.jpg`;
      const backPath = `${uid}/ghana-back.jpg`;
      const selfiePath = `${uid}/selfie-with-card.jpg`;

      // On resubmission, skip profile photo upload (already stored)
      const docUploads = await Promise.all([
        supabase.storage
          .from("seller-verification-docs")
          .upload(frontPath, cardFrontFile.value!, {
            upsert: true,
            contentType: "image/jpeg",
          }),
        supabase.storage
          .from("seller-verification-docs")
          .upload(backPath, cardBackFile.value!, {
            upsert: true,
            contentType: "image/jpeg",
          }),
        supabase.storage
          .from("seller-verification-docs")
          .upload(selfiePath, selfieFile.value!, {
            upsert: true,
            contentType: "image/jpeg",
          }),
      ]);

      let profilePath: string | undefined;
      if (!resubmit && profilePhotoFile.value) {
        profilePath = `${uid}/profile.${profilePhotoFile.value.type === "image/png" ? "png" : "jpg"}`;
        const { error: avatarErr } = await supabase.storage
          .from("profile-avatars")
          .upload(profilePath, profilePhotoFile.value, {
            upsert: true,
            contentType: profilePhotoFile.value.type || "image/jpeg",
          });
        if (avatarErr) {
          toast.error(avatarErr.message);
          return;
        }
      }

      const uploadErr = docUploads.find((r) => r.error)?.error;
      if (uploadErr) {
        toast.error(uploadErr.message);
        return;
      }
      const profileUpdate: Record<string, unknown> = {
        phone_e164: trimmedSms || null,
        seller_verification_status: "pending",
        seller_verification_reject_reason: null,
        seller_verification_reviewed_at: null,
        seller_verification_reviewed_by: null,
      };
      if (profilePath) profileUpdate.avatar_path = profilePath;
      const { error: profileErr } = await supabase
        .from("profiles")
        .update(profileUpdate)
        .eq("id", uid);
      if (profileErr) {
        toast.error(profileErr.message);
        return;
      }
      const { error: verErr } = await supabase
        .from("seller_verifications")
        .upsert(
          {
            seller_id: uid,
            store_id: data.id,
            status: "pending",
            contact_phone_e164: trimmedSms || null,
            full_legal_name: fullLegalName.value.trim(),
            ghana_card_number: ghanaCardNumber.value.trim(),
            card_front_path: frontPath,
            card_back_path: backPath,
            selfie_with_card_path: selfiePath,
            reject_reason: null,
            reviewed_at: null,
            reviewed_by: null,
            submitted_at: new Date().toISOString(),
          },
          { onConflict: "seller_id" },
        );
      if (verErr) {
        toast.error(verErr.message);
        return;
      }
    }
    const prep = await refreshSessionForEdgeFunctions(supabase);
    if (prep.ok) {
      auth.syncSession(prep.session);
      const { error: syncErr } = await supabase.functions.invoke(
        "sync-seller-subscription-for-store",
        {
          body: { store_id: data.id },
          headers: prep.headers,
        },
      );
      if (syncErr) {
        toast.error(
          formatFunctionsInvokeError(
            syncErr,
            "sync-seller-subscription-for-store",
          ) || "Store created, but subscription sync failed.",
        );
      }
    }
    ui.setCreateStoreModalForced(false);
    toast.success(
      shouldCreatePending
        ? "Store created and submitted for verification review."
        : "Store created.",
    );
    if (ui.createStoreModalOpen) {
      ui.closeCreateStoreModal();
    }
    if (shouldCreatePending) {
      await router.push({ name: "dashboard" });
    } else {
      await router.push(`/dashboard/stores/${data.id}`);
    }
  } finally {
    busy.value = false;
  }
}

defineExpose({ loadGate });
</script>

<template>
  <div
    class="rounded-3xl border border-white/60 bg-white/70 p-8 shadow-[0_28px_70px_-36px_rgba(15,23,42,0.18)] backdrop-blur-xl sm:p-10"
  >
    <component
      :is="headingLevel"
      class="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl"
    >
      Create store
    </component>
    <p class="mt-2 text-sm leading-relaxed text-zinc-600">
      Choose a name and URL slug. You can add products and publish when you are
      ready.
    </p>

    <Transition name="cstore-body" mode="out-in">
      <div v-if="gateLoading" key="gate" class="cstore-body">
        <SkeletonCreateStoreGate />
      </div>

      <div v-else key="ready" class="cstore-body">
        <div
          v-if="sellerNeedsPlanPicker"
          class="mt-8 rounded-2xl border border-amber-200/90 bg-amber-50/90 p-5 ring-1 ring-amber-200/50"
        >
          <h2 class="text-sm font-bold uppercase tracking-wide text-amber-950">
            Setting up your account
          </h2>
          <p class="mt-2 text-sm leading-relaxed text-amber-950/90">
            New sellers are automatically started on the Free tier. Finish
            creating your first store now, and upgrade with Paystack later when
            you are ready.
          </p>
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <span
              class="inline-flex items-center gap-2 rounded-full border border-amber-300/70 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950"
            >
              <span
                v-if="planBusy"
                class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-700/40 border-t-amber-700"
                aria-hidden="true"
              />
              <svg
                v-else
                class="h-4 w-4 text-emerald-700"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fill-rule="evenodd"
                  d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.414 0l-3.25-3.25a1 1 0 011.414-1.42l2.543 2.544 6.543-6.544a1 1 0 011.414 0z"
                  clip-rule="evenodd"
                />
              </svg>
              Free tier
            </span>
            <button
              v-if="autoPlanSetError"
              type="button"
              class="rounded-full border border-amber-300/80 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950 transition hover:bg-amber-50"
              @click="loadGate"
            >
              Retry setup
            </button>
          </div>
          <p v-if="autoPlanSetError" class="mt-3 text-xs text-red-700">
            {{ autoPlanSetError }}
          </p>
        </div>

        <div
          v-else-if="atStoreLimit"
          class="mt-8 rounded-2xl border border-red-200/90 bg-red-50/90 p-5 ring-1 ring-red-200/40"
        >
          <h2 class="text-sm font-bold uppercase tracking-wide text-red-950">
            Store limit reached
          </h2>
          <p class="mt-2 text-sm leading-relaxed text-red-950/90">
            <template v-if="unlimitedStores">
              You cannot add another storefront right now. If this looks wrong,
              contact support.
            </template>
            <template v-else>
              Your <strong>{{ currentPlanName }}</strong> plan allows up to
              <strong>{{ storeCapLabel }}</strong>
              shop{{ storeCapLabel === "1" ? "" : "s" }}. You can not add
              another storefront for all the Plans.
            </template>
          </p>
          <RouterLink
            :to="{ name: 'home', hash: '#pricing' }"
            class="mt-4 inline-flex rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-zinc-800"
          >
            View plans &amp; pricing
          </RouterLink>
        </div>

        <template v-else>
          <p
            v-if="auth.isSuperAdmin"
            class="mt-6 rounded-2xl border border-violet-200/80 bg-violet-50/80 px-4 py-3 text-sm text-violet-950 ring-1 ring-violet-200/40"
          >
            <span class="font-semibold">Super admin</span>
            <span class="text-violet-900/90">
              — you can add stores for testing or support without a seller
              subscription plan. Store caps do not apply to your account.
            </span>
          </p>
          <p
            v-else
            class="mt-6 rounded-2xl border border-teal-200/80 bg-teal-50/80 px-4 py-3 text-sm text-teal-950 ring-1 ring-teal-200/40"
          >
            <span class="font-semibold">Plan:</span>
            {{ currentPlanName }}
            <span class="text-teal-800/90">
              —
              <template v-if="unlimitedStores">
                <strong class="text-teal-950">Unlimited</strong> shops on this
                tier
              </template>
              <template v-else>
                up to
                <strong class="text-teal-950">{{ storeCapLabel }}</strong>
                shop{{ storeCapLabel === "1" ? "" : "s" }} on this tier
              </template>
              ({{ storeCount }} created).
            </span>
          </p>

          <form class="mt-8 space-y-5" @submit.prevent="submit">
            <div class="flex items-center justify-between gap-3">
              <p
                class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
              >
                Step {{ wizardStep }} of {{ wizardTotalSteps }}
              </p>
              <div class="h-2 w-44 overflow-hidden rounded-full bg-zinc-200/80">
                <div
                  class="h-full rounded-full bg-zinc-900 transition-all"
                  :style="{
                    width: `${(wizardStep / wizardTotalSteps) * 100}%`,
                  }"
                />
              </div>
            </div>

            <Transition name="wizard-slide" mode="out-in">
              <div :key="`wizard-step-${wizardStep}`" class="space-y-5">
                <template v-if="wizardStep === 1">
                  <div>
                    <label
                      class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
                      for="create-store-name"
                      >Store name *</label
                    >
                    <input
                      id="create-store-name"
                      v-model="name"
                      required
                      class="mt-1.5 w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-3 text-sm text-zinc-900 shadow-inner outline-none transition focus:border-teal-300 focus:ring-4 focus:ring-teal-500/15"
                    />
                    <p
                      v-if="storeNameAvailabilityLabel"
                      class="mt-1.5 text-xs"
                      :class="
                        storeNameCheckError
                          ? 'text-rose-700'
                          : storeNameChecking
                            ? 'text-zinc-500'
                            : storeNameExists
                              ? 'text-rose-700'
                              : 'text-emerald-700'
                      "
                    >
                      {{ storeNameAvailabilityLabel }}
                    </p>
                  </div>
                  <div>
                    <label
                      class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
                      for="create-store-slug"
                      >URL slug *</label
                    >
                    <input
                      id="create-store-slug"
                      v-model="slug"
                      required
                      readonly
                      aria-readonly="true"
                      class="mt-1.5 w-full cursor-not-allowed rounded-2xl border border-zinc-200/80 bg-zinc-100/90 px-4 py-3 font-mono text-sm text-zinc-700 shadow-inner outline-none"
                    />
                    <p class="mt-1.5 text-xs text-zinc-500">
                      Shop URL: /{{ slug || "…" }}
                    </p>
                  </div>
                  <div>
                    <label
                      class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
                      for="create-store-desc"
                      >Description</label
                    >
                    <textarea
                      id="create-store-desc"
                      v-model="description"
                      rows="3"
                      class="mt-1.5 w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-3 text-sm text-zinc-900 shadow-inner outline-none transition focus:border-teal-300 focus:ring-4 focus:ring-teal-500/15"
                    />
                  </div>
                </template>

                <div v-else-if="wizardStep === 2">
                  <label
                    class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
                    for="create-store-sms"
                    >SMS phone (E.164, e.g. +23320…)</label
                  >
                  <input
                    id="create-store-sms"
                    v-model="smsPhone"
                    type="tel"
                    inputmode="numeric"
                    autocomplete="tel"
                    @input="sanitizeSmsPhoneInput"
                    class="mt-1.5 w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-3 text-sm text-zinc-900 shadow-inner outline-none transition focus:border-teal-300 focus:ring-4 focus:ring-teal-500/15"
                  />
                </div>

                <div
                  v-else-if="wizardStep === 3 && requiresMandatoryVerification"
                >
                  <label
                    class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
                    >Profile photo *</label
                  >
                  <div
                    class="mt-1.5 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 p-4"
                  >
                    <input
                      ref="profilePhotoInput"
                      type="file"
                      accept="image/jpeg,image/jpg,image/png"
                      class="hidden"
                      @change="(e) => setImageFile(e, 'profile')"
                    />
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <p class="truncate text-sm font-semibold text-zinc-900">
                          {{
                            selectedFileName(
                              profilePhotoFile,
                              "No file selected",
                            )
                          }}
                        </p>
                        <p class="mt-1 text-xs text-zinc-500">
                          JPG, JPEG, or PNG. Clear profile photo for
                          verification.
                        </p>
                      </div>
                      <button
                        type="button"
                        class="inline-flex shrink-0 items-center rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-zinc-800"
                        @click="openUploadPicker('profile')"
                      >
                        Upload
                      </button>
                    </div>
                  </div>
                </div>

                <template
                  v-else-if="wizardStep === 4 && requiresMandatoryVerification"
                >
                  <div>
                    <label
                      class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
                      for="create-store-full-legal-name"
                      >Full legal name *</label
                    >
                    <input
                      id="create-store-full-legal-name"
                      v-model="fullLegalName"
                      required
                      class="mt-1.5 w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-3 text-sm text-zinc-900 shadow-inner outline-none transition focus:border-teal-300 focus:ring-4 focus:ring-teal-500/15"
                    />
                  </div>
                  <div>
                    <label
                      class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
                      for="create-store-ghana-card"
                      >Ghana card number *</label
                    >
                    <input
                      id="create-store-ghana-card"
                      v-model="ghanaCardNumber"
                      required
                      pattern="GHA-[0-9]{9}-[0-9]"
                      placeholder="GHA-123456789-1"
                      class="mt-1.5 w-full rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-3 font-mono text-sm text-zinc-900 shadow-inner outline-none transition focus:border-teal-300 focus:ring-4 focus:ring-teal-500/15"
                    />
                  </div>
                  <div>
                    <label
                      class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
                      >Ghana Card Front (JPG/JPEG) *</label
                    >
                    <div
                      class="mt-1.5 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 p-4"
                    >
                      <input
                        ref="cardFrontInput"
                        type="file"
                        accept="image/jpeg,image/jpg"
                        class="hidden"
                        @change="
                          (e) => setImageFile(e, 'front', { jpegOnly: true })
                        "
                      />
                      <div class="flex items-center justify-between gap-3">
                        <p
                          class="min-w-0 truncate text-sm font-semibold text-zinc-900"
                        >
                          {{
                            selectedFileName(cardFrontFile, "No file selected")
                          }}
                        </p>
                        <button
                          type="button"
                          class="inline-flex shrink-0 items-center rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-zinc-800"
                          @click="openUploadPicker('front')"
                        >
                          Upload
                        </button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label
                      class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
                      >Ghana Card Back (JPG/JPEG) *</label
                    >
                    <div
                      class="mt-1.5 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 p-4"
                    >
                      <input
                        ref="cardBackInput"
                        type="file"
                        accept="image/jpeg,image/jpg"
                        class="hidden"
                        @change="
                          (e) => setImageFile(e, 'back', { jpegOnly: true })
                        "
                      />
                      <div class="flex items-center justify-between gap-3">
                        <p
                          class="min-w-0 truncate text-sm font-semibold text-zinc-900"
                        >
                          {{
                            selectedFileName(cardBackFile, "No file selected")
                          }}
                        </p>
                        <button
                          type="button"
                          class="inline-flex shrink-0 items-center rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-zinc-800"
                          @click="openUploadPicker('back')"
                        >
                          Upload
                        </button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label
                      class="text-xs font-semibold uppercase tracking-wide text-zinc-500"
                      >Selfie holding card *</label
                    >
                    <div
                      class="mt-1.5 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 p-4"
                    >
                      <input
                        ref="selfieInput"
                        type="file"
                        accept="image/jpeg,image/jpg"
                        class="hidden"
                        @change="
                          (e) => setImageFile(e, 'selfie', { jpegOnly: true })
                        "
                      />
                      <div class="flex items-center justify-between gap-3">
                        <p
                          class="min-w-0 truncate text-sm font-semibold text-zinc-900"
                        >
                          {{ selectedFileName(selfieFile, "No file selected") }}
                        </p>
                        <button
                          type="button"
                          class="inline-flex shrink-0 items-center rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-zinc-800"
                          @click="openUploadPicker('selfie')"
                        >
                          Upload
                        </button>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </Transition>
            <div
              v-if="requiresMandatoryVerification"
              class="rounded-2xl border border-amber-200/90 bg-amber-50/80 p-4 ring-1 ring-amber-200/50"
            >
              <h3
                class="text-sm font-bold uppercase tracking-wide text-amber-950"
              >
                Mandatory seller verification
              </h3>
              <p class="mt-2 text-xs leading-relaxed text-amber-900/90">
                New seller accounts must complete identity verification before
                plan upgrade. Your store will be created as pending until
                approved by super admin.
              </p>
              <p
                v-if="
                  profileVerificationStatus === 'rejected' &&
                  profileVerificationRejectReason
                "
                class="mt-2 rounded-xl border border-rose-200/80 bg-rose-50 px-3 py-2 text-xs text-rose-800"
              >
                Rejected reason: {{ profileVerificationRejectReason }}
              </p>
              <p
                v-else-if="profileVerificationStatus === 'pending'"
                class="mt-2 rounded-xl border border-amber-300/80 bg-white px-3 py-2 text-xs text-amber-900"
              >
                Verification is pending review. You cannot resubmit until a
                decision is made.
              </p>
            </div>

            <div class="flex items-center gap-3">
              <button
                v-if="wizardStep > 1 && !isResubmission"
                type="button"
                class="rounded-full border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
                :disabled="busy"
                @click="goToPrevWizardStep"
              >
                Back
              </button>
              <button
                v-if="!isLastWizardStep"
                type="button"
                class="flex-1 rounded-full bg-zinc-900 py-3.5 text-sm font-semibold text-white shadow-lg shadow-zinc-900/25 transition hover:bg-zinc-800 disabled:opacity-50"
                :disabled="busy || !canSubmitWithVerification"
                @click="goToNextWizardStep"
              >
                Next
              </button>
              <button
                v-else
                type="submit"
                class="flex-1 rounded-full bg-zinc-900 py-3.5 text-sm font-semibold text-white shadow-lg shadow-zinc-900/25 transition hover:bg-zinc-800 disabled:opacity-50"
                :disabled="busy || !canSubmitWithVerification"
              >
                {{
                  busy
                    ? "Saving…"
                    : isResubmission
                      ? "Re-Submit"
                      : "Create store"
                }}
              </button>
            </div>
          </form>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.cstore-body-enter-from,
.cstore-body-leave-to {
  opacity: 0;
  transform: translate3d(0, 0.5rem, 0);
}

.cstore-body-enter-active,
.cstore-body-leave-active {
  transition:
    opacity 0.32s ease,
    transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
}

.wizard-slide-enter-active,
.wizard-slide-leave-active {
  transition:
    opacity 0.24s ease,
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.wizard-slide-enter-from,
.wizard-slide-leave-to {
  opacity: 0;
  transform: translate3d(0.65rem, 0, 0);
}

@media (prefers-reduced-motion: reduce) {
  .cstore-body,
  .cstore-body-enter-active,
  .cstore-body-leave-active,
  .wizard-slide-enter-active,
  .wizard-slide-leave-active {
    transition-duration: 0.01ms !important;
  }

  .cstore-body-enter-from,
  .cstore-body-leave-to,
  .wizard-slide-enter-from,
  .wizard-slide-leave-to {
    transform: none;
  }
}
</style>
