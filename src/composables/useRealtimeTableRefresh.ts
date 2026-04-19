import type { RealtimeChannel } from "@supabase/supabase-js";
import { onBeforeUnmount, watch, type WatchSource } from "vue";
import { getSupabaseBrowser, isSupabaseConfigured } from "../lib/supabase";

export type RealtimeTableSpec = {
  table: string;
  /** PostgREST-style filter, e.g. `store_id=eq.<uuid>`. Omit to receive all rows allowed by RLS. */
  filter?: string;
};

type ChannelName = string | (() => string);

type Options = {
  channelName: ChannelName;
  /** When any value changes, the Realtime subscription is torn down and rebuilt. */
  deps: WatchSource | WatchSource[];
  getTables: () => RealtimeTableSpec[];
  onEvent: () => void | Promise<void>;
  /** Coalesce bursts of writes into one refresh (default 450ms). */
  debounceMs?: number;
};

function resolveChannelName(name: ChannelName): string {
  return typeof name === "function" ? name() : name;
}

/**
 * Subscribe to `postgres_changes` on one or more tables and run `onEvent` after a short debounce.
 * Tear-down is automatic on unmount; `deps` trigger resubscribe when filters/scope change.
 */
export function useRealtimeTableRefresh(opts: Options) {
  const debounceMs = opts.debounceMs ?? 450;
  let channel: RealtimeChannel | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function schedule() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void opts.onEvent();
    }, debounceMs);
  }

  function unsubscribe() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (channel && isSupabaseConfigured()) {
      void getSupabaseBrowser().removeChannel(channel);
    }
    channel = null;
  }

  function subscribe() {
    unsubscribe();
    if (!isSupabaseConfigured()) return;

    const tables = opts.getTables();
    if (!tables.length) return;

    const sb = getSupabaseBrowser();
    const name = resolveChannelName(opts.channelName);
    let ch = sb.channel(name);
    for (const t of tables) {
      ch = ch.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: t.table,
          ...(t.filter ? { filter: t.filter } : {}),
        },
        () => {
          schedule();
        },
      );
    }
    void ch.subscribe();
    channel = ch;
  }

  watch(opts.deps, subscribe, { immediate: true });

  onBeforeUnmount(unsubscribe);
}
