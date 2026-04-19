/** Wall-clock samples for dashboard KPI charts (browser-local, per user). */

export type KpiSample = { t: number; v: number };

const MAX_POINTS = 2500;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const MIN_GAP_MS = 45_000;

function nowMs() {
  return Date.now();
}

function prune(points: KpiSample[]): KpiSample[] {
  const cutoff = nowMs() - MAX_AGE_MS;
  const fresh = points.filter((p) => p.t >= cutoff);
  if (fresh.length <= MAX_POINTS) return fresh;
  return fresh.slice(-MAX_POINTS);
}

export function loadKpiHistory(storageKey: string | null): KpiSample[] {
  if (!storageKey || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: KpiSample[] = [];
    for (const row of parsed) {
      if (
        row &&
        typeof row === "object" &&
        typeof (row as KpiSample).t === "number" &&
        typeof (row as KpiSample).v === "number"
      ) {
        out.push({ t: (row as KpiSample).t, v: (row as KpiSample).v });
      }
    }
    return prune(out).sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

export function saveKpiHistory(storageKey: string | null, points: KpiSample[]) {
  if (!storageKey || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(prune(points)));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Append a sample when the value changed or enough time passed since the last point.
 * Keeps a truthful time axis without spamming identical points every second.
 */
export function recordKpiSample(
  points: KpiSample[],
  value: number,
  opts?: { force?: boolean },
): KpiSample[] {
  const t = nowMs();
  const last = points[points.length - 1];
  const force = opts?.force === true;
  if (last && !force) {
    if (last.v === value && t - last.t < MIN_GAP_MS) return prune(points);
  }
  const next = [...points, { t, v: value }];
  return prune(next);
}
