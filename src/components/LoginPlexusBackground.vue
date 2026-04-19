<script setup lang="ts">
import { useId } from "vue";

const uid = useId().replace(/[^a-zA-Z0-9]/g, "x");
const maskFadeId = `lp-fade-${uid}`;
const maskId = `lp-mask-${uid}`;

/** Harmonious greens / teals / limes for random strand colors */
const LINE_PALETTE = [
  "#047857",
  "#059669",
  "#10b981",
  "#34d399",
  "#6ee7b7",
  "#0d9488",
  "#14b8a6",
  "#2dd4bf",
  "#5eead4",
  "#15803d",
  "#22c55e",
  "#4ade80",
  "#65a30d",
  "#84cc16",
  "#a3e635",
] as const;

function pickLineColor(): string {
  return LINE_PALETTE[Math.floor(Math.random() * LINE_PALETTE.length)]!;
}

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

function edgeKey(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): string {
  const p1 = `${ax.toFixed(2)},${ay.toFixed(2)}`;
  const p2 = `${bx.toFixed(2)},${by.toFixed(2)}`;
  return p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
}

function pathDFromSegs(
  segs: readonly [number, number, number, number][],
): string {
  return segs
    .map(
      ([ax, ay, bx, by]) =>
        `M${ax.toFixed(1)},${ay.toFixed(1)} L${bx.toFixed(1)},${by.toFixed(1)}`,
    )
    .join(" ");
}

function generateWeb() {
  const R = 58 + Math.random() * 28;
  const n = 44 + Math.floor(Math.random() * 22);
  const pts: { x: number; y: number }[] = [];

  for (let i = 0; i < n; i++) {
    pts.push({
      x: 10 + Math.random() ** 0.68 * 188,
      y: 22 + Math.random() * 978,
    });
  }

  const seen = new Set<string>();
  const coloredSegs: { seg: [number, number, number, number]; color: string }[] =
    [];

  function addSeg(ax: number, ay: number, bx: number, by: number) {
    if (dist(ax, ay, bx, by) < 3) return;
    const k = edgeKey(ax, ay, bx, by);
    if (seen.has(k)) return;
    seen.add(k);
    coloredSegs.push({
      seg: [ax, ay, bx, by],
      color: pickLineColor(),
    });
  }

  for (let i = 0; i < pts.length; i++) {
    const maxN = 3 + (i % 4 === 0 ? 1 : 0);
    const near = pts
      .map((p, j) => ({
        j,
        d: i === j ? Infinity : dist(pts[i].x, pts[i].y, p.x, p.y),
      }))
      .filter((o) => o.d < R)
      .sort((a, b) => a.d - b.d)
      .slice(0, maxN);

    for (const { j } of near) {
      const a = pts[i];
      const b = pts[j];
      addSeg(a.x, a.y, b.x, b.y);
    }
  }

  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const hub = {
    x: mx + (Math.random() - 0.5) * 62,
    y: my + (Math.random() - 0.5) * 140,
  };
  pts.push(hub);

  const withoutHub = pts.slice(0, -1);
  const spokeCount = 6 + Math.floor(Math.random() * 7);
  withoutHub
    .map((p) => ({ p, d: dist(hub.x, hub.y, p.x, p.y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, spokeCount)
    .forEach(({ p }) => addSeg(hub.x, hub.y, p.x, p.y));

  for (let t = 0; t < n * 4; t++) {
    const i = Math.floor(Math.random() * withoutHub.length);
    const j = Math.floor(Math.random() * withoutHub.length);
    if (i === j) continue;
    const a = withoutHub[i];
    const b = withoutHub[j];
    const d = dist(a.x, a.y, b.x, b.y);
    if (d > R * 0.5 && d < R * 1.35 && Math.random() < 0.085) {
      addSeg(a.x, a.y, b.x, b.y);
    }
  }

  for (let e = 0; e < 5; e++) {
    const y = 60 + Math.random() * 900;
    const p = withoutHub[Math.floor(Math.random() * withoutHub.length)];
    addSeg(4 + Math.random() * 6, y, p.x, p.y);
  }

  const byStroke = new Map<string, [number, number, number, number][]>();
  for (const { seg, color } of coloredSegs) {
    const list = byStroke.get(color) ?? [];
    list.push(seg);
    byStroke.set(color, list);
  }
  const meshLayers = [...byStroke.entries()].map(([stroke, segs]) => ({
    stroke,
    d: pathDFromSegs(segs),
  }));

  const silkLayers: { d: string; stroke: string; opacity: number }[] = [];
  for (let s = 0; s < 16; s++) {
    const p = pts[Math.floor(Math.random() * pts.length)];
    const span = 75 + Math.random() * 200;
    const sway = (Math.random() - 0.5) * 140;
    const tx = Math.min(398, p.x + span);
    const ty = Math.max(18, Math.min(1002, p.y + sway));
    silkLayers.push({
      d: `M${p.x.toFixed(1)},${p.y.toFixed(1)} L${tx.toFixed(1)},${ty.toFixed(1)}`,
      stroke: pickLineColor(),
      opacity: 0.07 + Math.random() * 0.06,
    });
  }

  const nodes = pts.map((p) => ({
    ...p,
    fill: pickLineColor(),
  }));

  return { meshLayers, silkLayers, nodes };
}

const { meshLayers, silkLayers, nodes } = generateWeb();
</script>

<template>
  <svg
    class="pointer-events-none absolute inset-0 h-full min-h-svh w-full"
    aria-hidden="true"
    preserveAspectRatio="xMinYMid slice"
    viewBox="0 0 400 1020"
  >
    <defs>
      <linearGradient
        :id="maskFadeId"
        x1="0"
        y1="0"
        x2="1"
        y2="0"
        gradientUnits="objectBoundingBox"
      >
        <stop offset="0%" stop-color="#ffffff" />
        <stop offset="30%" stop-color="#ffffff" />
        <stop offset="100%" stop-color="#000000" />
      </linearGradient>
      <mask :id="maskId">
        <rect width="100%" height="100%" :fill="`url(#${maskFadeId})`" />
      </mask>
    </defs>
    <g
      :mask="`url(#${maskId})`"
      fill="none"
      vector-effect="non-scaling-stroke"
    >
      <path
        v-for="(layer, i) in meshLayers"
        :key="`mesh-${i}`"
        :d="layer.d"
        :stroke="layer.stroke"
        stroke-opacity="0.18"
        stroke-width="0.48"
      />
      <path
        v-for="(silk, i) in silkLayers"
        :key="`silk-${i}`"
        :d="silk.d"
        :stroke="silk.stroke"
        :stroke-opacity="silk.opacity"
        stroke-width="0.42"
      />
    </g>
    <g :mask="`url(#${maskId})`" stroke="none">
      <circle
        v-for="(p, i) in nodes"
        :key="i"
        :cx="p.x"
        :cy="p.y"
        :fill="p.fill"
        fill-opacity="0.32"
        r="0.9"
      />
    </g>
  </svg>
</template>
