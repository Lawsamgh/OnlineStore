import { createClient } from "npm:@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function sendArkeselSms(opts: {
  apiKey: string;
  senderId: string | null;
  to: string;
  text: string;
}): Promise<{ ok: boolean; detail: string }> {
  const params = new URLSearchParams();
  params.set("action", "send-sms");
  params.set("api_key", opts.apiKey);
  params.set("to", opts.to);
  params.set("sms", opts.text.slice(0, 160));
  if (opts.senderId?.trim()) params.set("from", opts.senderId.trim());
  const r = await fetch(
    `https://sms.arkesel.com/sms/api?${params.toString()}`,
    { method: "GET" },
  );
  const body = (await r.text()).slice(0, 500);
  return { ok: r.ok, detail: body };
}

/** Ghana-friendly: 0594042786 → 233594042786; strips non-digits except leading + handling. */
function normalizeSmsRecipient(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 && digits.startsWith("0")) {
    return `233${digits.slice(1)}`;
  }
  if (digits.startsWith("00") && digits.length > 4) {
    return digits.slice(2);
  }
  return digits;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const arkeselKey = Deno.env.get("ARKESEL_SMS_API_KEY")?.trim() ?? "";
    const arkeselSender = Deno.env.get("ARKESEL_SMS_SENDER_ID")?.trim() || null;

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

    const { data: staff } = await admin
      .from("admin_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (staff?.role === "super_admin" || staff?.role === "admin") {
      return new Response(
        JSON.stringify({ ok: true, skipped: "platform_staff" }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimErr } = await admin
      .from("profiles")
      .update({ seller_join_sms_sent_at: nowIso })
      .eq("id", user.id)
      .is("seller_join_sms_sent_at", null)
      .select("id, display_name")
      .maybeSingle();

    if (claimErr) {
      return new Response(JSON.stringify({ error: claimErr.message }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (!claimed) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "already_notified_or_no_row" }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const displayName =
      (claimed.display_name as string | null)?.trim() ||
      (typeof user.user_metadata?.full_name === "string"
        ? String(user.user_metadata.full_name).trim()
        : "") ||
      (user.email?.split("@")[0] ?? "New seller");

    if (!arkeselKey) {
      return new Response(
        JSON.stringify({
          ok: true,
          sms_sent: false,
          warnings: ["ARKESEL_SMS_API_KEY not set; SMS skipped."],
        }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const { data: phoneSetting } = await admin
      .from("platform_settings")
      .select("value")
      .eq("key", "super_admin_sms_phone_e164")
      .maybeSingle();

    const configuredRaw = (phoneSetting?.value as string | null)?.trim() ?? "";
    const configuredE164 = normalizeSmsRecipient(configuredRaw);

    const recipients: string[] = [];
    if (configuredE164) {
      recipients.push(configuredE164);
    } else {
      const { data: superRows, error: superErr } = await admin
        .from("admin_roles")
        .select("user_id")
        .eq("role", "super_admin");

      if (superErr) {
        return new Response(JSON.stringify({ error: superErr.message }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const superIds = (superRows ?? [])
        .map((r) => r.user_id as string)
        .filter(Boolean);
      if (superIds.length > 0) {
        const { data: phones, error: phErr } = await admin
          .from("profiles")
          .select("phone_e164")
          .in("id", superIds);
        if (phErr) {
          return new Response(JSON.stringify({ error: phErr.message }), {
            status: 500,
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
        for (const row of phones ?? []) {
          const norm = normalizeSmsRecipient(
            (row.phone_e164 as string | null) ?? null,
          );
          if (norm) recipients.push(norm);
        }
      }
    }

    const unique = [...new Set(recipients)];
    const baseMsg =
      `New seller: ${displayName} joined. Check Admin > Seller verifications. - UandITech`;
    const text = baseMsg.slice(0, 160);

    const warnings: string[] = [];
    let sent = 0;
    for (const to of unique) {
      const r = await sendArkeselSms({
        apiKey: arkeselKey,
        senderId: arkeselSender,
        to,
        text,
      });
      if (r.ok) sent += 1;
      else warnings.push(`SMS to super admin failed: ${r.detail}`);
    }

    if (unique.length === 0) {
      warnings.push(
        "No SMS destination: set super_admin_sms_phone_e164 in Platform Settings, or add phone_e164 to the super admin profile.",
      );
    }

    return new Response(
      JSON.stringify({ ok: true, sms_sent: sent > 0, sent, warnings }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
