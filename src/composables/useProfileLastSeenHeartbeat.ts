import { onScopeDispose, watch } from "vue";
import { getSupabaseBrowser, isSupabaseConfigured } from "../lib/supabase";

const INTERVAL_MS = 25_000;

/**
 * Throttled `profiles.last_seen_at` updates while `enabled` — backs “Live” when
 * Realtime presence is unavailable or delayed.
 */
export function useProfileLastSeenHeartbeat(opts: {
  enabled: () => boolean;
  userId: () => string | null;
}) {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function ping() {
    const uid = opts.userId();
    if (!uid || !opts.enabled() || !isSupabaseConfigured()) return;
    const sb = getSupabaseBrowser();
    const ts = new Date().toISOString();
    const { error } = await sb
      .from("profiles")
      .update({ last_seen_at: ts })
      .eq("id", uid);
    if (error) {
      /* column missing until migration applied — avoid console spam */
    }
  }

  function onVisible() {
    if (typeof document === "undefined") return;
    if (document.visibilityState !== "visible") return;
    void ping();
  }

  watch(
    [() => Boolean(opts.enabled()), () => opts.userId()],
    () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
      if (!opts.enabled() || !opts.userId() || !isSupabaseConfigured()) return;
      void ping();
      intervalId = setInterval(() => void ping(), INTERVAL_MS);
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisible);
      }
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisible);
    }
  });
}
