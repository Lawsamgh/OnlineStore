<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  watch,
} from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { storeToRefs } from "pinia";
import { useAuthStore } from "../../stores/auth";
import { useCartStore } from "../../stores/cart";
import { useUiStore } from "../../stores/ui";
import CreateStoreModal from "../../components/dashboard/CreateStoreModal.vue";
import { PRICING_PLANS } from "../../constants/pricingPlans";
import { copyTextToClipboard } from "../../lib/copyToClipboard";
import { userDisplayName } from "../../lib/userDisplayName";
import { getSupabaseBrowser, isSupabaseConfigured } from "../../lib/supabase";
import { platformConsolePresenceOnlineKey } from "../../lib/consolePresenceInjection";
import { usePlatformConsolePresence } from "../../composables/usePlatformConsolePresence";
import { useProfileLastSeenHeartbeat } from "../../composables/useProfileLastSeenHeartbeat";
import { useRealtimeTableRefresh } from "../../composables/useRealtimeTableRefresh";
import { useToastStore } from "../../stores/toast";
import { AUTH_SESSION_CONSOLE_ACCESS_PENDING_KEY } from "../../stores/auth";

const route = useRoute();
const router = useRouter();
/** Footer copyright year (set once per layout load). */
const dashboardFooterYear = new Date().getFullYear();
const auth = useAuthStore();
const { sessionUserId: authSessionUserId } = storeToRefs(auth);
const cart = useCartStore();
const ui = useUiStore();
const {
  adminPendingConsoleGrantCount,
  adminOpenTicketCount,
  sellerConsoleAccessReadyBellCount,
  sellerNewOrderBellCount,
  sellerPlatformAnnouncementBellCount,
  sellerPlatformAnnouncementsPreview,
} = storeToRefs(ui);
const toast = useToastStore();

const comingSoonModalOpen = ref(false);

function openComingSoonModal() {
  comingSoonModalOpen.value = true;
  document.body.style.overflow = "hidden";
}

function closeComingSoonModal() {
  comingSoonModalOpen.value = false;
  document.body.style.overflow = "";
}

/** Must be declared before any watch() that references `adminAccessBlocked` (avoid TDZ). */
const isAdminShell = computed(() => route.path.startsWith("/admin"));

const { onlineUserIds: platformConsolePresenceOnlineUserIds } =
  usePlatformConsolePresence({
    /** Staff on Seller hub or Console both use this layout — count either as “live”. */
    enabled: () => auth.isSignedIn && auth.isPlatformStaff,
    userId: () => authSessionUserId.value,
  });
provide(platformConsolePresenceOnlineKey, platformConsolePresenceOnlineUserIds);

useProfileLastSeenHeartbeat({
  enabled: () => auth.isSignedIn && auth.isPlatformStaff,
  userId: () => authSessionUserId.value,
});

onBeforeUnmount(() => {
  document.body.style.overflow = "";
});

/** Signed-in user opened /admin, role is resolved, but account is not super-admin. */
const adminAccessBlocked = computed(
  () =>
    isAdminShell.value &&
    auth.isSignedIn &&
    auth.platformStaffRoleResolved &&
    !auth.isSuperAdmin,
);
watch(
  adminAccessBlocked,
  (blocked) => {
    if (!blocked || !isAdminShell.value) return;
    void router.replace({ name: "dashboard" });
  },
  { immediate: true },
);

/** Desktop header: show pending notice only when role is resolved and still not set. */
const consoleAccessPendingNotice = ref(false);
const sellerOwnedStoreIds = ref(new Set<string>());
onMounted(() => {
  try {
    consoleAccessPendingNotice.value =
      sessionStorage.getItem(AUTH_SESSION_CONSOLE_ACCESS_PENDING_KEY) === "1";
  } catch {
    consoleAccessPendingNotice.value = false;
  }
});
const sellerOwnershipResolved = ref(false);
const suppressDefaultGreetingUntilOwnershipResolved = computed(() => {
  if (isAdminShell.value || !auth.isSignedIn) return false;
  if (!auth.platformStaffRoleResolved) {
    if (!sellerOwnershipResolved.value) return true;
    return sellerOwnedStoreIds.value.size > 0;
  }
  if (auth.platformAdminRole !== "none") return false;
  if (consoleAccessPendingNotice.value) return false;
  return !sellerOwnershipResolved.value;
});
const adminShellStaffForTickets = computed(
  () => isAdminShell.value && auth.isPlatformStaff,
);

const adminBellGrantCount = computed(() =>
  auth.isSuperAdmin ? adminPendingConsoleGrantCount.value : 0,
);

/** Open tickets + pending console grants (super-admin only) for the admin bell badge. */
const adminBellCombinedCount = computed(() => {
  if (!adminShellStaffForTickets.value) return 0;
  return adminOpenTicketCount.value + adminBellGrantCount.value;
});

const adminBellBadgeRose = computed(
  () =>
    adminShellStaffForTickets.value &&
    auth.isSuperAdmin &&
    adminPendingConsoleGrantCount.value > 0,
);

/** Seller hub: cart + optional "console access granted" bell badge. */
const sellerHubBellCombinedCount = computed(
  () =>
    sellerConsoleAccessReadyBellCount.value +
    cart.itemCount +
    sellerNewOrderBellCount.value +
    sellerPlatformAnnouncementBellCount.value,
);

/** Bell badge color priority: console (emerald) → orders (amber) → platform news (indigo) → cart (violet). */
const sellerHubBellBadgeTone = computed(() => {
  if (sellerConsoleAccessReadyBellCount.value > 0) return "emerald" as const;
  if (sellerNewOrderBellCount.value > 0) return "amber" as const;
  if (sellerPlatformAnnouncementBellCount.value > 0) return "indigo" as const;
  return "violet" as const;
});
const activeBellCount = computed(() =>
  isAdminShell.value
    ? adminBellCombinedCount.value
    : sellerHubBellCombinedCount.value,
);
const bellSoundPrimed = ref(false);
const bellSoundSeenFirstCount = ref(false);
const bellAudioContextRef = ref<AudioContext | null>(null);

function primeBellSound() {
  if (bellSoundPrimed.value) return;
  bellSoundPrimed.value = true;
  document.removeEventListener("pointerdown", primeBellSound, true);
  document.removeEventListener("keydown", primeBellSound, true);
}

function playBellNotificationSound() {
  if (!bellSoundPrimed.value) return;
  if (typeof window === "undefined" || document.hidden) return;
  const Ctx = window.AudioContext;
  if (!Ctx) return;
  if (!bellAudioContextRef.value) bellAudioContextRef.value = new Ctx();
  const ctx = bellAudioContextRef.value;
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(1046, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.075, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.24);
}

watch(
  activeBellCount,
  (next, prev) => {
    if (!bellSoundSeenFirstCount.value) {
      bellSoundSeenFirstCount.value = true;
      return;
    }
    if ((next ?? 0) > (prev ?? 0)) {
      playBellNotificationSound();
    }
  },
  { immediate: true },
);

const adminBellAriaLabel = computed(() => {
  if (!isAdminShell.value || !auth.isPlatformStaff) {
    if (!isAdminShell.value) {
      const bits: string[] = [];
      if (sellerConsoleAccessReadyBellCount.value > 0) {
        bits.push("platform console access ready");
      }
      if (sellerNewOrderBellCount.value > 0) {
        bits.push(
          `${sellerNewOrderBellCount.value} active order${sellerNewOrderBellCount.value === 1 ? "" : "s"}`,
        );
      }
      if (sellerPlatformAnnouncementBellCount.value > 0) {
        bits.push(
          `${sellerPlatformAnnouncementBellCount.value} unread platform update${sellerPlatformAnnouncementBellCount.value === 1 ? "" : "s"}`,
        );
      }
      if (cart.itemCount > 0) {
        bits.push(`${cart.itemCount} in cart`);
      }
      if (bits.length > 0) {
        return `Notifications, ${bits.join(", ")}`;
      }
    }
    return "Notifications";
  }
  const parts: string[] = [];
  if (auth.isSuperAdmin && adminPendingConsoleGrantCount.value > 0) {
    parts.push(`${adminPendingConsoleGrantCount.value} need console access`);
  }
  if (adminOpenTicketCount.value > 0) {
    parts.push(`${adminOpenTicketCount.value} open tickets`);
  }
  if (parts.length === 0) return "Notifications";
  return `Notifications, ${parts.join(", ")}`;
});

watch(
  adminShellStaffForTickets,
  (on) => {
    if (on) {
      void ui.refreshAdminOpenTicketCount();
      if (auth.isSuperAdmin) void ui.refreshAdminPendingConsoleGrantCount();
    } else ui.setAdminOpenTicketCount(0);
  },
  { immediate: true },
);

useRealtimeTableRefresh({
  channelName: "layout-admin-open-tickets",
  deps: adminShellStaffForTickets,
  getTables: () =>
    adminShellStaffForTickets.value ? [{ table: "support_tickets" }] : [],
  onEvent: () => {
    void ui.refreshAdminOpenTicketCount();
  },
});

useRealtimeTableRefresh({
  channelName: "layout-admin-pending-console-grants",
  deps: adminShellStaffForTickets,
  debounceMs: 250,
  getTables: () =>
    adminShellStaffForTickets.value && auth.isSuperAdmin
      ? [{ table: "profiles" }, { table: "admin_roles" }, { table: "stores" }]
      : [],
  onEvent: () => {
    if (!auth.isSuperAdmin) return;
    void ui.refreshAdminPendingConsoleGrantCount();
  },
});

let sellerOrderBellChannel: RealtimeChannel | null = null;

