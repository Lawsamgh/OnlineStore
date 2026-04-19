import { defineStore } from "pinia";
import { ref } from "vue";

export type ToastType = "success" | "error" | "info";

export type ToastItem = {
  id: number;
  type: ToastType;
  message: string;
};

let idSeq = 0;

export const useToastStore = defineStore("toast", () => {
  const items = ref<ToastItem[]>([]);

  function dismiss(id: number) {
    items.value = items.value.filter((t) => t.id !== id);
  }

  function push(
    type: ToastType,
    message: string,
    durationMs?: number,
  ): number {
    const id = ++idSeq;
    items.value.push({ id, type, message });
    const ms =
      durationMs ??
      (type === "error" ? 8000 : type === "info" ? 6500 : 4500);
    if (ms > 0) window.setTimeout(() => dismiss(id), ms);
    return id;
  }

  function success(message: string) {
    return push("success", message);
  }

  function error(message: string) {
    return push("error", message);
  }

  function info(message: string) {
    return push("info", message);
  }

  return { items, push, dismiss, success, error, info };
});
