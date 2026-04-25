import { createRouter, createWebHistory } from "vue-router";
import { getSupabaseBrowser, isSupabaseConfigured } from "../lib/supabase";
import { useAuthStore } from "../stores/auth";
import CheckoutView from "../views/store/CheckoutView.vue";
import OrderSuccessView from "../views/store/OrderSuccessView.vue";
import OrderTrackView from "../views/store/OrderTrackView.vue";
import StorefrontLayout from "../views/store/StorefrontLayout.vue";
import StoreView from "../views/store/StoreView.vue";
import CreateStoreView from "../views/dashboard/CreateStoreView.vue";
import DashboardHome from "../views/dashboard/DashboardHome.vue";
import DashboardLayout from "../views/dashboard/DashboardLayout.vue";
import StoreManageView from "../views/dashboard/StoreManageView.vue";
import ThemeSettingsView from "../views/dashboard/ThemeSettingsView.vue";
import AdminAnnouncementsView from "../views/admin/AnnouncementsView.vue";
import AdminHomeView from "../views/admin/AdminHomeView.vue";
import PlatformSettingsView from "../views/admin/PlatformSettingsView.vue";
import SupportTicketsView from "../views/admin/SupportTicketsView.vue";
import SellerVerificationsView from "../views/admin/SellerVerificationsView.vue";
import SmsNotificationLogsView from "../views/admin/SmsNotificationLogsView.vue";
import HomeView from "../views/HomeView.vue";
import LoginView from "../views/LoginView.vue";
import ConsoleAccessPendingView from "../views/ConsoleAccessPendingView.vue";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior(to, _from, savedPosition) {
    if (to.hash) {
      return { el: to.hash, behavior: "smooth", top: 72 };
    }
    if (savedPosition) return savedPosition;
    return { top: 0 };
  },
  routes: [
    {
      path: "/",
      name: "home",
      component: HomeView,
    },
    {
      path: "/login",
      name: "login",
      component: LoginView,
    },
    {
      path: "/console-access-pending",
      name: "console-access-pending",
      component: ConsoleAccessPendingView,
      meta: { requiresAuth: true },
    },
    {
      path: "/dashboard",
      component: DashboardLayout,
      meta: { requiresAuth: true },
      children: [
        {
          path: "",
          name: "dashboard",
          component: DashboardHome,
        },
        {
          path: "stores/new",
          name: "dashboard-store-new",
          component: CreateStoreView,
        },
        {
          path: "stores/:storeId",
          name: "dashboard-store",
          component: StoreManageView,
        },
        {
          path: "themes",
          name: "dashboard-themes",
          component: ThemeSettingsView,
        },
      ],
    },
    {
      path: "/admin",
      component: DashboardLayout,
      meta: { requiresAuth: true, requiresSuperAdmin: true },
      children: [
        {
          path: "",
          name: "admin",
          component: AdminHomeView,
        },
        {
          path: "settings",
          name: "admin-settings",
          component: PlatformSettingsView,
        },
        {
          path: "announcements",
          name: "admin-announcements",
          component: AdminAnnouncementsView,
        },
        {
          path: "tickets",
          name: "admin-tickets",
          component: SupportTicketsView,
        },
        {
          path: "verifications",
          name: "admin-verifications",
          component: SellerVerificationsView,
        },
        {
          path: "sms-logs",
          name: "admin-sms-logs",
          component: SmsNotificationLogsView,
        },
      ],
    },
    {
      path: "/:storeSlug",
      component: StorefrontLayout,
      children: [
        {
          path: "",
          name: "store",
          component: StoreView,
        },
        {
          path: "checkout",
          name: "store-checkout",
          component: CheckoutView,
        },
        {
          path: "track",
          name: "store-order-track",
          component: OrderTrackView,
        },
        {
          path: "order/:orderId/success",
          name: "order-success",
          component: OrderSuccessView,
        },
      ],
    },
  ],
});

function isOauthReturnOnHome(to: {
  name?: unknown;
  query: Record<string, unknown>;
  hash?: string;
}) {
  if (to.name !== "home") return false;
  const q = to.query;
  const hasCode = typeof q.code === "string" && q.code.trim().length > 0;
  const hasOauthError =
    typeof q.error === "string" ||
    typeof q.error_description === "string" ||
    typeof q.error_code === "string";
  const hasLegacyTokenHash =
    typeof to.hash === "string" &&
    /access_token=|refresh_token=|token_type=|expires_in=/.test(to.hash);
  return hasCode || hasOauthError || hasLegacyTokenHash;
}

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  // Recover OAuth/PKCE session from URL before requiresAuth checks; otherwise
  // OAuth may return to `/login?code=...` (see signInWithGoogle redirectTo); session sync runs here.
  if (isSupabaseConfigured()) {
    const { data } = await getSupabaseBrowser().auth.getSession();
    auth.syncSession(data.session);
  }
  if (
    auth.isSignedIn &&
    auth.passwordUserNeedsEmailVerification &&
    to.name !== "login"
  ) {
    return {
      name: "login",
      query: {
        redirect: to.fullPath,
        verify: "required",
      },
    };
  }

  if (to.name === "console-access-pending") {
    if (!auth.isSignedIn) {
      return { name: "login", query: { redirect: to.fullPath } };
    }
    await auth.refreshSuperAdminRole();
    if (auth.isPlatformStaff) {
      const r = to.query.redirect;
      if (typeof r === "string" && r.startsWith("/") && !r.startsWith("//")) {
        return r;
      }
      return { name: "admin" };
    }
    return true;
  }

  if (to.meta.requiresAuth && !auth.isSignedIn) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  // In some hosted setups OAuth may return to `/` (SITE_URL fallback) instead of `/login`.
  // If the callback already established a session, route users to their app shell.
  if (auth.isSignedIn && isOauthReturnOnHome(to)) {
    await auth.refreshSuperAdminRole();
    if (auth.isSuperAdmin) return { name: "admin" };
    return { name: "dashboard" };
  }
  if (to.meta.requiresSuperAdmin) {
    if (!auth.isSignedIn) {
      return { name: "login", query: { redirect: to.fullPath } };
    }
    // /admin is super-admin only. Always await role resolution before allowing
    // route entry to prevent non-admin users from briefly rendering admin views.
    await auth.refreshSuperAdminRole();
    if (!auth.isSuperAdmin) {
      return { name: "dashboard" };
    }
    return true;
  }
  return true;
});

export default router;
