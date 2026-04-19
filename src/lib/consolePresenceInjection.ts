import type { InjectionKey, ShallowRef } from "vue";

/** Set of `auth.users.id` for platform staff with `/admin` open (Realtime presence). */
export const platformConsolePresenceOnlineKey: InjectionKey<
  ShallowRef<Set<string>>
> = Symbol("platformConsolePresenceOnline");
