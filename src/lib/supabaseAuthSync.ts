import type { Pinia } from 'pinia'
import { getSupabaseBrowser, isSupabaseConfigured } from './supabase'
import { useAuthStore } from '../stores/auth'

/**
 * Hydrates Pinia from Supabase and keeps it in sync. Call once after `app.use(pinia)`.
 */
export function initSupabaseAuth(pinia: Pinia) {
  if (!isSupabaseConfigured()) return

  const auth = useAuthStore(pinia)
  const supabase = getSupabaseBrowser()

  void supabase.auth.getSession().then(({ data }) => {
    auth.syncSession(data.session)
    if (data.session?.user) void auth.flushPendingSignupPlanToMetadata()
  })

  supabase.auth.onAuthStateChange((_event, nextSession) => {
    auth.syncSession(nextSession)
    if (nextSession?.user) void auth.flushPendingSignupPlanToMetadata()
  })
}
