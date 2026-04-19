import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let browserClient: SupabaseClient | null = null

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey)
}

/**
 * Singleton browser client. Call only when env vars are set
 * (see {@link isSupabaseConfigured}).
 */
export function getSupabaseBrowser(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.',
    )
  }
  if (!browserClient) {
    browserClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return browserClient
}
