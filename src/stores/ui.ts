import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getSupabaseBrowser, isSupabaseConfigured } from '../lib/supabase'
import {
  getPlatformAnnouncementsLastReadIso,
  setPlatformAnnouncementsLastReadIso,
} from '../lib/platformAnnouncementRead'

export type SellerPlatformAnnouncementRow = {
  id: string
  title: string
  message: string
  type: string
  created_at: string
}

export const useUiStore = defineStore('ui', () => {
  const cartDrawerOpen = ref(false)
  /** Create-store flow as overlay (opened from dashboard nav / CTAs). */
  const createStoreModalOpen = ref(false)
  /** When true, create-store modal cannot be dismissed until first store exists. */
  const createStoreModalForced = ref(false)
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
  /**
   * Seller hub: orders on your stores that are not finished (not delivered or canceled).
   * Refreshed from the database + Realtime; matches dashboard order_status enum.
   */
  const sellerNewOrderBellCount = ref(0)
  /**
   * Seller hub: unread platform announcements (vs last “read” time in localStorage).
   * Rows for the notifications panel (newest first, same cap as dashboard query).
   */
  const sellerPlatformAnnouncementBellCount = ref(0)
  const sellerPlatformAnnouncementsPreview = ref<SellerPlatformAnnouncementRow[]>(
    [],
  )
  /** Global auth notice shown when session ends unexpectedly. */
  const sessionExpiredModalOpen = ref(false)
  const sessionExpiredMessage = ref(
    'Your session has expired. Please sign in again.',
  )

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

  function setSellerNewOrderBellCount(n: number) {
    sellerNewOrderBellCount.value = Math.max(0, Math.min(9999, Math.floor(n)))
  }

  function clearSellerNewOrderBellCount() {
    sellerNewOrderBellCount.value = 0
  }

  function syncSellerPlatformAnnouncements(
    userId: string,
    rows: SellerPlatformAnnouncementRow[],
  ) {
    if (!userId) {
      sellerPlatformAnnouncementBellCount.value = 0
      sellerPlatformAnnouncementsPreview.value = []
      return
    }
    sellerPlatformAnnouncementsPreview.value = rows.slice()
    const lastIso = getPlatformAnnouncementsLastReadIso(userId)
    const lastMs = lastIso ? new Date(lastIso).getTime() : 0
    let unread = 0
    for (const r of rows) {
      const t = new Date(r.created_at).getTime()
      if (Number.isFinite(t) && t > lastMs) unread += 1
    }
    sellerPlatformAnnouncementBellCount.value = Math.min(99, unread)
  }

  function markSellerPlatformAnnouncementsRead(userId: string) {
    if (!userId) return
    setPlatformAnnouncementsLastReadIso(userId, new Date().toISOString())
    sellerPlatformAnnouncementBellCount.value = 0
  }

  function showSessionExpiredModal(message?: string) {
    sessionExpiredMessage.value =
      typeof message === 'string' && message.trim().length > 0
        ? message.trim()
        : 'Your session has expired. Please sign in again.'
    sessionExpiredModalOpen.value = true
  }

  function hideSessionExpiredModal() {
    sessionExpiredModalOpen.value = false
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

  async function refreshAdminPendingConsoleGrantCount() {
    if (!isSupabaseConfigured()) return
    try {
      const { data, error } = await getSupabaseBrowser().rpc(
        'admin_pending_console_grant_count',
      )
      if (error) return
      const raw = data as unknown
      const n =
        typeof raw === 'bigint'
          ? Number(raw)
          : typeof raw === 'number'
            ? raw
            : typeof raw === 'string'
              ? Number.parseInt(raw, 10)
              : Number.NaN
      setAdminPendingConsoleGrantCount(Number.isFinite(n) ? n : 0)
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
    if (createStoreModalForced.value) return
    createStoreModalOpen.value = false
  }

  function setCreateStoreModalForced(v: boolean) {
    createStoreModalForced.value = !!v
  }

  return {
    cartDrawerOpen,
    createStoreModalOpen,
    createStoreModalForced,
    sellerDashboardSearch,
    sellerOverviewTagline,
    adminPendingConsoleGrantCount,
    adminOpenTicketCount,
    sellerConsoleAccessReadyBellCount,
    sellerNewOrderBellCount,
    sellerPlatformAnnouncementBellCount,
    sellerPlatformAnnouncementsPreview,
    sessionExpiredModalOpen,
    sessionExpiredMessage,
    setAdminPendingConsoleGrantCount,
    setAdminOpenTicketCount,
    setSellerConsoleAccessReadyBellCount,
    clearSellerConsoleAccessReadyBell,
    setSellerNewOrderBellCount,
    clearSellerNewOrderBellCount,
    syncSellerPlatformAnnouncements,
    markSellerPlatformAnnouncementsRead,
    showSessionExpiredModal,
    hideSessionExpiredModal,
    refreshAdminOpenTicketCount,
    refreshAdminPendingConsoleGrantCount,
    openCart,
    closeCart,
    toggleCart,
    openCreateStoreModal,
    closeCreateStoreModal,
    setCreateStoreModalForced,
  }
})
