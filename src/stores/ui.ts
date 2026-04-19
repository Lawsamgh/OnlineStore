import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getSupabaseBrowser, isSupabaseConfigured } from '../lib/supabase'

export const useUiStore = defineStore('ui', () => {
  const cartDrawerOpen = ref(false)
  /** Create-store flow as overlay (opened from dashboard nav / CTAs). */
  const createStoreModalOpen = ref(false)
  /** Overview page search (bound from dashboard layout header + DashboardHome). */
  const sellerDashboardSearch = ref('')
  /** One-line context under the greeting on the overview route (set by DashboardHome). */
  const sellerOverviewTagline = ref('')
  /**
   * Super-admin: recent profiles without a console role (Grant access list).
   * Used for the admin shell notification bell badge.
   */
  const adminPendingConsoleGrantCount = ref(0)
  /** Platform staff: `support_tickets` rows with status `open` (bell + notifications). */
  const adminOpenTicketCount = ref(0)
  /**
   * Seller hub: bell badge after console role appears mid-session (super admin granted access).
   * Cleared when the user opens the console or dismisses the notification.
   */
  const sellerConsoleAccessReadyBellCount = ref(0)

  function setAdminPendingConsoleGrantCount(n: number) {
    adminPendingConsoleGrantCount.value = Math.max(0, Math.floor(n))
  }

  function setAdminOpenTicketCount(n: number) {
    adminOpenTicketCount.value = Math.max(0, Math.floor(n))
  }

  function setSellerConsoleAccessReadyBellCount(n: number) {
    sellerConsoleAccessReadyBellCount.value = Math.max(0, Math.floor(n))
  }

  function clearSellerConsoleAccessReadyBell() {
    sellerConsoleAccessReadyBellCount.value = 0
  }

  async function refreshAdminOpenTicketCount() {
    if (!isSupabaseConfigured()) return
    try {
      const { count, error } = await getSupabaseBrowser()
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
      if (error) return
      setAdminOpenTicketCount(count ?? 0)
    } catch {
      /* noop */
    }
  }

  function openCart() {
    cartDrawerOpen.value = true
  }

  function closeCart() {
    cartDrawerOpen.value = false
  }

  function toggleCart() {
    cartDrawerOpen.value = !cartDrawerOpen.value
  }

  function openCreateStoreModal() {
    createStoreModalOpen.value = true
  }

  function closeCreateStoreModal() {
    createStoreModalOpen.value = false
  }

  return {
    cartDrawerOpen,
    createStoreModalOpen,
    sellerDashboardSearch,
    sellerOverviewTagline,
    adminPendingConsoleGrantCount,
    adminOpenTicketCount,
    sellerConsoleAccessReadyBellCount,
    setAdminPendingConsoleGrantCount,
    setAdminOpenTicketCount,
    setSellerConsoleAccessReadyBellCount,
    clearSellerConsoleAccessReadyBell,
    refreshAdminOpenTicketCount,
    openCart,
    closeCart,
    toggleCart,
    openCreateStoreModal,
    closeCreateStoreModal,
  }
})
