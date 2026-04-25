import type { Session } from "@supabase/supabase-js";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getSupabaseBrowser, isSupabaseConfigured } from "../lib/supabase";
import { userDisplayName } from "../lib/userDisplayName";
import { useUiStore } from "./ui";

export type PlatformAdminRole = "none" | "admin" | "super_admin";

/** Set from the login page before Google OAuth so we can attach `signup_plan` after redirect. */
export const AUTH_PENDING_SIGNUP_PLAN_KEY = "uanditech_pending_signup_plan";

/** Optional full name typed on the sign-up screen before Google OAuth. */
export const AUTH_PENDING_SIGNUP_FULL_NAME_KEY =
  "uanditech_pending_signup_full_name";

/** Set before OAuth so callback can complete post-login routing from any return path. */
export const AUTH_OAUTH_REDIRECT_PENDING_KEY =
  "uanditech_oauth_redirect_pending";

/** Set while on `/console-access-pending`; cleared when staff is granted or session ends. */
export const AUTH_SESSION_CONSOLE_ACCESS_PENDING_KEY =
  "uanditech_session_console_access_pending";

/**
 * Written to `profiles.last_seen_at` on sign-out so other clients treat the user
 * as offline immediately (not until the “fresh within 2 min” window expires).
 */
export const PROFILE_LAST_SEEN_OFFLINE_ISO = "1970-01-01T00:00:00.000Z";

const SIGNUP_PLAN_IDS = new Set(["free", "starter", "growth", "pro"]);