/** order_status values that still need seller attention (not delivered / canceled). */
const SELLER_BELL_OPEN_ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "out_for_delivery",
] as const;

function teardownSellerOrderBellChannel() {
  if (sellerOrderBellChannel && isSupabaseConfigured()) {
    void getSupabaseBrowser().removeChannel(sellerOrderBellChannel);
  }
  sellerOrderBellChannel = null;
}

async function refreshSellerOwnedStoreIds(ownerId: string) {
  if (!isSupabaseConfigured()) return;
  const { data, error } = await getSupabaseBrowser()
    .from("stores")
    .select("id")
    .eq("owner_id", ownerId);
  if (error) return;
  sellerOwnedStoreIds.value = new Set(
    (data ?? []).map((r) => r.id as string).filter(Boolean),
  );
}

async function refreshSellerOrderBellCount() {
  if (!isSupabaseConfigured()) return;
  const ids = [...sellerOwnedStoreIds.value];
  if (ids.length === 0) {
    ui.setSellerNewOrderBellCount(0);
    return;
  }
  const { count, error } = await getSupabaseBrowser()
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("store_id", ids)
    .in("status", [...SELLER_BELL_OPEN_ORDER_STATUSES]);
  if (error) return;
  ui.setSellerNewOrderBellCount(count ?? 0);
}

