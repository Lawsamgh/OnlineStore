import { createClient } from "npm:@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type ArkeselBalanceResponse = {
  balance?: unknown;
  main_balance?: unknown;
  user?: unknown;
};

function asNumberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const arkeselKey = Deno.env.get("ARKESEL_SMS_API_KEY")?.trim() ?? "";

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!supabaseUrl || !anonKey || !serviceKey || !bearer) {
      return new Response(
        JSON.stringify({ error: "Missing configuration or Authorization" }),
        {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    if (!arkeselKey) {
      return new Response(
        JSON.stringify({ error: "ARKESEL_SMS_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user?.id) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: roleRow, error: roleErr } = await admin
      .from("admin_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleErr || roleRow?.role !== "super_admin") {
      return new Response(
        JSON.stringify({ error: "Only super admins can view SMS balance" }),
        {
          status: 403,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    const params = new URLSearchParams();
    params.set("action", "check-balance");
    params.set("api_key", arkeselKey);
    params.set("response", "json");

    const r = await fetch(`https://sms.arkesel.com/sms/api?${params.toString()}`, {
      method: "GET",
    });
    const text = await r.text();
    let parsed: ArkeselBalanceResponse = {};
    try {
      parsed = JSON.parse(text) as ArkeselBalanceResponse;
    } catch {
      parsed = {};
    }

    if (!r.ok) {
      return new Response(
        JSON.stringify({
          error: "Failed to fetch Arkesel SMS balance",
          detail: text.slice(0, 500),
        }),
        {
          status: 502,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    const balance =
      asNumberOrNull(parsed.balance) ?? asNumberOrNull(parsed.main_balance);

    return new Response(
      JSON.stringify({
        ok: true,
        balance,
        user: typeof parsed.user === "string" ? parsed.user : null,
        fetched_at: new Date().toISOString(),
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
