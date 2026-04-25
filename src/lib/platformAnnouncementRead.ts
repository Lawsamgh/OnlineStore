/** localStorage: last time seller acknowledged platform announcements (bell). */

export function platformAnnouncementsReadKey(userId: string): string {
  return `uanditech:platform-ann-read:${userId}`
}

export function getPlatformAnnouncementsLastReadIso(userId: string): string | null {
  if (typeof window === "undefined" || !userId) return null
  try {
    const raw = window.localStorage.getItem(platformAnnouncementsReadKey(userId))
    const t = typeof raw === "string" ? raw.trim() : ""
    if (!t) return null
    const ms = new Date(t).getTime()
    return Number.isFinite(ms) ? t : null
  } catch {
    return null
  }
}

export function setPlatformAnnouncementsLastReadIso(
  userId: string,
  iso: string,
): void {
  if (typeof window === "undefined" || !userId) return
  try {
    window.localStorage.setItem(platformAnnouncementsReadKey(userId), iso)
  } catch {
    /* noop */
  }
}
