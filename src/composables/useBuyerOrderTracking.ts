import { getSupabaseBrowser, isSupabaseConfigured } from "../lib/supabase";

export type BuyerOrderTrackingRow = {
  order_ref: string;
  status: string;
  created_at: string;
  updated_at: string;
  item_count: number;
  item_units: number;
  delivery_stage: string;
  delivery_updated_at: string | null;
};

export async function lookupBuyerOrderStatus(input: {
  storeSlug: string;
  orderRef: string;
  verify: string;
}): Promise<{ row: BuyerOrderTrackingRow | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { row: null, error: "Tracking is unavailable." };
  }
  const supabase = getSupabaseBrowser();
  const payload = {
    store_slug: input.storeSlug.trim(),
    order_ref: input.orderRef.trim(),
    verify: input.verify.trim(),
  };
  let data: unknown = null;
  let error: { message: string } | null = null;

  const fnRes = await supabase.functions.invoke("track-order-safe", {
    body: payload,
  });
  if (!fnRes.error) {
    const body = fnRes.data as { row?: unknown } | null;
    data = body?.row ?? null;
  } else {
    // Safe fallback during rollout when function is not deployed yet.
    const fallback = await supabase.rpc("lookup_buyer_order_status", {
      p_store_slug: payload.store_slug,
      p_order_ref: payload.order_ref,
      p_verify: payload.verify,
    });
    data = fallback.data;
    error = fallback.error ? { message: fallback.error.message } : null;
  }

  if (error) {
    return { row: null, error: error.message };
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const raw = rows[0] as Record<string, unknown> | undefined;
  if (!raw || typeof raw.order_ref !== "string") {
    return { row: null, error: null };
  }

  return {
    row: {
      order_ref: raw.order_ref as string,
      status: String(raw.status ?? ""),
      created_at: String(raw.created_at ?? ""),
      updated_at: String(raw.updated_at ?? ""),
      item_count: Number(raw.item_count ?? 0),
      item_units: Number(raw.item_units ?? 0),
      delivery_stage: String(raw.delivery_stage ?? "pending"),
      delivery_updated_at:
        raw.delivery_updated_at == null
          ? null
          : String(raw.delivery_updated_at),
    },
    error: null,
  };
}