export const useAuthStore = defineStore("auth", () => {
  const session = ref<Session | null>(null);
  /** Bumps on sign-out and on each role refresh start so stale async results are ignored. */
  const adminRoleRefreshGen = ref(0);
  /** Row in `admin_roles` for this user, if any (one row per user). */
  const platformAdminRole = ref<PlatformAdminRole>("none");
  /**
   * False from first attach of a new session until `refreshSuperAdminRole`
   * settles, so UI does not briefly assume `platformAdminRole === "none"`.
   */
  const platformStaffRoleResolved = ref(false);
  /**
   * After a new session, the first successful role read must not fire the
   * "console access granted" seller bell (user may already have been staff).
   */
  const suppressNextConsoleAccessBell = ref(false);
  /** Public URL for `profiles.avatar_path` in `profile-avatars` bucket. */
  const profileAvatarPublicUrl = ref<string | null>(null);
  /**
   * Set to true just before a deliberate sign-out so the auth-sync listener
   * can tell the difference between a manual sign-out and a token expiry.
   */
  const isManualSignOut = ref(false);

  const user = computed(() => session.value?.user ?? null);
  const sessionUserId = computed(() => user.value?.id ?? null);
  const isSignedIn = computed(() => user.value !== null);
  const passwordUserNeedsEmailVerification = computed(() => {
    const u = user.value;
    if (!u) return false;
    const provider =
      typeof (u.app_metadata as { provider?: unknown } | null)?.provider ===
      "string"
        ? String((u.app_metadata as { provider?: unknown }).provider)
        : "";
    const hasEmailIdentity =
      provider === "email" ||
      (Array.isArray(u.identities) &&
        u.identities.some(
          (identity) =>
            typeof identity?.provider === "string" &&
            identity.provider === "email",
        ));
    const emailConfirmed =
      typeof u.email_confirmed_at === "string" &&
      u.email_confirmed_at.trim().length > 0;
    return hasEmailIdentity && !emailConfirmed;
  });

  const isSuperAdmin = computed(
    () => platformAdminRole.value === "super_admin",
  );
  const isPlatformStaff = computed(() => platformAdminRole.value !== "none");
  const platformAdminRoleLabel = computed(() => {
    switch (platformAdminRole.value) {
      case "super_admin":
        return "Super admin";
      case "admin":
        return "Admin";
      default:
        return "";
    }
  });

  const userDisplayInitial = computed(() => {
    const n = userDisplayName(user.value).trim();
    if (!n || n === "there") return "?";
    return n[0]!.toUpperCase();
  });

  function applyProfileAvatarFromPath(path: string | null) {
    if (!path || !isSupabaseConfigured()) {
      profileAvatarPublicUrl.value = null;
      return;
    }
    const { data } = getSupabaseBrowser()
      .storage.from("profile-avatars")
      .getPublicUrl(path);
    profileAvatarPublicUrl.value = data.publicUrl;
  }

  async function refreshProfileAvatar() {
    profileAvatarPublicUrl.value = null;
    if (!isSupabaseConfigured() || !session.value?.user?.id) return;
    const { data, error } = await getSupabaseBrowser()
      .from("profiles")
      .select("avatar_path")
      .eq("id", session.value.user.id)
      .maybeSingle();
    if (error) return;
    const row = data as { avatar_path?: string | null } | null;
    applyProfileAvatarFromPath(row?.avatar_path?.trim() || null);
  }

  function clearProfileAvatarPreview() {
    profileAvatarPublicUrl.value = null;
  }

  /** Reads `public.admin_roles` for the signed-in user. Rows are not created on sign-up from the app. */
  async function refreshSuperAdminRole() {
    if (!isSupabaseConfigured() || !session.value?.user?.id) {
      platformAdminRole.value = "none";
      platformStaffRoleResolved.value = true;
      return;
    }
    const uid = session.value.user.id;
    const previousRole = platformAdminRole.value;
    const myGen = ++adminRoleRefreshGen.value;
    try {
      const { data } = await getSupabaseBrowser()
        .from("admin_roles")
        .select("role")
        .eq("user_id", uid)
        .maybeSingle();
      if (myGen !== adminRoleRefreshGen.value) return;
      if (!session.value?.user?.id || session.value.user.id !== uid) return;

      const r =
        data && typeof (data as { role?: unknown }).role === "string"
          ? (data as { role: string }).role
          : null;
      let nextRole: PlatformAdminRole = "none";
      if (r === "super_admin") nextRole = "super_admin";
      else if (r === "admin") nextRole = "admin";
      platformAdminRole.value = nextRole;
    } catch {
      if (myGen !== adminRoleRefreshGen.value) return;
      if (!session.value?.user?.id || session.value.user.id !== uid) return;
      platformAdminRole.value = "none";
    } finally {
      if (myGen !== adminRoleRefreshGen.value) return;
      if (!session.value?.user?.id || session.value.user.id !== uid) return;
      platformStaffRoleResolved.value = true;
    }

    const gainedConsoleAccess =
      previousRole === "none" && platformAdminRole.value !== "none";
    if (gainedConsoleAccess && !suppressNextConsoleAccessBell.value) {
      useUiStore().setSellerConsoleAccessReadyBellCount(1);
    }
    suppressNextConsoleAccessBell.value = false;

    if (platformAdminRole.value !== "none") {
      try {
        sessionStorage.removeItem(AUTH_SESSION_CONSOLE_ACCESS_PENDING_KEY);
      } catch {
        /* private mode */
      }
    }
  }

  function syncSession(next: Session | null) {
    const prevSession = session.value;
    session.value = next;
    if (!next) {
      adminRoleRefreshGen.value++;
      platformAdminRole.value = "none";
      platformStaffRoleResolved.value = true;
      profileAvatarPublicUrl.value = null;
      suppressNextConsoleAccessBell.value = false;
      const uid = prevSession?.user?.id ?? null;
      if (uid && isSupabaseConfigured()) {
        void getSupabaseBrowser()
          .from("profiles")
          .update({ last_seen_at: PROFILE_LAST_SEEN_OFFLINE_ISO })
          .eq("id", uid);
      }
      try {
        sessionStorage.removeItem(AUTH_SESSION_CONSOLE_ACCESS_PENDING_KEY);
      } catch {
        /* private mode */
      }
      try {
        useUiStore().clearSellerConsoleAccessReadyBell();
      } catch {
        /* Pinia may not be ready in edge tests */
      }
      return;
    }
    const sameUser =
      prevSession?.user?.id != null && prevSession.user.id === next.user.id;
    if (!sameUser) {
      platformStaffRoleResolved.value = false;
    }
    suppressNextConsoleAccessBell.value = true;
    try {
      useUiStore().clearSellerConsoleAccessReadyBell();
    } catch {
      /* Pinia may not be ready in edge tests */
    }
    void refreshSuperAdminRole();
    void refreshProfileAvatar();
  }

  async function refreshSessionFromSupabase() {
    if (!isSupabaseConfigured()) return;
    const { data } = await getSupabaseBrowser().auth.getSession();
    syncSession(data.session);
  }

  async function signInWithEmail(email: string, password: string) {
    if (!isSupabaseConfigured()) {
      throw new Error("Supabase is not configured");
    }
    const { error } = await getSupabaseBrowser().auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  }

  async function signUpWithEmail(
    email: string,
    password: string,
    signupPlan: string,
    fullName?: string,
  ) {
    if (!isSupabaseConfigured()) {
      throw new Error("Supabase is not configured");
    }
    const plan = SIGNUP_PLAN_IDS.has(signupPlan) ? signupPlan : "free";
    const trimmedName = fullName?.trim() ?? "";
    const data: Record<string, string> = { signup_plan: plan };
    if (trimmedName.length >= 2) {
      data.full_name = trimmedName.replace(/\s+/g, " ");
    }
    const { error } = await getSupabaseBrowser().auth.signUp({
      email,
      password,
      options: {
        data,
      },
    });
    if (error) throw error;
  }

  /**
   * After Google OAuth, copy sign-up choices from sessionStorage into
   * `user_metadata` (only fills keys that are still missing).
   */
  /**
   * Notifies super admins (SMS) once per seller profile when a non-staff user
   * establishes a session. Idempotent via `profiles.seller_join_sms_sent_at`.
   */
  async function notifySuperAdminNewSellerJoinIfNeeded() {
    if (!isSupabaseConfigured()) return;
    const sb = getSupabaseBrowser();
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session?.access_token) return;
    try {
      const { error } = await sb.functions.invoke(
        "notify-super-admin-new-seller",
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (error) {
        console.warn("[notify-super-admin-new-seller]", error.message);
      }
    } catch (e) {
      console.warn("[notify-super-admin-new-seller]", e);
    }
  }

  async function flushPendingSignupPlanToMetadata() {
    if (!isSupabaseConfigured()) return;
    const planRaw = sessionStorage.getItem(AUTH_PENDING_SIGNUP_PLAN_KEY);
    const nameRaw =
      sessionStorage.getItem(AUTH_PENDING_SIGNUP_FULL_NAME_KEY)?.trim() ?? "";

    const pendingPlan =
      planRaw && SIGNUP_PLAN_IDS.has(planRaw) ? planRaw : null;
    const pendingName =
      nameRaw.length >= 2 ? nameRaw.replace(/\s+/g, " ") : null;

    if (!pendingPlan && !pendingName) return;

    const supabase = getSupabaseBrowser();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const meta: Record<string, unknown> = { ...user.user_metadata };
    let changed = false;

    if (pendingPlan && !meta.signup_plan) {
      meta.signup_plan = pendingPlan;
      changed = true;
    }
    const existingFull =
      typeof meta.full_name === "string" ? meta.full_name.trim() : "";
    if (pendingName && !existingFull) {
      meta.full_name = pendingName;
      changed = true;
    }

    if (!changed) {
      if (pendingPlan && meta.signup_plan)
        sessionStorage.removeItem(AUTH_PENDING_SIGNUP_PLAN_KEY);
      if (pendingName && existingFull)
        sessionStorage.removeItem(AUTH_PENDING_SIGNUP_FULL_NAME_KEY);
      return;
    }

    const { error } = await supabase.auth.updateUser({
      data: meta as Record<string, string>,
    });
    if (!error) {
      if (pendingPlan) sessionStorage.removeItem(AUTH_PENDING_SIGNUP_PLAN_KEY);
      if (pendingName)
        sessionStorage.removeItem(AUTH_PENDING_SIGNUP_FULL_NAME_KEY);
    }
  }

  async function signInWithGoogle() {
    if (!isSupabaseConfigured()) {
      throw new Error("Supabase is not configured");
    }
    const originWithBase =
      `${window.location.origin}${import.meta.env.BASE_URL}`.replace(
        /\/+$/,
        "",
      );
    // Land on `/login` so LoginView can send super admins to `/admin` (OAuth PKCE).
    const redirectTo = `${originWithBase}/login`;
    const { error } = await getSupabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) throw error;
  }

  async function signOut() {
    isManualSignOut.value = true;
    const uid = session.value?.user?.id ?? null;
    if (!isSupabaseConfigured()) {
      syncSession(null);
      platformAdminRole.value = "none";
      isManualSignOut.value = false;
      return;
    }
    if (uid) {
      try {
        await getSupabaseBrowser()
          .from("profiles")
          .update({ last_seen_at: PROFILE_LAST_SEEN_OFFLINE_ISO })
          .eq("id", uid);
      } catch {
        /* still sign out if heartbeat row cannot be cleared */
      }
    }
    const { error } = await getSupabaseBrowser().auth.signOut();
    if (error) {
      isManualSignOut.value = false;
      throw error;
    }
    platformAdminRole.value = "none";
    // Clear Pinia immediately; onAuthStateChange can lag, which left the UI "signed in"
    // until a full page reload.
    syncSession(null);
    isManualSignOut.value = false;
  }

  return {
    session,
    user,
    sessionUserId,
    isSignedIn,
    passwordUserNeedsEmailVerification,
    platformAdminRole,
    platformStaffRoleResolved,
    isSuperAdmin,
    isPlatformStaff,
    platformAdminRoleLabel,
    profileAvatarPublicUrl,
    userDisplayInitial,
    refreshProfileAvatar,
    applyProfileAvatarFromPath,
    clearProfileAvatarPreview,
    refreshSuperAdminRole,
    syncSession,
    refreshSessionFromSupabase,
    signInWithEmail,
    signUpWithEmail,
    flushPendingSignupPlanToMetadata,
    notifySuperAdminNewSellerJoinIfNeeded,
    signInWithGoogle,
    signOut,
    isManualSignOut,
  };
});
