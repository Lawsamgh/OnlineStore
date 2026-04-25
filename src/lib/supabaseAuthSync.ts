import type { Router } from 'vue-router'
import type { Pinia } from 'pinia'
import { getSupabaseBrowser, isSupabaseConfigured } from './supabase'
import { useAuthStore } from '../stores/auth'
import { useUiStore } from '../stores/ui'

/**
 * Hydrates Pinia from Supabase and keeps it in sync. Call once after `app.use(pinia)`.
 */
export function initSupabaseAuth(pinia: Pinia, router?: Router) {
  if (!isSupabaseConfigured()) return

  const auth = useAuthStore(pinia)
  const ui = useUiStore(pinia)
  const supabase = getSupabaseBrowser()

  void supabase.auth.getSession().then(({ data }) => {
    auth.syncSession(data.session)
    if (data.session?.user) void auth.flushPendingSignupPlanToMetadata()
  })

  supabase.auth.onAuthStateChange((event, nextSession) => {
    const hadSession = auth.isSignedIn

    auth.syncSession(nextSession)
    if (nextSession?.user) void auth.flushPendingSignupPlanToMetadata()
    if (
      nextSession?.user &&
      (event === "SIGNED_IN" || event === "INITIAL_SESSION")
    ) {
      void auth.notifySuperAdminNewSellerJoinIfNeeded()
    }

    // Detect unexpected session expiry (not a manual sign-out, not the initial load)
    if (
      event === 'SIGNED_OUT' &&
      hadSession &&
      !auth.isManualSignOut &&
      router
    ) {
      ui.showSessionExpiredModal('Your session has expired. Please sign in again.')
      void router.replace({ name: 'login', query: { reason: 'expired' } })
    }
  })
}
