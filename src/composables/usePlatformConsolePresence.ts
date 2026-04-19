import { onScopeDispose, shallowRef, watch, type ShallowRef } from "vue";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowser, isSupabaseConfigured } from "../lib/supabase";

const CHANNEL_NAME = "platform-console-staff";

/**
 * Supabase Realtime presence: each subscriber uses `presence.key` = their user id.
 * While `enabled` is true, the current user is tracked; `onlineUserIds` lists everyone
 * in the channel (platform staff with Seller hub or Console open in this browser).
 */
export function usePlatformConsolePresence(opts: {
  enabled: () => boolean;
  userId: () => string | null;
}): { onlineUserIds: ShallowRef<Set<string>> } {
  const onlineUserIds = shallowRef(new Set<string>());
  let channel: RealtimeChannel | null = null;
  let setupGen = 0;

  function applyPresenceState(c: RealtimeChannel) {
    const state = c.presenceState() as Record<
      string,
      Array<Record<string, unknown>>
    >;
    const next = new Set<string>();
    for (const [key, metas] of Object.entries(state)) {
      if (key) next.add(key);
      if (!Array.isArray(metas)) continue;
      for (const m of metas) {
        const uid =
          m && typeof m["user_id"] === "string" ? (m["user_id"] as string) : null;
        if (uid) next.add(uid);
      }
    }
    onlineUserIds.value = next;
  }

  async function tearDown() {
    const c = channel;
    channel = null;
    if (!c) {
      onlineUserIds.value = new Set();
      return;
    }
    try {
      await c.untrack();
    } catch {
      /* channel may already be torn down */
    }
    try {
      await getSupabaseBrowser().removeChannel(c);
    } catch {
      /* noop */
    }
    onlineUserIds.value = new Set();
  }

  async function setup() {
    const myGen = ++setupGen;
    await tearDown();
    if (myGen !== setupGen) return;
    if (!opts.enabled() || !opts.userId() || !isSupabaseConfigured()) return;

    const uid = opts.userId()!;
    const sb = getSupabaseBrowser();
    const ch = sb.channel(CHANNEL_NAME, {
      config: {
        presence: { key: uid },
      },
    });
    channel = ch;

    ch.on("presence", { event: "sync" }, () => {
      if (channel === ch) applyPresenceState(ch);
    })
      .on("presence", { event: "join" }, () => {
        if (channel === ch) applyPresenceState(ch);
      })
      .on("presence", { event: "leave" }, () => {
        if (channel === ch) applyPresenceState(ch);
      });

    ch.subscribe(async (status) => {
      if (myGen !== setupGen || channel !== ch) return;
      if (status === "SUBSCRIBED") {
        await ch.track({
          user_id: uid,
          scope: "platform_staff_app",
        });
        if (channel === ch) applyPresenceState(ch);
      }
    });
  }

  watch(
    [() => Boolean(opts.enabled()), () => opts.userId()],
    () => {
      void setup();
    },
    { immediate: true },
  );

  function onDocumentVisible() {
    if (typeof document === "undefined") return;
    if (document.visibilityState !== "visible") return;
    const c = channel;
    if (!c || !opts.enabled() || !opts.userId()) return;
    void c
      .track({
        user_id: opts.userId()!,
        scope: "platform_staff_app",
      })
      .then(() => {
        if (channel === c) applyPresenceState(c);
      })
      .catch(() => {
        /* noop */
      });
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onDocumentVisible);
  }

  onScopeDispose(() => {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onDocumentVisible);
    }
    setupGen++;
    void tearDown();
  });

  return { onlineUserIds };
}