watch(
  () =>
    ({
      admin: isAdminShell.value,
      signed: auth.isSignedIn,
      uid: authSessionUserId.value,
    }) as const,
  async ({ admin, signed, uid }) => {
    teardownSellerOrderBellChannel();
    sellerOwnedStoreIds.value = new Set();
    sellerOwnershipResolved.value = false;
    if (admin || !signed || !uid || !isSupabaseConfigured()) {
      ui.clearSellerNewOrderBellCount();
      sellerOwnershipResolved.value = true;
      return;
    }

    await refreshSellerOwnedStoreIds(uid);
    sellerOwnershipResolved.value = true;
    await refreshSellerOrderBellCount();
    const sb = getSupabaseBrowser();
    const ch = sb
      .channel(`layout-seller-order-bell:${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => {
          void refreshSellerOrderBellCount();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "stores",
          filter: `owner_id=eq.${uid}`,
        },
        async () => {
          await refreshSellerOwnedStoreIds(uid);
          await refreshSellerOrderBellCount();
        },
      );
    void ch.subscribe();
    sellerOrderBellChannel = ch;
  },
  { immediate: true },
);

const avatarFileInput = ref<HTMLInputElement | null>(null);

function openAvatarPicker() {
  avatarFileInput.value?.click();
}

function onHeaderAvatarImageError() {
  auth.clearProfileAvatarPreview();
}

async function onAvatarFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !auth.user?.id || !isSupabaseConfigured()) return;
  if (!file.type.startsWith("image/")) {
    toast.error("Please choose an image file.");
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    toast.error("Image must be 2 MB or smaller.");
    return;
  }
  const uid = auth.user.id;
  const extFromMime =
    file.type === "image/png"
      ? "png"
      : file.type === "image/webp"
        ? "webp"
        : file.type === "image/gif"
          ? "gif"
          : "jpg";
  const path = `${uid}/avatar.${extFromMime}`;
  const sb = getSupabaseBrowser();
  const { error: upErr } = await sb.storage
    .from("profile-avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) {
    toast.error(upErr.message);
    return;
  }
  const { error: dbErr } = await sb
    .from("profiles")
    .update({ avatar_path: path })
    .eq("id", uid);
  if (dbErr) {
    toast.error(dbErr.message);
    return;
  }
  auth.applyProfileAvatarFromPath(path);
  toast.success("Profile photo updated.");
}
const accountMenuOpen = ref(false);
const accountMenuRoot = ref<HTMLElement | null>(null);
const accountMenuPanel = ref<HTMLElement | null>(null);
const accountMenuFixedStyle = ref<Record<string, string>>({});

function closeAccountMenu() {
  accountMenuOpen.value = false;
}

const notificationsOpen = ref(false);
const notificationsBellRoot = ref<HTMLElement | null>(null);
const notificationsPanelRef = ref<HTMLElement | null>(null);
const notificationsPanelStyle = ref<Record<string, string>>({});

function closeNotificationsPanel() {
  notificationsOpen.value = false;
}

function toggleNotificationsPanel() {
  notificationsOpen.value = !notificationsOpen.value;
  if (notificationsOpen.value) {
    closeAccountMenu();
    if (!isAdminShell.value && authSessionUserId.value) {
      void refreshSellerOrderBellCount();
      if (sellerPlatformAnnouncementBellCount.value > 0) {
        ui.markSellerPlatformAnnouncementsRead(authSessionUserId.value);
      }
    }
    void nextTick(() => layoutNotificationsPanel());
  }
}

function layoutNotificationsPanel() {
  const root = notificationsBellRoot.value;
  const panel = notificationsPanelRef.value;
  if (!root || !panel) return;
  const trigger = root.querySelector("button");
  if (!(trigger instanceof HTMLElement)) return;
  const r = trigger.getBoundingClientRect();
  const pad = 8;
  const vw = window.innerWidth;
  const panelW = Math.min(520, Math.max(360, vw - 28));
  let right = vw - r.right;
  right = Math.min(right, vw - panelW - 8);
  right = Math.max(8, right);
  notificationsPanelStyle.value = {
    position: "fixed",
    top: `${r.bottom + pad}px`,
    right: `${right}px`,
    width: `${panelW}px`,
    zIndex: "255",
  };
}

function goToGrantAccessFromNotifications() {
  closeNotificationsPanel();
  void router.push({ name: "admin", hash: "#grant-access" });
}

function goToTicketsFromNotifications() {
  closeNotificationsPanel();
  void router.push({ name: "admin-tickets" });
}

function openCartFromNotifications() {
  closeNotificationsPanel();
  ui.openCart();
}

function scrollSellerCustomerOrdersIntoView() {
  const el = document.getElementById("seller-customer-orders");
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function goToSellerCustomerOrdersFromNotifications() {
  if (!canOpenSellerOrdersFromNotifications.value) return;
  closeNotificationsPanel();
  const firstOwnedStoreId = [...sellerOwnedStoreIds.value][0] ?? null;
  if (firstOwnedStoreId) {
    await router.push({
      name: "dashboard-store",
      params: { storeId: firstOwnedStoreId },
      query: { tab: "orders" },
    });
    return;
  }
  if (route.name !== "dashboard") {
    await router.push({ name: "dashboard", hash: "#seller-customer-orders" });
    await nextTick();
    scrollSellerCustomerOrdersIntoView();
    return;
  }
  if (route.hash !== "#seller-customer-orders") {
    await router.push({ name: "dashboard", hash: "#seller-customer-orders" });
  }
  await nextTick();
  scrollSellerCustomerOrdersIntoView();
}

function dismissSellerNewOrderBellFromNotifications() {
  closeNotificationsPanel();
}

function openPlatformConsoleFromSellerNotification() {
  ui.clearSellerConsoleAccessReadyBell();
  closeNotificationsPanel();
  void router.push({ name: "admin" });
}

function toggleAccountMenu() {
  closeNotificationsPanel();
  accountMenuOpen.value = !accountMenuOpen.value;
  if (accountMenuOpen.value) {
    void nextTick(() => layoutAccountMenuPanel());
  }
}

async function copyAccountEmail() {
  const e = auth.user?.email;
  if (!e) return;
  const ok = await copyTextToClipboard(e);
  if (ok) toast.success("Email copied to clipboard.");
  else toast.error("Unable to copy. Select the email and copy manually.");
}

function layoutAccountMenuPanel() {
  const root = accountMenuRoot.value;
  const panel = accountMenuPanel.value;
  if (!root || !panel) return;
  const trigger = root.querySelector("button");
  if (!(trigger instanceof HTMLElement)) return;
  const r = trigger.getBoundingClientRect();
  const pad = 8;
  const vw = window.innerWidth;
  const panelW = Math.min(380, Math.max(300, vw - 20));
  /** Align panel right edge to trigger; clamp so the card stays inside the viewport. */
  let right = vw - r.right;
  right = Math.min(right, vw - panelW - 8);
  right = Math.max(8, right);
  accountMenuFixedStyle.value = {
    position: "fixed",
    top: `${r.bottom + pad}px`,
    right: `${right}px`,
    width: `${panelW}px`,
    zIndex: "250",
  };
}

function onShellPointerDownCapture(e: PointerEvent) {
  const t = e.target as Node;
  if (notificationsOpen.value) {
    if (notificationsBellRoot.value?.contains(t)) return;
    if (notificationsPanelRef.value?.contains(t)) return;
    closeNotificationsPanel();
  }
  if (accountMenuOpen.value) {
    if (accountMenuRoot.value?.contains(t)) return;
    if (accountMenuPanel.value?.contains(t)) return;
    closeAccountMenu();
  }
}

async function signOut() {
  try {
    await auth.signOut();
    await router.replace({ name: "home" });
  } catch {
    /* noop */
  }
}

const signOutConfirmOpen = ref(false);
const signOutConfirmLoading = ref(false);
const signOutCancelBtnRef = ref<HTMLButtonElement | null>(null);

function openSignOutConfirm() {
  closeAccountMenu();
  closeNotificationsPanel();
  signOutConfirmOpen.value = true;
}

function closeSignOutConfirm() {
  if (signOutConfirmLoading.value) return;
  signOutConfirmOpen.value = false;
}

async function confirmSignOut() {
  signOutConfirmLoading.value = true;
  try {
    await signOut();
  } finally {
    signOutConfirmLoading.value = false;
    signOutConfirmOpen.value = false;
  }
}

function onWindowRepositionMenu() {
  if (accountMenuOpen.value) layoutAccountMenuPanel();
  if (notificationsOpen.value) layoutNotificationsPanel();
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (signOutConfirmOpen.value) {
    closeSignOutConfirm();
    return;
  }
  if (notificationsOpen.value) {
    closeNotificationsPanel();
    return;
  }
  if (accountMenuOpen.value) closeAccountMenu();
}

onMounted(() => {
  void auth.refreshSuperAdminRole();
  document.addEventListener("pointerdown", onShellPointerDownCapture, true);
  document.addEventListener("visibilitychange", onVisibilityRefreshSellerRole);
  document.addEventListener("pointerdown", primeBellSound, true);
  document.addEventListener("keydown", primeBellSound, true);
  window.addEventListener("resize", onWindowRepositionMenu);
  window.addEventListener("scroll", onWindowRepositionMenu, true);
  window.addEventListener("keydown", onGlobalKeydown);
});

onBeforeUnmount(() => {
  teardownSellerOrderBellChannel();
  document.removeEventListener("pointerdown", onShellPointerDownCapture, true);
  document.removeEventListener(
    "visibilitychange",
    onVisibilityRefreshSellerRole,
  );
  document.removeEventListener("pointerdown", primeBellSound, true);
  document.removeEventListener("keydown", primeBellSound, true);
  window.removeEventListener("resize", onWindowRepositionMenu);
  window.removeEventListener("scroll", onWindowRepositionMenu, true);
  window.removeEventListener("keydown", onGlobalKeydown);
  try {
    bellAudioContextRef.value?.close();
  } catch {
    /* noop */
  }
  bellAudioContextRef.value = null;
  if (sellerRolePollTimer) {
    clearInterval(sellerRolePollTimer);
    sellerRolePollTimer = null;
  }
});

watch(
  () => route.name,
  (name) => {
    if (name !== "dashboard") {
      ui.sellerOverviewTagline = "";
    }
  },
);

watch(
  () => route.fullPath,
  () => {
    closeAccountMenu();
    closeNotificationsPanel();
    closeSignOutConfirm();
    if (!ui.createStoreModalForced) ui.closeCreateStoreModal();
  },
);

watch(signOutConfirmOpen, async (open) => {
  if (!open) return;
  await nextTick();
  signOutCancelBtnRef.value?.focus();
});

watch(
  () => route.path,
  (path) => {
    if (path.startsWith("/admin") && auth.isPlatformStaff) {
      ui.clearSellerConsoleAccessReadyBell();
    }
  },
);

let sellerRolePollTimer: ReturnType<typeof setInterval> | null = null;

watch(
  () => [auth.isSignedIn, auth.isPlatformStaff] as const,
  ([signedIn, staff]) => {
    if (sellerRolePollTimer) {
      clearInterval(sellerRolePollTimer);
      sellerRolePollTimer = null;
    }
    if (signedIn && !staff && isSupabaseConfigured()) {
      sellerRolePollTimer = setInterval(() => {
        void auth.refreshSuperAdminRole();
      }, 45_000);
    }
  },
  { immediate: true },
);

function onVisibilityRefreshSellerRole() {
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    auth.isSignedIn &&
    !auth.isPlatformStaff &&
    isSupabaseConfigured()
  ) {
    void auth.refreshSuperAdminRole();
  }
}

type ShellNavIcon =
  | "grid"
  | "plus"
  | "palette"
  | "cog"
  | "megaphone"
  | "ticket"
  | "shield"
  | "message";

type ShellNavItem = {
  to: string;
  key: string;
  routeName: string;
  label: string;
  short: string;
  icon: ShellNavIcon;
  action?: "create-store-modal";
};

const sellerNavItems: ShellNavItem[] = [
  {
    to: "/dashboard",
    key: "seller-home",
    routeName: "dashboard",
    label: "Overview",
    short: "Home",
    icon: "grid",
  },
  {
    to: "/dashboard/stores/new",
    key: "seller-new-store",
    routeName: "dashboard-store-new",
    label: "New store",
    short: "New",
    icon: "plus",
    action: "create-store-modal",
  },
  {
    to: "/dashboard/themes",
    key: "seller-theme",
    routeName: "dashboard-themes",
    label: "Theme settings",
    short: "Theme",
    icon: "palette",
  },
];

const adminNavItems: ShellNavItem[] = [
  {
    to: "/admin",
    key: "admin-home",
    routeName: "admin",
    label: "Overview",
    short: "Home",
    icon: "grid",
  },
  {
    to: "/admin/announcements",
    key: "admin-announcements",
    routeName: "admin-announcements",
    label: "Announcements",
    short: "News",
    icon: "megaphone",
  },
  {
    to: "/admin/tickets",
    key: "admin-tickets",
    routeName: "admin-tickets",
    label: "Tickets",
    short: "Tix",
    icon: "ticket",
  },
  {
    to: "/admin/verifications",
    key: "admin-verifications",
    routeName: "admin-verifications",
    label: "Verifications",
    short: "KYC",
    icon: "shield",
  },
  {
    to: "/admin/sms-logs",
    key: "admin-sms-logs",
    routeName: "admin-sms-logs",
    label: "SMS logs",
    short: "SMS",
    icon: "message",
  },
  {
    to: "/admin/settings",
    key: "admin-settings",
    routeName: "admin-settings",
    label: "Settings",
    short: "Settings",
    icon: "cog",
  },
];

const showCreateStoreNav = computed(() => auth.platformAdminRole !== "none");
const canOpenSellerOrdersFromNotifications = computed(
  () => auth.platformStaffRoleResolved && auth.platformAdminRole !== "none",
);

const shellNav = computed(() =>
  isAdminShell.value
    ? adminNavItems
    : showCreateStoreNav.value
      ? sellerNavItems
      : sellerNavItems.filter((x) => x.action !== "create-store-modal"),
);

const hubShellLabel = computed(() =>
  isAdminShell.value ? "Platform admin" : "Seller hub",
);

function navActive(item: ShellNavItem) {
  if (item.action === "create-store-modal") {
    return route.name === "dashboard-store-new" || ui.createStoreModalOpen;
  }
  return route.name === item.routeName;
}

function openCreateStoreModal() {
  ui.openCreateStoreModal();
}

function navSoft(item: ShellNavItem) {
  if (isAdminShell.value) return false;
  if (item.routeName !== "dashboard") return false;
  return route.name === "dashboard-store";
}

const displayName = computed(() => userDisplayName(auth.user));

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
});

const accountPlanLabel = computed(() => {
  const raw = auth.user?.user_metadata?.signup_plan;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const id = raw.trim().toLowerCase();
  const p = PRICING_PLANS.find((x) => x.id === id);
  return p?.name ?? raw.trim();
});

const headerLine = computed(() => {
  if (isAdminShell.value) {
    if (route.name === "admin") {
      return "Stores, orders, and tickets — platform snapshot.";
    }
    if (route.name === "admin-settings") {
      return "Global key/value configuration.";
    }
    if (route.name === "admin-announcements") {
      return "Broadcast updates to sellers and storefronts.";
    }
    if (route.name === "admin-tickets") {
      return "Seller and buyer support requests.";
    }
    if (route.name === "admin-verifications") {
      return "Mandatory seller identity verification approvals.";
    }
    if (route.name === "admin-sms-logs") {
      return "SMS delivery records, outcomes, and function-level events.";
    }
    return "Platform administration.";
  }
  if (ui.createStoreModalOpen) {
    return "Set up a new storefront — name, slug, and optional contact.";
  }
  if (route.name === "dashboard") {
    return (
      ui.sellerOverviewTagline ||
      "Shops, catalog, and orders — your workspace at a glance."
    );
  }
  if (route.name === "dashboard-store-new") {
    return "Set up a new storefront — name, slug, and optional contact.";
  }
  if (route.name === "dashboard-store") {
    return "Products, orders, delivery updates, and support in one place.";
  }
  return "Shops, catalog, and orders — your workspace at a glance.";
});

const platformRoleBadgeClass = computed(() =>
  auth.isSuperAdmin
    ? "border-violet-200/90 bg-violet-50 text-violet-900 ring-violet-200/60"
    : "border-slate-200/90 bg-slate-100 text-slate-800 ring-slate-200/70",
);

/** Earliest `current_period_end` among this user's active/trialing shop subs (matches DashboardHome renewal guard). */
const headerSellerSubscriptionRenewalEnd = ref<string | null>(null);
const firstStoreGateBusy = ref(false);

function formatHeaderSubscriptionPeriodEnd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

async function refreshHeaderSellerSubscriptionRenewal() {
  headerSellerSubscriptionRenewalEnd.value = null;
  if (!isSupabaseConfigured() || !auth.isSignedIn || isAdminShell.value) return;
  const uid = authSessionUserId.value;
  if (!uid) return;
  const supabase = getSupabaseBrowser();
  const { data: storeRows, error: storeErr } = await supabase
    .from("stores")
    .select("id")
    .eq("owner_id", uid);
  if (storeErr) return;
  const storeIds = (storeRows ?? [])
    .map((r: { id?: unknown }) =>
      typeof r.id === "string" ? r.id : String(r.id ?? ""),
    )
    .filter(Boolean);
  if (storeIds.length === 0) return;
  const { data: subRows, error: subErr } = await supabase
    .from("seller_subscriptions")
    .select("current_period_end, status")
    .in("store_id", storeIds);
  if (subErr) return;
  let minEnd: string | null = null;
  for (const row of subRows ?? []) {
    const rec = row as {
      current_period_end?: string | null;
      status?: string | null;
    };
    const st = typeof rec.status === "string" ? rec.status.trim() : "";
    if (st === "active" || st === "trialing") {
      const end =
        typeof rec.current_period_end === "string"
          ? rec.current_period_end
          : null;
      if (end && (!minEnd || new Date(end) < new Date(minEnd))) {
        minEnd = end;
      }
    }
  }
  headerSellerSubscriptionRenewalEnd.value = minEnd;
}

watch(
  () =>
    [
      auth.isSignedIn,
      authSessionUserId.value,
      isAdminShell.value,
      route.fullPath,
    ] as const,
  ([signedIn, uid, adminShell]) => {
    if (!signedIn || !uid || adminShell) {
      headerSellerSubscriptionRenewalEnd.value = null;
      return;
    }
    void refreshHeaderSellerSubscriptionRenewal();
  },
  { immediate: true },
);

async function enforceFirstStoreGate() {
  if (firstStoreGateBusy.value) return;
  if (!isSupabaseConfigured()) return;
  if (!auth.isSignedIn || auth.isPlatformStaff || isAdminShell.value) return;
  if (!authSessionUserId.value) return;
  if (route.name === "dashboard-store-new") return;
  firstStoreGateBusy.value = true;
  try {
    const supabase = getSupabaseBrowser();
    const [
      { count: ownedCount, error: ownedErr },
      { count: adminCount, error: adminErr },
    ] = await Promise.all([
      supabase
        .from("stores")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", authSessionUserId.value),
      supabase
        .from("store_admins")
        .select("id", { count: "exact", head: true })
        .eq("user_id", authSessionUserId.value),
    ]);
    const count = ownedCount ?? 0;
    const assigned = adminCount ?? 0;
    const error = ownedErr ?? adminErr;
    if (!error && count === 0 && assigned === 0) {
      ui.setCreateStoreModalForced(true);
      if (!ui.createStoreModalOpen) ui.openCreateStoreModal();
    } else if (!error) {
      ui.setCreateStoreModalForced(false);
    }
  } finally {
    firstStoreGateBusy.value = false;
  }
}

watch(
  () =>
    [
      auth.isSignedIn,
      authSessionUserId.value,
      route.name,
      route.fullPath,
      isAdminShell.value,
    ] as const,
  () => {
    void enforceFirstStoreGate();
  },
  { immediate: true },
);
</script>

<template>
  <div
    class="relative flex min-h-svh w-full flex-1 flex-col text-zinc-800 antialiased md:h-full md:min-h-0 md:overflow-hidden"
    style="
      background: linear-gradient(
        165deg,
        #e8e9f2 0%,
        #eceef6 45%,
        #f1f0f8 100%
      );
    "
  >
    <div
      class="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <div
        class="absolute -left-24 top-24 h-80 w-80 rounded-full bg-indigo-200/40 blur-3xl"
      />
      <div
        class="absolute right-10 top-40 h-72 w-72 rounded-full bg-sky-200/35 blur-3xl"
      />
      <div
        class="absolute bottom-20 left-1/4 h-64 w-64 rounded-full bg-rose-200/30 blur-3xl"
      />
    </div>

    <!-- Mobile shell -->
    <header
      class="relative z-20 m-3 flex shrink-0 flex-col gap-3 rounded-[1.75rem] border border-white/70 bg-white/60 p-4 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.12)] backdrop-blur-xl md:hidden"
    >
      <div class="flex items-center justify-between gap-3">
        <div
          class="pointer-events-none flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-2xl bg-transparent p-0 shadow-lg shadow-zinc-900/20"
          aria-hidden="true"
        >
          <img
            src="/src/assets/logo/uanditech.png"
            alt=""
            class="h-full w-full rounded-xl object-cover"
            aria-hidden="true"
          />
        </div>
        <p
          class="min-w-0 flex-1 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-400"
        >
          {{ hubShellLabel }}
        </p>
        <div class="flex shrink-0 items-center gap-2">
          <button
            v-if="!isAdminShell && cart.itemCount > 0"
            type="button"
            class="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white text-zinc-700 shadow-sm"
            aria-label="Open cart"
            @click="ui.toggleCart()"
          >
            <svg
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.75"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 6.75h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
              />
            </svg>
            <span
              class="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-400 px-1 text-[10px] font-bold text-white shadow-sm"
              >{{ cart.itemCount }}</span
            >
          </button>
          <button
            type="button"
            class="rounded-2xl border border-zinc-200/80 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 shadow-sm"
            @click="openSignOutConfirm"
          >
            Sign out
          </button>
        </div>
      </div>
      <nav
        class="flex gap-2 rounded-2xl border border-zinc-200/40 bg-zinc-50/80 p-1.5"
      >
        <template v-for="item in shellNav" :key="`m-${item.key}`">
          <button
            v-if="item.action === 'create-store-modal'"
            type="button"
            class="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition-all"
            :class="
              navActive(item)
                ? 'bg-white text-zinc-900 shadow-md shadow-zinc-900/5'
                : navSoft(item)
                  ? 'bg-indigo-50 text-indigo-900 ring-1 ring-indigo-100'
                  : 'text-zinc-500 hover:bg-white/90 hover:text-zinc-800'
            "
            :aria-label="item.label"
            @click="openCreateStoreModal"
          >
            <span class="truncate">{{ item.short }}</span>
          </button>
          <RouterLink
            v-else
            :to="item.to"
            class="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition-all"
            :class="
              navActive(item)
                ? 'bg-white text-zinc-900 shadow-md shadow-zinc-900/5'
                : navSoft(item)
                  ? 'bg-indigo-50 text-indigo-900 ring-1 ring-indigo-100'
                  : 'text-zinc-500 hover:bg-white/90 hover:text-zinc-800'
            "
          >
            <span class="truncate">{{ item.short }}</span>
          </RouterLink>
        </template>
      </nav>
      <div
        v-if="auth.isPlatformStaff"
        class="flex flex-wrap items-center justify-center gap-2"
      >
        <RouterLink
          v-if="!isAdminShell"
          to="/admin"
          class="rounded-full border border-violet-200/80 bg-violet-50 px-3 py-1 text-[11px] font-semibold text-violet-900"
        >
          Console
        </RouterLink>
        <RouterLink
          v-else
          to="/dashboard"
          class="rounded-full border border-indigo-200/80 bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-900"
        >
          Seller
        </RouterLink>
        <span
          class="rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-tight"
          :class="platformRoleBadgeClass"
        >
          {{ auth.platformAdminRoleLabel }}
        </span>
      </div>
    </header>

    <!-- Desktop: light inset rail (original palette) -->
    <aside
      class="relative z-30 hidden w-[4.75rem] flex-col gap-1 border border-white/80 bg-[#e9ecf8]/95 py-6 shadow-[0_24px_60px_-28px_rgba(15,23,42,0.18)] backdrop-blur-xl md:fixed md:left-4 md:top-4 md:flex md:h-[calc(100svh-2rem)] md:max-h-[calc(100svh-2rem)] md:overflow-y-auto md:rounded-[1.875rem]"
    >
      <div
        class="pointer-events-none mx-auto flex h-12 w-12 select-none items-center justify-center rounded-2xl bg-transparent p-0 shadow-lg shadow-zinc-900/25"
        aria-hidden="true"
      >
        <img
          src="/src/assets/logo/uanditech.png"
          alt=""
          class="h-full w-full rounded-xl object-cover"
          aria-hidden="true"
        />
      </div>

      <nav class="mt-8 flex flex-col items-center gap-2.5 px-2">
        <template v-for="item in shellNav" :key="`d-${item.key}`">
          <button
            v-if="item.action === 'create-store-modal'"
            type="button"
            class="flex h-12 w-12 items-center justify-center rounded-2xl transition-all"
            :class="
              navActive(item)
                ? 'bg-white text-zinc-900 shadow-[0_12px_28px_-12px_rgba(15,23,42,0.25)]'
                : navSoft(item)
                  ? 'bg-indigo-100/80 text-indigo-900 ring-1 ring-indigo-200/60'
                  : 'text-zinc-600 hover:bg-white/80 hover:text-zinc-900'
            "
            :title="item.label"
            :aria-label="item.label"
            @click="openCreateStoreModal"
          >
            <svg
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
          </button>
          <RouterLink
            v-else
            :to="item.to"
            class="flex h-12 w-12 items-center justify-center rounded-2xl transition-all"
            :class="
              navActive(item)
                ? 'bg-white text-zinc-900 shadow-[0_12px_28px_-12px_rgba(15,23,42,0.25)]'
                : navSoft(item)
                  ? 'bg-indigo-100/80 text-indigo-900 ring-1 ring-indigo-200/60'
                  : 'text-zinc-600 hover:bg-white/80 hover:text-zinc-900'
            "
            :title="item.label"
          >
            <svg
              v-if="item.icon === 'grid'"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75A2.25 2.25 0 0115.75 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H15.75A2.25 2.25 0 0113.5 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25z"
              />
            </svg>
            <svg
              v-else-if="item.icon === 'plus'"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
            <svg
              v-else-if="item.icon === 'palette'"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-16a7 7 0 1 0 0 14h.5a1.5 1.5 0 0 0 0-3H12a2.5 2.5 0 0 1 0-5h4a2 2 0 0 0 0-4h-4Z"
              />
            </svg>
            <svg
              v-else-if="item.icon === 'cog'"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
              />
              <circle cx="12" cy="12" r="3" fill="none" />
            </svg>
            <svg
              v-else-if="item.icon === 'megaphone'"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
              />
              <path
                d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"
              />
              <path d="M8 6v8" />
            </svg>
            <svg
              v-else-if="item.icon === 'ticket'"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"
              />
              <path d="M13 5v2" />
              <path d="M13 17v2" />
              <path d="M13 11v2" />
            </svg>
            <svg
              v-else-if="item.icon === 'shield'"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M12 3 4.5 6v6c0 5.2 3.4 8.8 7.5 10 4.1-1.2 7.5-4.8 7.5-10V6L12 3z"
              />
              <path d="m9.5 12 1.8 1.8L14.8 10.3" />
            </svg>
            <svg
              v-else-if="item.icon === 'message'"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M4 6h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H8l-4 3v-3H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
              <path d="M8 10h8" />
              <path d="M8 13h5" />
            </svg>
          </RouterLink>
        </template>
      </nav>

      <div class="flex flex-1" />

      <div
        v-if="!isAdminShell && cart.itemCount > 0"
        class="flex flex-col items-center gap-2 border-t border-white/50 px-2 pt-5"
      >
        <button
          v-if="!isAdminShell && cart.itemCount > 0"
          type="button"
          class="relative flex h-11 w-11 items-center justify-center rounded-2xl text-zinc-500 transition hover:bg-white/80 hover:text-zinc-800"
          aria-label="Open cart"
          title="Cart"
          @click="ui.toggleCart()"
        >
          <svg
            class="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.75"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 6.75h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
            />
          </svg>
          <span
            class="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-400 px-0.5 text-[9px] font-bold text-white"
            >{{ cart.itemCount }}</span
          >
        </button>
      </div>
    </aside>

    <!-- Main: header card + canvas (center column + right rail live inside overview) -->
    <div
      class="relative z-10 mx-3 mb-4 flex min-h-0 min-w-0 flex-1 flex-col md:mx-0 md:mb-0 md:ml-[calc(1rem+4.75rem+1rem)] md:h-full md:min-h-0 md:overflow-hidden md:py-4 md:pr-5"
    >
      <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-5">
        <header
          class="z-40 shrink-0 rounded-[1.75rem] border border-white/70 bg-gradient-to-br from-sky-50/90 via-indigo-50/50 to-violet-50/70 px-5 py-5 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.12)] backdrop-blur-md sm:rounded-[1.875rem] sm:px-8 sm:py-6"
        >
          <!-- Greeting left · compact search + controls grouped right -->
          <div
            class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6"
          >
            <div
              class="flex min-w-0 flex-1 items-start gap-4 sm:gap-5 lg:max-w-[min(100%,40rem)]"
            >
              <div class="relative shrink-0">
                <input
                  ref="avatarFileInput"
                  type="file"
                  class="sr-only"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  aria-hidden="true"
                  tabindex="-1"
                  @change="onAvatarFileChange"
                />
                <button
                  type="button"
                  class="group relative flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-white text-white shadow-lg shadow-indigo-900/25 ring-2 ring-indigo-200/80 transition hover:ring-indigo-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 sm:h-[5.25rem] sm:w-[5.25rem] sm:rounded-[1.35rem] md:h-24 md:w-24 lg:h-[6.75rem] lg:w-[6.75rem] lg:rounded-3xl"
                  :class="
                    auth.profileAvatarPublicUrl
                      ? 'bg-white'
                      : 'bg-gradient-to-br from-violet-500 to-indigo-600'
                  "
                  :title="
                    auth.profileAvatarPublicUrl
                      ? 'Change profile photo'
                      : 'Add your profile photo'
                  "
                  aria-label="Upload or change your profile photo"
                  @click="openAvatarPicker"
                >
                  <img
                    v-if="auth.profileAvatarPublicUrl"
                    :src="auth.profileAvatarPublicUrl"
                    alt=""
                    class="h-full w-full bg-white object-cover transition duration-300 group-hover:scale-[1.03]"
                    @error="onHeaderAvatarImageError"
                  />
                  <span
                    v-else
                    class="text-2xl font-bold tracking-tight drop-shadow-sm sm:text-3xl md:text-4xl lg:text-[2.65rem]"
                    aria-hidden="true"
                    >{{ auth.userDisplayInitial }}</span
                  >
                  <span
                    class="pointer-events-none absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full border border-white/90 bg-white/95 text-indigo-600 shadow-md ring-1 ring-zinc-200/60 sm:bottom-1.5 sm:right-1.5 sm:h-8 sm:w-8"
                    aria-hidden="true"
                  >
                    <svg
                      class="h-3.5 w-3.5 sm:h-4 sm:w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                      />
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008H18.75V10.5z"
                      />
                    </svg>
                  </span>
                </button>
              </div>
              <div class="min-w-0 flex-1 pt-0.5">
                <template
                  v-if="!suppressDefaultGreetingUntilOwnershipResolved"
                >
                  <h1
                    class="text-pretty text-2xl font-bold tracking-tight text-zinc-900 sm:text-[1.65rem]"
                  >
                    {{ greeting }}, {{ displayName }}
                  </h1>
                  <p class="mt-1.5 text-sm leading-relaxed text-zinc-500">
                    {{ headerLine }}
                  </p>
                </template>
                <template v-else>
                  <div class="h-14" aria-hidden="true" />
                </template>
                <p
                  v-if="
                    auth.isPlatformStaff || headerSellerSubscriptionRenewalEnd
                  "
                  class="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5"
                >
                  <span
                    v-if="auth.isPlatformStaff"
                    class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-tight ring-1"
                    :class="platformRoleBadgeClass"
                    :aria-label="`Platform console role: ${auth.platformAdminRoleLabel}`"
                  >
                    {{ auth.platformAdminRoleLabel }}
                  </span>
                  <span
                    v-if="headerSellerSubscriptionRenewalEnd"
                    class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-sky-200/90 bg-sky-50/95 px-3 py-1 text-xs font-semibold text-sky-950 shadow-sm ring-1 ring-sky-100/80"
                  >
                    <span class="shrink-0 text-sky-800/90"
                      >Subscription ends</span
                    >
                    <time
                      class="min-w-0 truncate font-bold tabular-nums tracking-tight text-sky-950"
                      :datetime="headerSellerSubscriptionRenewalEnd"
                    >
                      {{
                        formatHeaderSubscriptionPeriodEnd(
                          headerSellerSubscriptionRenewalEnd,
                        )
                      }}
                    </time>
                  </span>
                </p>
              </div>
            </div>

            <div
              class="flex flex-wrap items-center gap-2 sm:gap-2.5 lg:shrink-0 lg:justify-end"
            >
              <button
                type="button"
                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-zinc-200/80 bg-zinc-50 text-zinc-500 shadow-sm transition hover:border-zinc-300 hover:bg-white hover:text-zinc-800"
                aria-label="Chat"
                @click="openComingSoonModal"
              >
                <svg
                  class="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.75"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </button>

              <div ref="notificationsBellRoot" class="relative shrink-0">
                <button
                  type="button"
                  class="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-zinc-50 text-zinc-500 shadow-sm transition hover:border-zinc-300 hover:bg-white hover:text-zinc-800"
                  :class="
                    notificationsOpen
                      ? 'border-indigo-400/80 ring-2 ring-indigo-400/25'
                      : 'border-zinc-200/80'
                  "
                  aria-haspopup="true"
                  :aria-expanded="notificationsOpen"
                  aria-controls="dashboard-notifications-panel"
                  :aria-label="adminBellAriaLabel"
                  @click="toggleNotificationsPanel"
                >
                  <svg
                    class="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="1.75"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                    />
                  </svg>
                  <span
                    v-if="
                      isAdminShell &&
                      auth.isPlatformStaff &&
                      adminBellCombinedCount > 0
                    "
                    class="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white"
                    :class="adminBellBadgeRose ? 'bg-rose-500' : 'bg-amber-500'"
                    >{{
                      adminBellCombinedCount > 9 ? "9+" : adminBellCombinedCount
                    }}</span
                  >
                  <span
                    v-else-if="!isAdminShell && sellerHubBellCombinedCount > 0"
                    class="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white"
                    :class="
                      sellerHubBellBadgeTone === 'emerald'
                        ? 'bg-emerald-500'
                        : sellerHubBellBadgeTone === 'amber'
                          ? 'bg-amber-500'
                          : sellerHubBellBadgeTone === 'indigo'
                            ? 'bg-indigo-500'
                            : 'bg-violet-500'
                    "
                    >{{
                      sellerHubBellCombinedCount > 9
                        ? "9+"
                        : sellerHubBellCombinedCount
                    }}</span
                  >
                </button>

                <Teleport to="body">
                  <Transition name="notif-pop">
                    <div
                      v-if="notificationsOpen"
                      id="dashboard-notifications-panel"
                      ref="notificationsPanelRef"
                      class="notif-pop-root"
                      role="region"
                      aria-label="Notifications"
                      :style="notificationsPanelStyle"
                    >
                      <div
                        class="notif-pop-panel overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-[0_32px_80px_-32px_rgba(15,23,42,0.28)] ring-1 ring-zinc-900/[0.04] backdrop-blur-xl"
                      >
                        <div
                          class="border-b border-zinc-100 bg-zinc-50/80 px-4 py-2.5 sm:px-5"
                        >
                          <h2
                            class="text-sm font-bold tracking-tight text-zinc-900 sm:text-base"
                          >
                            Notifications
                          </h2>
                        </div>

                        <div class="divide-y divide-zinc-200/90 bg-zinc-50/80">
                          <button
                            v-if="
                              isAdminShell &&
                              auth.isSuperAdmin &&
                              adminPendingConsoleGrantCount > 0
                            "
                            type="button"
                            class="flex w-full cursor-pointer items-start gap-3.5 px-4 py-3.5 text-left transition hover:bg-zinc-100/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/35 sm:px-5 sm:py-4"
                            @click="goToGrantAccessFromNotifications"
                          >
                            <span
                              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-1 ring-rose-100/90"
                              aria-hidden="true"
                            >
                              <svg
                                class="h-5 w-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                stroke-width="1.75"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.433-2.554M19.128 15l2.023 2.023M4.875 19.125a9.38 9.38 0 01-2.625-.372m0 0a9.343 9.343 0 01-4.122-.952M4.875 15l-2.023 2.023M12 12h.008v.008H12V12z"
                                />
                              </svg>
                            </span>
                            <p
                              class="min-w-0 flex-1 pt-0.5 text-[13px] leading-snug text-zinc-500 sm:text-sm"
                            >
                              <span class="font-bold text-zinc-900"
                                >Console access</span
                              >{{ " " }}
                              <template
                                v-if="adminPendingConsoleGrantCount === 1"
                              >
                                1 account needs a role.
                              </template>
                              <template v-else>
                                {{ adminPendingConsoleGrantCount }} accounts
                                need roles.
                              </template>
                            </p>
                          </button>

                          <button
                            v-if="
                              isAdminShell &&
                              auth.isPlatformStaff &&
                              adminOpenTicketCount > 0
                            "
                            type="button"
                            class="flex w-full cursor-pointer items-start gap-3.5 px-4 py-3.5 text-left transition hover:bg-zinc-100/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/35 sm:px-5 sm:py-4"
                            @click="goToTicketsFromNotifications"
                          >
                            <span
                              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-100/90"
                              aria-hidden="true"
                            >
                              <svg
                                class="h-5 w-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              >
                                <path
                                  d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"
                                />
                                <path d="M13 5v2" />
                                <path d="M13 17v2" />
                                <path d="M13 11v2" />
                              </svg>
                            </span>
                            <p
                              class="min-w-0 flex-1 pt-0.5 text-[13px] leading-snug text-zinc-500 sm:text-sm"
                            >
                              <span class="font-bold text-zinc-900"
                                >Support tickets</span
                              >{{ " " }}{{ adminOpenTicketCount }} open.
                            </p>
                          </button>

                          <div
                            v-if="
                              isAdminShell &&
                              auth.isPlatformStaff &&
                              adminBellCombinedCount === 0
                            "
                            class="px-4 py-8 text-center sm:px-5"
                          >
                            <p class="text-sm text-zinc-500">Nothing new.</p>
                          </div>

                          <button
                            v-if="
                              !isAdminShell &&
                              auth.isPlatformStaff &&
                              sellerConsoleAccessReadyBellCount > 0
                            "
                            type="button"
                            class="flex w-full cursor-pointer items-start gap-3.5 px-4 py-3.5 text-left transition hover:bg-zinc-100/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/35 sm:px-5 sm:py-4"
                            @click="openPlatformConsoleFromSellerNotification"
                          >
                            <span
                              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100/90"
                              aria-hidden="true"
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
                                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                            </span>
                            <p
                              class="min-w-0 flex-1 pt-0.5 text-[13px] leading-snug text-zinc-500 sm:text-sm"
                            >
                              <span class="font-bold text-zinc-900"
                                >Platform console</span
                              >{{ " " }}Your account now has a console role.
                              Open the platform admin workspace when you are
                              ready.
                            </p>
                          </button>

                          <div
                            v-if="
                              !isAdminShell &&
                              sellerPlatformAnnouncementsPreview.length > 0
                            "
                            class="px-4 py-3.5 sm:px-5 sm:py-4"
                          >
                            <div class="flex items-start gap-3.5">
                              <span
                                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100/90"
                                aria-hidden="true"
                              >
                                <svg
                                  class="h-5 w-5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  stroke-width="1.75"
                                >
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
                                  />
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"
                                  />
                                </svg>
                              </span>
                              <div class="min-w-0 flex-1 pt-0.5">
                                <p
                                  class="text-[13px] font-bold leading-snug text-zinc-900 sm:text-sm"
                                >
                                  Platform news
                                </p>
                                <p
                                  class="mt-0.5 text-[11px] leading-relaxed text-zinc-500"
                                >
                                  From the U&amp;I Tech team — newest first.
                                </p>
                                <div
                                  class="mt-3 max-h-64 space-y-2.5 overflow-y-auto overscroll-y-contain pr-0.5"
                                >
                                  <div
                                    v-for="a in sellerPlatformAnnouncementsPreview"
                                    :key="a.id"
                                    class="rounded-xl border border-zinc-100/90 bg-white px-3 py-2.5 shadow-sm"
                                  >
                                    <p class="text-sm font-semibold text-zinc-900">
                                      {{ a.title }}
                                    </p>
                                    <p
                                      class="mt-1 text-xs leading-relaxed text-zinc-600 whitespace-pre-wrap"
                                    >
                                      {{ a.message }}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div
                            v-if="!isAdminShell && sellerNewOrderBellCount > 0"
                            class="flex items-start gap-3.5 px-4 py-3.5 sm:px-5 sm:py-4"
                          >
                            <span
                              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-100/90"
                              aria-hidden="true"
                            >
                              <svg
                                class="h-5 w-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                stroke-width="1.75"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  d="M20.25 7.5l-.416 9.563A1.125 1.125 0 0118.873 18H5.127a1.125 1.125 0 01-1.109-.937L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
                                />
                              </svg>
                            </span>
                            <div class="min-w-0 flex-1 pt-0.5">
                              <button
                                type="button"
                                :disabled="!canOpenSellerOrdersFromNotifications"
                                class="w-full rounded-md text-left text-[13px] leading-snug text-zinc-500 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/35 sm:text-sm"
                                :class="
                                  canOpenSellerOrdersFromNotifications
                                    ? 'cursor-pointer hover:bg-zinc-100/80'
                                    : 'cursor-not-allowed opacity-70'
                                "
                                @click="
                                  goToSellerCustomerOrdersFromNotifications
                                "
                              >
                                <span class="font-bold text-zinc-900"
                                  >Active orders</span
                                >{{ " " }}
                                <template v-if="sellerNewOrderBellCount === 1">
                                  1 order is not delivered or canceled yet.
                                  Update status under Orders from Customers.
                                </template>
                                <template v-else>
                                  {{ sellerNewOrderBellCount }} orders are not
                                  delivered or canceled yet. Update status under
                                  Orders from Customers.
                                </template>
                              </button>
                              <p
                                v-if="!canOpenSellerOrdersFromNotifications"
                                class="mt-1 text-xs text-zinc-500"
                              >
                                You do not have access to open Orders from this account yet.
                              </p>
                              <button
                                type="button"
                                class="mt-1.5 block w-full cursor-pointer rounded-md px-0 py-0.5 text-left text-xs font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-2 transition hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/35"
                                @click="
                                  dismissSellerNewOrderBellFromNotifications
                                "
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>

                          <button
                            v-if="!isAdminShell && cart.itemCount > 0"
                            type="button"
                            class="flex w-full cursor-pointer items-start gap-3.5 px-4 py-3.5 text-left transition hover:bg-zinc-100/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/35 sm:px-5 sm:py-4"
                            @click="openCartFromNotifications"
                          >
                            <span
                              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 ring-1 ring-violet-100/90"
                              aria-hidden="true"
                            >
                              <svg
                                class="h-5 w-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                stroke-width="1.75"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 6.75h12.974c.576 0 1.059.435 1.119 1.007z"
                                />
                              </svg>
                            </span>
                            <p
                              class="min-w-0 flex-1 pt-0.5 text-[13px] leading-snug text-zinc-500 sm:text-sm"
                            >
                              <span class="font-bold text-zinc-900">Cart</span
                              >{{ " " }}{{ cart.itemCount }} item{{
                                cart.itemCount === 1 ? "" : "s"
                              }}
                              in your cart.
                            </p>
                          </button>

                          <div
                            v-if="
                              !isAdminShell && sellerHubBellCombinedCount === 0
                            "
                            class="px-4 py-8 text-center sm:px-5"
                          >
                            <p class="text-sm text-zinc-500">Nothing new.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Transition>
                </Teleport>
              </div>

              <div ref="accountMenuRoot" class="relative shrink-0">
                <button
                  type="button"
                  class="flex items-center gap-1 rounded-2xl border bg-zinc-50 py-1 pl-1 pr-2 shadow-sm transition hover:border-zinc-300 hover:bg-white"
                  :class="
                    accountMenuOpen
                      ? 'border-violet-400/70 ring-2 ring-violet-500/25'
                      : 'border-zinc-200/80'
                  "
                  :title="auth.user?.email ?? 'Account'"
                  aria-haspopup="menu"
                  :aria-expanded="accountMenuOpen"
                  aria-controls="dashboard-account-menu"
                  @click="toggleAccountMenu"
                >
                  <div
                    class="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-white shadow-sm ring-2 ring-white"
                    :class="
                      auth.profileAvatarPublicUrl
                        ? 'bg-white'
                        : 'bg-gradient-to-br from-violet-500 to-indigo-600'
                    "
                  >
                    <img
                      v-if="auth.profileAvatarPublicUrl"
                      :src="auth.profileAvatarPublicUrl"
                      alt=""
                      class="h-full w-full bg-white object-cover"
                      @error="onHeaderAvatarImageError"
                    />
                    <span v-else aria-hidden="true">{{
                      auth.userDisplayInitial
                    }}</span>
                  </div>
                  <svg
                    class="h-4 w-4 text-zinc-400 transition-transform duration-200"
                    :class="accountMenuOpen ? 'rotate-180' : ''"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                    />
                  </svg>
                </button>
              </div>

              <Teleport to="body">
                <Transition name="acct-pop">
                  <div
                    v-if="accountMenuOpen"
                    ref="accountMenuPanel"
                    id="dashboard-account-menu"
                    class="acct-pop-root"
                    role="menu"
                    aria-label="Account menu"
                    :style="accountMenuFixedStyle"
                  >
                    <div
                      class="acct-pop-panel overflow-hidden rounded-[1.35rem] border border-white/80 bg-white/90 shadow-[0_28px_70px_-28px_rgba(15,23,42,0.35)] ring-1 ring-zinc-900/[0.05] backdrop-blur-2xl"
                    >
                      <div
                        class="relative border-b border-zinc-100/80 bg-gradient-to-br from-white via-zinc-50/40 to-violet-50/50 px-5 py-5"
                        role="presentation"
                      >
                        <div
                          class="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-violet-400/25 to-fuchsia-400/10 blur-3xl"
                          aria-hidden="true"
                        />
                        <div
                          class="mb-3 flex items-center justify-between gap-2"
                        >
                          <span
                            class="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400"
                            >Account</span
                          >
                          <span
                            class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200/80"
                          >
                            <span
                              class="relative flex h-1.5 w-1.5"
                              aria-hidden="true"
                            >
                              <span
                                class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"
                              />
                              <span
                                class="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"
                              />
                            </span>
                            Online
                          </span>
                        </div>
                        <div class="relative flex gap-4">
                          <div
                            class="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-lg font-bold text-white shadow-lg shadow-violet-900/25 ring-[3px] ring-white/95"
                            :class="auth.profileAvatarPublicUrl ? 'bg-white' : 'bg-gradient-to-br from-violet-500 via-violet-600 to-indigo-700'"
                          >
                            <img
                              v-if="auth.profileAvatarPublicUrl"
                              :src="auth.profileAvatarPublicUrl"
                              alt=""
                              class="h-full w-full object-cover"
                              @error="onHeaderAvatarImageError"
                            />
                            <span v-else aria-hidden="true">{{
                              auth.userDisplayInitial
                            }}</span>
                          </div>
                          <div class="min-w-0 flex-1 pt-0.5">
                            <p
                              class="truncate text-base font-bold tracking-tight text-zinc-900"
                            >
                              {{ displayName }}
                            </p>
                            <div
                              class="mt-1.5 flex items-center gap-1.5 rounded-xl bg-zinc-100/80 py-1 pl-2 pr-1 ring-1 ring-zinc-200/60"
                            >
                              <p
                                class="min-w-0 flex-1 truncate text-[11px] leading-tight text-zinc-600"
                              >
                                {{ auth.user?.email ?? "Signed in" }}
                              </p>
                              <button
                                v-if="auth.user?.email"
                                type="button"
                                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white hover:text-violet-600 hover:shadow-sm"
                                aria-label="Copy email address"
                                @click.stop="copyAccountEmail"
                              >
                                <svg
                                  class="h-4 w-4"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  stroke-width="2"
                                  aria-hidden="true"
                                >
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a3 3 0 01-3 3H6.75a3 3 0 01-3-3V8.197c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
                                  />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div
                        v-if="accountPlanLabel || auth.isPlatformStaff"
                        class="space-y-2.5 border-b border-zinc-100/80 bg-zinc-50/35 px-5 py-4"
                        role="presentation"
                      >
                        <p
                          class="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400"
                        >
                          Access & plan
                        </p>
                        <div class="flex w-full gap-2">
                          <span
                            v-if="accountPlanLabel"
                            class="flex min-w-0 flex-1 basis-0 items-center gap-2.5 rounded-xl border border-zinc-200/90 bg-white/95 px-4 py-2.5 text-left shadow-sm transition hover:border-zinc-300 hover:shadow-md"
                          >
                            <span
                              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600"
                              aria-hidden="true"
                            >
                              <svg
                                class="h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                stroke-width="1.75"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
                                />
                              </svg>
                            </span>
                            <span class="min-w-0 flex-1">
                              <span
                                class="block text-[10px] font-medium uppercase tracking-wide text-zinc-400"
                                >Plan</span
                              >
                              <span
                                class="block truncate text-xs font-semibold text-zinc-800"
                                >{{ accountPlanLabel }}</span
                              >
                            </span>
                          </span>
                          <span
                            v-if="auth.isPlatformStaff"
                            class="flex min-w-0 flex-1 basis-0 items-center gap-2.5 rounded-xl border border-violet-200/90 bg-gradient-to-br from-violet-50 to-white px-4 py-2.5 text-left shadow-sm shadow-violet-900/5 ring-1 ring-violet-100/80 transition hover:border-violet-300/90 hover:shadow-md"
                          >
                            <span
                              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white shadow-inner"
                              aria-hidden="true"
                            >
                              <svg
                                class="h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                stroke-width="1.75"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                                />
                              </svg>
                            </span>
                            <span class="min-w-0 flex-1">
                              <span
                                class="block text-[10px] font-medium uppercase tracking-wide text-violet-600/90"
                                >Console</span
                              >
                              <span
                                class="block truncate text-xs font-semibold text-violet-950"
                                >{{ auth.platformAdminRoleLabel }}</span
                              >
                            </span>
                          </span>
                        </div>
                      </div>

                      <div class="p-2.5">
                        <button
                          type="button"
                          class="group relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-xl border border-transparent bg-gradient-to-r from-zinc-50 to-zinc-100/80 px-4 py-3 text-left text-sm font-semibold text-zinc-800 shadow-sm ring-1 ring-zinc-200/50 transition hover:from-rose-50 hover:to-rose-50/80 hover:text-rose-950 hover:ring-rose-200/60 active:scale-[0.99]"
                          role="menuitem"
                          @click="openSignOutConfirm"
                        >
                          <span class="flex items-center gap-3">
                            <span
                              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-zinc-500 shadow-sm ring-1 ring-zinc-200/60 transition group-hover:bg-rose-100 group-hover:text-rose-600 group-hover:ring-rose-200/50"
                              aria-hidden="true"
                            >
                              <svg
                                class="h-5 w-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                stroke-width="1.75"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
                                />
                              </svg>
                            </span>
                            <span class="flex flex-col gap-0.5">
                              <span>Sign out</span>
                              <span
                                class="text-[10px] font-normal text-zinc-400 transition group-hover:text-rose-600/90"
                                >End session on this device</span
                              >
                            </span>
                          </span>
                          <svg
                            class="h-4 w-4 shrink-0 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-rose-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              d="M8.25 4.5l7.5 7.5-7.5 7.5"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </Transition>
              </Teleport>
            </div>
          </div>
        </header>

        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            class="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain"
          >
            <div class="min-w-0 flex-1 px-0.5 pb-4 md:px-1">
              <RouterView />
            </div>
          </div>
          <footer
            class="shrink-0 border-t border-zinc-200/80 bg-white/90 px-4 py-2.5 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.08)] backdrop-blur-md md:rounded-b-2xl md:px-5"
            :style="{
              paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom, 0px))',
            }"
          >
            <nav
              class="flex flex-col items-center justify-between gap-2 sm:flex-row sm:gap-4"
              aria-label="Dashboard footer"
            >
              <div
                class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] font-semibold"
              >
                <RouterLink
                  :to="isAdminShell ? { name: 'admin' } : { name: 'dashboard' }"
                  class="text-zinc-600 transition hover:text-zinc-900"
                >
                  {{ isAdminShell ? "Console home" : "Seller hub" }}
                </RouterLink>
                <RouterLink
                  v-if="isAdminShell && auth.isPlatformStaff"
                  :to="{ name: 'admin-tickets' }"
                  class="text-zinc-600 transition hover:text-zinc-900"
                >
                  Support tickets
                </RouterLink>
                <RouterLink
                  :to="{ name: 'home' }"
                  class="text-zinc-600 transition hover:text-zinc-900"
                >
                  Marketing site
                </RouterLink>
              </div>
              <p
                class="text-center text-[10px] font-medium tabular-nums text-zinc-400 sm:text-right"
              >
                © {{ dashboardFooterYear }} U&amp;I Tech
              </p>
            </nav>
          </footer>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="so-dim">
        <div
          v-if="comingSoonModalOpen"
          class="fixed inset-0 z-[555] flex items-center justify-center bg-zinc-950/55 px-4 py-8 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="coming-soon-title"
          aria-describedby="coming-soon-desc"
        >
          <!-- Backdrop intentionally does not dismiss (no click handler). -->
          <div
            class="relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/70 bg-white shadow-[0_32px_100px_-32px_rgba(15,23,42,0.55)] ring-1 ring-zinc-900/[0.06]"
          >
            <div
              class="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500"
              aria-hidden="true"
            />
            <div
              class="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-emerald-400/18 blur-3xl"
              aria-hidden="true"
            />
            <div
              class="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-sky-400/12 blur-3xl"
              aria-hidden="true"
            />

            <div class="relative px-6 pb-5 pt-7 sm:px-8 sm:pb-6 sm:pt-8">
              <div class="flex flex-col items-center text-center">
                <div
                  class="relative flex h-[3.5rem] w-[3.5rem] items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-xl shadow-emerald-900/20 ring-4 ring-white/90"
                >
                  <svg
                    class="h-7 w-7 opacity-95"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="1.7"
                    aria-hidden="true"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                </div>
                <p
                  class="mt-3.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-600/90"
                >
                  Coming soon
                </p>
                <h2
                  id="coming-soon-title"
                  class="mt-1 text-2xl font-bold tracking-tight text-zinc-900"
                >
                  New feature in development
                </h2>
                <p
                  id="coming-soon-desc"
                  class="mt-1.5 max-w-sm text-sm leading-relaxed text-zinc-600"
                >
                  We’re currently building this experience. It will be available
                  in a future update.
                </p>
              </div>

              <div class="mt-6 flex items-center justify-center">
                <button
                  type="button"
                  class="inline-flex h-11 items-center justify-center rounded-2xl bg-emerald-600 px-6 text-sm font-bold text-white shadow-[0_14px_30px_-18px_rgba(5,150,105,0.9)] transition hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                  @click="closeComingSoonModal"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <Transition name="so-dim">
        <div
          v-if="signOutConfirmOpen"
          class="so-dim-root fixed inset-0 z-[560] flex items-center justify-center bg-zinc-950/55 px-4 py-8 backdrop-blur-md"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="sign-out-confirm-title"
          aria-describedby="sign-out-confirm-desc"
          :aria-busy="signOutConfirmLoading"
        >
          <!-- Backdrop intentionally does not dismiss (no click handler). -->
          <div
            class="so-dim-panel relative w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-white/70 bg-white shadow-[0_32px_100px_-32px_rgba(15,23,42,0.55)] ring-1 ring-zinc-900/[0.06]"
          >
            <div
              class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/60 to-transparent"
              aria-hidden="true"
            />
            <div
              class="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500"
              aria-hidden="true"
            />
            <div
              class="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-violet-400/20 blur-3xl"
              aria-hidden="true"
            />
            <div
              class="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-indigo-400/15 blur-3xl"
              aria-hidden="true"
            />

            <div class="relative px-6 pb-5 pt-7 sm:px-8 sm:pb-6 sm:pt-8">
              <div class="flex flex-col items-center text-center">
                <div
                  class="relative flex h-[3.75rem] w-[3.75rem] items-center justify-center rounded-2xl bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-950 text-white shadow-xl shadow-zinc-900/35 ring-4 ring-white/90"
                >
                  <svg
                    class="h-8 w-8 opacity-95"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="1.5"
                    aria-hidden="true"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
                    />
                  </svg>
                  <span
                    class="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-amber-400 text-[10px] font-bold text-amber-950 shadow-sm"
                    aria-hidden="true"
                    >!</span
                  >
                </div>
                <p
                  class="mt-3.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-600/90"
                >
                  Session
                </p>
                <h2
                  id="sign-out-confirm-title"
                  class="mt-1 text-2xl font-bold tracking-tight text-zinc-900"
                >
                  End this session?
                </h2>
                <p
                  id="sign-out-confirm-desc"
                  class="mt-1.5 max-w-sm text-sm leading-relaxed text-zinc-600"
                >
                  You will leave the dashboard
                  {{ isAdminShell ? "and the platform console" : "" }}. Sign
                  back in anytime with the same email.
                </p>
              </div>

              <div
                class="mt-4 rounded-2xl border border-zinc-200/80 bg-gradient-to-b from-zinc-50/90 to-white/80 p-3.5 shadow-inner shadow-zinc-900/[0.03]"
              >
                <div class="flex items-center gap-3">
                  <div
                    class="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl text-sm font-bold text-white shadow-md ring-2 ring-white"
                    :class="
                      auth.profileAvatarPublicUrl
                        ? 'bg-white'
                        : 'bg-gradient-to-br from-violet-500 to-indigo-600'
                    "
                  >
                    <img
                      v-if="auth.profileAvatarPublicUrl"
                      :src="auth.profileAvatarPublicUrl"
                      alt=""
                      class="h-full w-full bg-white object-cover"
                      @error="onHeaderAvatarImageError"
                    />
                    <span v-else aria-hidden="true">{{
                      auth.userDisplayInitial
                    }}</span>
                  </div>
                  <div class="min-w-0 flex-1 text-left">
                    <p class="truncate text-sm font-semibold text-zinc-900">
                      {{ displayName }}
                    </p>
                    <p class="truncate text-xs text-zinc-500">
                      {{ auth.user?.email ?? "Signed in" }}
                    </p>
                  </div>
                  <span
                    class="hidden shrink-0 rounded-full border border-emerald-200/90 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 sm:inline"
                    >Active</span
                  >
                </div>
                <ul
                  class="mt-3 space-y-2 border-t border-zinc-200/70 pt-3 text-left text-xs leading-relaxed text-zinc-600"
                >
                  <li class="flex gap-2.5">
                    <span
                      class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700"
                      aria-hidden="true"
                    >
                      <svg
                        class="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2.5"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M4.5 12.75l6 6 9-13.5"
                        />
                      </svg>
                    </span>
                    <span
                      >Signed-in areas including your stores{{
                        isAdminShell ? " and the platform console" : ""
                      }}
                      lock until you sign in again.</span
                    >
                  </li>
                  <li class="flex gap-2.5">
                    <span
                      class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-indigo-700"
                      aria-hidden="true"
                    >
                      <svg
                        class="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2.5"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                        />
                      </svg>
                    </span>
                    <span
                      >Your account and saved data stay on our servers; only
                      this browser session ends.</span
                    >
                  </li>
                </ul>
              </div>

              <p
                class="mt-3 flex items-start justify-center gap-2 text-center text-[11px] leading-snug text-zinc-400"
              >
                <svg
                  class="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
                  />
                </svg>
                <span
                  >Tip: use
                  <kbd
                    class="rounded border border-zinc-200 bg-zinc-100 px-1 py-0.5 font-mono text-[10px] font-semibold text-zinc-600"
                    >Esc</kbd
                  >
                  to go back without signing out.</span
                >
              </p>

              <div
                class="mt-4 flex flex-col gap-2.5 sm:mt-5 sm:flex-row-reverse sm:justify-center sm:gap-3"
              >
                <button
                  type="button"
                  class="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-rose-600 to-rose-700 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-rose-900/25 transition hover:from-rose-500 hover:to-rose-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto sm:min-w-[9.5rem]"
                  :disabled="signOutConfirmLoading"
                  @click="confirmSignOut"
                >
                  <span
                    v-if="signOutConfirmLoading"
                    class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white"
                    aria-hidden="true"
                  />
                  <span>{{
                    signOutConfirmLoading ? "Signing out…" : "Sign out"
                  }}</span>
                </button>
                <button
                  ref="signOutCancelBtnRef"
                  type="button"
                  class="inline-flex w-full items-center justify-center rounded-2xl border border-zinc-200/90 bg-white px-5 py-3.5 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[9.5rem]"
                  :disabled="signOutConfirmLoading"
                  @click="closeSignOutConfirm"
                >
                  Stay signed in
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <CreateStoreModal v-if="!isAdminShell" />
  </div>
</template>

<style scoped>
.so-dim-enter-active,
.so-dim-leave-active {
  transition: opacity 0.22s ease;
}

.so-dim-enter-active .so-dim-panel,
.so-dim-leave-active .so-dim-panel {
  transition:
    transform 0.3s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.24s ease;
}

.so-dim-enter-from,
.so-dim-leave-to {
  opacity: 0;
}

.so-dim-enter-from .so-dim-panel,
.so-dim-leave-to .so-dim-panel {
  opacity: 0;
  transform: translateY(16px) scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .so-dim-enter-active,
  .so-dim-leave-active,
  .so-dim-enter-active .so-dim-panel,
  .so-dim-leave-active .so-dim-panel {
    transition-duration: 0.01ms !important;
  }

  .so-dim-enter-from .so-dim-panel,
  .so-dim-leave-to .so-dim-panel {
    transform: none;
  }
}

.acct-pop-enter-active,
.acct-pop-leave-active {
  transition: opacity 0.18s ease;
}

.acct-pop-enter-active .acct-pop-panel,
.acct-pop-leave-active .acct-pop-panel {
  transition:
    transform 0.26s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.2s ease;
}

.acct-pop-enter-from,
.acct-pop-leave-to {
  opacity: 0;
}

.acct-pop-enter-from .acct-pop-panel,
.acct-pop-leave-to .acct-pop-panel {
  opacity: 0;
  transform: translateY(-10px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .acct-pop-enter-active,
  .acct-pop-leave-active,
  .acct-pop-enter-active .acct-pop-panel,
  .acct-pop-leave-active .acct-pop-panel {
    transition-duration: 0.01ms !important;
  }

  .acct-pop-enter-from .acct-pop-panel,
  .acct-pop-leave-to .acct-pop-panel {
    transform: none;
  }
}

.notif-pop-enter-active,
.notif-pop-leave-active {
  transition: opacity 0.18s ease;
}

.notif-pop-enter-active .notif-pop-panel,
.notif-pop-leave-active .notif-pop-panel {
  transition:
    transform 0.26s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.2s ease;
}

.notif-pop-enter-from,
.notif-pop-leave-to {
  opacity: 0;
}

.notif-pop-enter-from .notif-pop-panel,
.notif-pop-leave-to .notif-pop-panel {
  opacity: 0;
  transform: translateY(-10px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .notif-pop-enter-active,
  .notif-pop-leave-active,
  .notif-pop-enter-active .notif-pop-panel,
  .notif-pop-leave-active .notif-pop-panel {
    transition-duration: 0.01ms !important;
  }

  .notif-pop-enter-from .notif-pop-panel,
  .notif-pop-leave-to .notif-pop-panel {
    transform: none;
  }
}
</style>
