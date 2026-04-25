/**
 * Copy text using a hidden textarea + execCommand (works on many mobile browsers
 * where async Clipboard API fails or requires extra permissions).
 */
function copyViaExecCommand(text: string): boolean {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.setAttribute("aria-hidden", "true");
    el.tabIndex = -1;
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.top = "0";
    el.style.opacity = "0";
    /** iOS: avoid zoom-on-focus; keep text selectable */
    el.style.fontSize = "16px";
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Best-effort copy: runs execCommand first (same call stack as click — important
 * for iOS Safari), then Clipboard API when available.
 */
export function copyTextToClipboard(text: string): Promise<boolean> {
  if (copyViaExecCommand(text)) {
    return Promise.resolve(true);
  }
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard?.writeText &&
    typeof window !== "undefined" &&
    window.isSecureContext
  ) {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => false);
  }
  return Promise.resolve(false);
}
