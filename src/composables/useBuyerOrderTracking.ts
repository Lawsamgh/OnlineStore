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

export type BuyerReviewableOrderItem = {
  product_id: string;
  product_title: string;
  already_reviewed: boolean;
  existing_rating: number | null;
  existing_comment: string | null;
  existing_reviewer_name: string | null;
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

export async function lookupBuyerReviewableItems(input: {
  storeSlug: string;
  orderRef: string;
  verify: string;
}): Promise<{ items: BuyerReviewableOrderItem[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { items: [], error: "Tracking is unavailable." };
  }
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.rpc("buyer_order_reviewable_items", {
    p_store_slug: input.storeSlug.trim(),
    p_order_ref: input.orderRef.trim(),
    p_verify: input.verify.trim(),
  });
  if (error) {
    return { items: [], error: error.message };
  }
  const rows = Array.isArray(data) ? data : [];
  return {
    items: rows
      .map((r) => r as Record<string, unknown>)
      .filter((r) => typeof r.product_id === "string")
      .map((r) => ({
        product_id: String(r.product_id),
        product_title: String(r.product_title ?? "Product"),
        already_reviewed: Boolean(r.already_reviewed),
        existing_rating:
          typeof r.existing_rating === "number" && Number.isFinite(r.existing_rating)
            ? r.existing_rating
            : null,
        existing_comment:
          typeof r.existing_comment === "string" && r.existing_comment.trim()
            ? r.existing_comment.trim()
            : null,
        existing_reviewer_name:
          typeof r.existing_reviewer_name === "string" &&
          r.existing_reviewer_name.trim()
            ? r.existing_reviewer_name.trim()
            : null,
      })),
    error: null,
  };
}

export async function submitBuyerProductReview(input: {
  storeSlug: string;
  orderRef: string;
  verify: string;
  productId: string;
  rating: number;
  comment?: string;
  reviewerName?: string;
}): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Tracking is unavailable." };
  }
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.rpc("submit_buyer_product_review", {
    p_store_slug: input.storeSlug.trim(),
    p_order_ref: input.orderRef.trim(),
    p_verify: input.verify.trim(),
    p_product_id: input.productId.trim(),
    p_rating: Math.trunc(input.rating),
    p_comment: input.comment?.trim() || null,
    p_reviewer_name: input.reviewerName?.trim() || null,
  });
  if (error) {
    return { ok: false, message: error.message };
  }
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const row = (rows[0] ?? {}) as { ok?: unknown; message?: unknown };
  return {
    ok: row.ok === true,
    message:
      typeof row.message === "string" && row.message.trim()
        ? row.message
        : row.ok === true
          ? "Review saved"
          : "Could not save review",
  };
}
