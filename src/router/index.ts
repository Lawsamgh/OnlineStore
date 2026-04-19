import { createRouter, createWebHistory } from "vue-router";
import { getSupabaseBrowser, isSupabaseConfigured } from "../lib/supabase";
import { useAuthStore } from "../stores/auth";
import CheckoutView from "../views/store/CheckoutView.vue";
import OrderSuccessView from "../views/store/OrderSuccessView.vue";
import StoreView from "../views/store/StoreView.vue";
import CreateStoreView from "../views/dashboard/CreateStoreView.vue";
import DashboardHome from "../views/dashboard/DashboardHome.vue";
import DashboardLayout from "../views/dashboard/DashboardLayout.vue";
import StoreManageView from "../views/dashboard/StoreManageView.vue";
import AdminAnnouncementsView from "../views/admin/AnnouncementsView.vue";
import AdminHomeView from "../views/admin/AdminHomeView.vue";
import PlatformSettingsView from "../views/admin/PlatformSettingsView.vue";
import SupportTicketsView from "../views/admin/SupportTicketsView.vue";
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
      ],
    },
    {
      path: "/:storeSlug/checkout",
      name: "store-checkout",
      component: CheckoutView,
    },
    {
      path: "/:storeSlug/order/:orderId/success",
      name: "order-success",
      component: OrderSuccessView,
    },
    {
      path: "/:storeSlug",
      name: "store",
      component: StoreView,
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  // Recover OAuth/PKCE session from URL before requiresAuth checks; otherwise
  // OAuth may return to `/login?code=...` (see signInWithGoogle redirectTo); session sync runs here.
  if (isSupabaseConfigured()) {
    const { data } = await getSupabaseBrowser().auth.getSession();
    auth.syncSession(data.session);
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
  if (to.meta.requiresSuperAdmin) {
    if (!auth.isSignedIn) {
      return { name: "login", query: { redirect: to.fullPath } };
    }
    await auth.refreshSuperAdminRole();
    if (!auth.isPlatformStaff) {
      // Stay on /admin shell: DashboardLayout shows blocking overlay + skips child views.
      // (Redirect to console-access-pending would prevent that overlay from ever mounting.)
      return true;
    }
  }
  return true;
});

export default router;
