import type { User } from "@supabase/supabase-js";

/**
 * Human-friendly name for greetings: prefers `user_metadata.full_name`, then
 * `name` (common for OAuth), then a title-cased local part of email.
 */
export function userDisplayName(user: User | null | undefined): string {
  if (!user) return "there";
  const meta = user.user_metadata;
  const full =
    typeof meta?.full_name === "string" ? meta.full_name.trim() : "";
  if (full) return full.replace(/\s+/g, " ");
  const oauthName = typeof meta?.name === "string" ? meta.name.trim() : "";
  if (oauthName) return oauthName.replace(/\s+/g, " ");
  const e = user.email;
  if (!e) return "there";
  const local = e.split("@")[0] ?? "there";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
