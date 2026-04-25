<script setup lang="ts">
import { computed } from "vue";
import VChart from "vue-echarts";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { BarChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import type { EChartsOption } from "echarts";
import { formatGhs } from "../../lib/formatMoney";

use([
  CanvasRenderer,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
]);

export type CashflowMonthBin = {
  key: string;
  label: string;
  incomeGhs: number;
  feeGhs: number;
};

const props = defineProps<{
  months: readonly CashflowMonthBin[];
}>();

function ghsFromFloat(g: number) {
  return formatGhs(Math.round(g * 100));
}

const chartOption = computed<EChartsOption>(() => {
  const labels = props.months.map((m) => m.label);
  const paid = props.months.map((m) => Number(m.incomeGhs.toFixed(2)));
  const fees = props.months.map((m) => Number(m.feeGhs.toFixed(2)));

  return {
    animationDuration: 600,
    animationEasing: "cubicOut",
    grid: { top: 40, right: 10, bottom: 36, left: 10, containLabel: true },
    legend: {
      top: 2,
      left: 8,
      itemWidth: 9,
      itemHeight: 9,
      icon: "roundRect",
      textStyle: { color: "#334155", fontSize: 12, fontWeight: 600 },
      data: ["Paid", "Fees"],
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "rgba(255, 255, 255, 0.98)",
      borderColor: "rgba(148, 163, 184, 0.35)",
      borderWidth: 1,
      textStyle: { color: "#0f172a" },
      padding: [8, 10],
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [];
        const first = list[0] as
          | { dataIndex?: number; axisValue?: string }
          | undefined;
        const i = typeof first?.dataIndex === "number" ? first.dataIndex : 0;
        const month = props.months[i];
        if (!month) return "";
        const net = month.incomeGhs - month.feeGhs;
        const netTone = net >= 0 ? "#047857" : "#be123c";
        return [
          `<div style="font-weight:700;margin-bottom:5px">${first?.axisValue ?? month.label}</div>`,
          `<div style="font-size:12px;color:#334155">Paid: <b style="color:#047857">${ghsFromFloat(month.incomeGhs)}</b></div>`,
          `<div style="font-size:12px;color:#334155">Fees: <b style="color:#0f766e">${ghsFromFloat(month.feeGhs)}</b></div>`,
          `<div style="font-size:12px;margin-top:3px;color:#334155">Net: <b style="color:${netTone}">${ghsFromFloat(net)}</b></div>`,
        ].join("");
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "rgba(15, 23, 42, 0.08)" } },
      axisLabel: { color: "#475569", fontSize: 11 },
    },
    yAxis: {
      type: "value",
      min: 0,
      axisLabel: { show: false },
      splitLine: { lineStyle: { color: "rgba(16, 185, 129, 0.15)" } },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        name: "Paid",
        type: "bar",
        data: paid,
        stack: "cashflow",
        barWidth: 70,
        barMinHeight: 3,
        emphasis: {
          focus: "series",
          itemStyle: { color: "#047857" },
        },
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: "#059669",
        },
      },
      {
        name: "Fees",
        type: "bar",
        data: fees,
        stack: "cashflow",
        barWidth: 70,
        barMinHeight: 2,
        emphasis: { focus: "series" },
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: "#a7f3d0",
        },
      },
    ],
  };
});
</script>

<template>
  <div
    class="h-full min-h-[20rem] overflow-hidden rounded-2xl border border-emerald-100/80 bg-white shadow-[0_10px_32px_-18px_rgba(5,150,105,0.22)]"
  >
    <VChart autoresize class="h-full w-full" :option="chartOption" />
  </div>
</template>
