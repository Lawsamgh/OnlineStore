import type { Session, SupabaseClient } from "@supabase/supabase-js";

/**
 * Refreshes the access token and returns headers required for Edge Functions
 * (`verify_jwt` + `auth.getUser()` inside the function).
 */
export async function refreshSessionForEdgeFunctions(
  sb: SupabaseClient,
): Promise<
  | { ok: true; headers: Record<string, string>; session: Session }
  | { ok: false; message: string }
> {
  const { data, error } = await sb.auth.refreshSession();
  const session = data.session;
  if (error || !session?.access_token) {
    return {
      ok: false,
      message:
        error?.message ??
        "Your session expired. Sign out, sign in again, then retry.",
    };
  }
  return {
    ok: true,
    headers: { Authorization: `Bearer ${session.access_token}` },
    session,
  };
}
