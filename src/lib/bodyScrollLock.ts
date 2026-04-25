const activeLocks = new Set<string>();
let previousBodyOverflow = "";

function syncBodyOverflow() {
  if (typeof document === "undefined") return;
  if (activeLocks.size > 0) {
    document.body.style.overflow = "hidden";
    return;
  }
  document.body.style.overflow = previousBodyOverflow;
}

export function setBodyScrollLocked(lockId: string, locked: boolean) {
  if (typeof document === "undefined") return;
  if (locked) {
    if (activeLocks.size === 0) {
      previousBodyOverflow = document.body.style.overflow;
    }
    activeLocks.add(lockId);
    syncBodyOverflow();
    return;
  }
  activeLocks.delete(lockId);
  syncBodyOverflow();
}

export function clearBodyScrollLock(lockId: string) {
  setBodyScrollLocked(lockId, false);
}
