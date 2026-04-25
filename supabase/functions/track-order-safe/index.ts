import { createClient } from "npm:@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Body = {
  store_slug?: string;
  order_ref?: string;
  verify?: string;
};

const WINDOW_MINUTES = 10;
const MAX_ATTEMPTS_PER_IP = 30;
const MAX_ATTEMPTS_PER_STORE = 120;

function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0]?.trim();
  if (first) return first;
  return "unknown";
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405, headers: cors });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !serviceKey) {
      return Response.json(
        { error: "Missing Supabase service configuration" },
        { status: 500, headers: cors },
      );
    }

    const body = (await req.json()) as Body;
    const storeSlug = body.store_slug?.trim() ?? "";
    const orderRef = body.order_ref?.trim() ?? "";
    const verify = body.verify?.trim() ?? "";
    if (!storeSlug || !orderRef || !verify) {
      return Response.json(
        { error: "store_slug, order_ref and verify required" },
        { status: 400, headers: cors },
      );
    }

    const ipHash = await sha256Hex(clientIp(req));
    const admin = createClient(url, serviceKey);
    const windowStartIso = new Date(
      Date.now() - WINDOW_MINUTES * 60 * 1000,
    ).toISOString();

    const [{ count: ipCount }, { count: storeCount }] = await Promise.all([
      admin
        .from("buyer_tracking_attempts")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("created_at", windowStartIso),
      admin
        .from("buyer_tracking_attempts")
        .select("id", { count: "exact", head: true })
        .eq("store_slug", storeSlug)
        .gte("created_at", windowStartIso),
    ]);

    if ((ipCount ?? 0) >= MAX_ATTEMPTS_PER_IP || (storeCount ?? 0) >= MAX_ATTEMPTS_PER_STORE) {
      return Response.json(
        { error: "Too many attempts. Please try again shortly." },
        { status: 429, headers: cors },
      );
    }

    const { data, error } = await admin.rpc("lookup_buyer_order_status", {
      p_store_slug: storeSlug,
      p_order_ref: orderRef,
      p_verify: verify,
    });

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const raw = rows[0] as Record<string, unknown> | undefined;
    const success = Boolean(raw && typeof raw.order_ref === "string");

    await admin.from("buyer_tracking_attempts").insert({
      ip_hash: ipHash,
      store_slug: storeSlug,
      success,
    });

    return Response.json(
      { ok: true, row: success ? raw : null },
      { headers: cors },
    );
  } catch {
    return Response.json(
      { error: "Could not check tracking right now." },
      { status: 500, headers: cors },
    );
  }
});
