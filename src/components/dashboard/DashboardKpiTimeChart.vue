<script setup lang="ts">
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { KpiSample } from "../../lib/dashboardKpiHistory";
import {
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from "vue";

const props = defineProps<{
  points: readonly KpiSample[];
  stroke: string;
  fill: string;
  /** Axis / grid tint (matches card theme) */
  axisStroke: string;
  gridStroke: string;
}>();

const root = ref<HTMLDivElement | null>(null);
const plotRef = shallowRef<uPlot | null>(null);

const fmtTime = uPlot.fmtDate("{MM}/{DD} {HH}:{mm}");

function toAlignedData(): uPlot.AlignedData {
  const sorted = [...props.points].sort((a, b) => a.t - b.t);
  if (sorted.length === 0) {
    const now = Date.now() / 1000;
    return [
      [now - 3600, now],
      [0, 0],
    ];
  }
  const xs = sorted.map((p) => p.t / 1000);
  const ys = sorted.map((p) => p.v);
  if (sorted.length === 1) {
    const x0 = xs[0]!;
    const y0 = ys[0]!;
    return [
      [x0 - 120, x0 + 120],
      [y0, y0],
    ];
  }
  return [xs, ys];
}

function buildOpts(width: number, height: number): uPlot.Options {
  return {
    width: Math.max(120, Math.floor(width)),
    height: Math.max(80, Math.floor(height)),
    pxAlign: false,
    class: "dashboard-kpi-uplot",
    cursor: {
      show: true,
      x: true,
      y: false,
      points: {
        show: true,
        size: 9,
        width: 2,
        stroke: "#ffffff",
        fill: props.stroke,
      },
      drag: { x: false, y: false, setScale: false },
    },
    legend: { show: false },
    scales: {
      x: { time: true },
      y: {
        range: (_u, min, max) => {
          if (min === max) {
            const m = min;
            return [m - 0.75, m + 0.75];
          }
          const pad = Math.max(0.5, (max - min) * 0.12);
          return [min - pad, max + pad];
        },
      },
    },
    series: [
      {},
      {
        stroke: props.stroke,
        fill: props.fill,
        width: 2,
        spanGaps: true,
      },
    ],
    axes: [
      {
        stroke: props.axisStroke,
        grid: { show: true, stroke: props.gridStroke, width: 1 },
        ticks: { show: true, stroke: props.axisStroke },
        font: "10px ui-sans-serif, system-ui, sans-serif",
        values: (_u, vals) =>
          vals.map((v) => fmtTime(new Date((v as number) * 1000))),
      },
      {
        stroke: props.axisStroke,
        grid: { show: false },
        ticks: { show: true, stroke: props.axisStroke },
        size: 30,
        font: "10px ui-sans-serif, system-ui, sans-serif",
        values: (_u, vals) =>
          vals.map((v) => {
            const n = Number(v);
            return Number.isInteger(n) ? String(n) : n.toFixed(1);
          }),
      },
    ],
    hooks: {
      setCursor: [
        (u) => {
          const idx = u.cursor.idx;
          if (idx == null || idx < 0) {
            u.root.removeAttribute("title");
            return;
          }
          const ts = u.data[0]![idx] as number;
          const val = u.data[1]![idx];
          const tStr = fmtTime(new Date(ts * 1000));
          u.root.title =
            val == null ? tStr : `${tStr} · ${Number(val).toLocaleString()}`;
        },
      ],
    },
  };
}

function mountPlot() {
  const el = root.value;
  if (!el) return;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (w < 8 || h < 8) return;
  plotRef.value?.destroy();
  plotRef.value = null;
  const opts = buildOpts(w, h);
  plotRef.value = new uPlot(opts, toAlignedData(), el);
}

let ro: ResizeObserver | null = null;

onMounted(() => {
  void nextTick(() => {
    mountPlot();
    const el = root.value;
    if (!el || typeof ResizeObserver === "undefined") return;
    ro = new ResizeObserver(() => {
      const p = plotRef.value;
      const host = root.value;
      if (!p || !host) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w >= 8 && h >= 8) p.setSize({ width: Math.floor(w), height: Math.floor(h) });
    });
    ro.observe(el);
  });
});

onUnmounted(() => {
  ro?.disconnect();
  ro = null;
  plotRef.value?.destroy();
  plotRef.value = null;
});

watch(
  () => props.points,
  () => {
    const p = plotRef.value;
    if (p) p.setData(toAlignedData());
    else void nextTick(() => mountPlot());
  },
  { deep: true },
);
</script>

<template>
  <div
    ref="root"
    class="dashboard-kpi-time-chart h-full min-h-[7rem] w-full sm:min-h-[8rem] lg:min-h-[9rem]"
    role="img"
    :aria-label="'Metric over time, ' + points.length + ' samples'"
  />
</template>

<style scoped>
.dashboard-kpi-time-chart :deep(.uplot) {
  font-family: ui-sans-serif, system-ui, sans-serif;
}
</style>
