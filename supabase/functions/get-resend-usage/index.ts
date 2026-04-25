import { createClient } from "npm:@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function parseIntHeader(v: string | null): number | null {
  if (!v) return null;
  const n = Number.parseInt(v.trim(), 10);
  return Number.isFinite(n) ? n : null;
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
    const resendKey = Deno.env.get("RESEND_API_KEY")?.trim() ?? "";

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
    if (!resendKey) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
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
        JSON.stringify({ error: "Only super admins can view Resend usage" }),
        {
          status: 403,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    // Any authenticated Resend API call includes usage/rate headers.
    const r = await fetch("https://api.resend.com/domains?page=1&page_size=1", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
    });
    const bodyText = await r.text();
    if (!r.ok) {
      const detail = bodyText.slice(0, 500);
      if (
        r.status === 401 &&
        /restricted_api_key/i.test(detail) &&
        /only send emails/i.test(detail)
      ) {
        return new Response(
          JSON.stringify({
            ok: false,
            reason: "restricted_api_key",
            error:
              "Resend key is send-only. Use a full-access Resend API key to read usage.",
            detail,
            fetched_at: new Date().toISOString(),
          }),
          { headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          error: `Failed to fetch Resend usage (HTTP ${r.status})`,
          detail,
        }),
        {
          status: 502,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    const dailyHeaderRaw = r.headers.get("x-resend-daily-quota");
    const monthlyHeaderRaw = r.headers.get("x-resend-monthly-quota");
    return new Response(
      JSON.stringify({
        ok: true,
        daily_quota_used: parseIntHeader(dailyHeaderRaw),
        monthly_quota_used: parseIntHeader(monthlyHeaderRaw),
        rate_limit: parseIntHeader(r.headers.get("ratelimit-limit")),
        rate_remaining: parseIntHeader(r.headers.get("ratelimit-remaining")),
        rate_reset_sec: parseIntHeader(r.headers.get("ratelimit-reset")),
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
