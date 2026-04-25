import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Body = { announcement_id?: string };

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

function buildAnnouncementSms(title: string): string {
  const head = "UandITech: New announcement — ";
  const tail = ". Open Admin > Announcements.";
  const maxTitle = Math.max(0, 160 - head.length - tail.length);
  const t = title.trim().slice(0, maxTitle) || "Untitled";
  return `${head}${t}${tail}`.slice(0, 160);
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
    const arkeselSender = Deno.env.get("ARKESEL_SMS_SENDER_ID")?.trim() || null;

    const smsEnabledRaw = (Deno.env.get("ARKESEL_SMS_ENABLED") ?? "true")
      .trim()
      .toLowerCase();
    const smsEnabled =
      smsEnabledRaw !== "false" &&
      smsEnabledRaw !== "0" &&
      smsEnabledRaw !== "no";

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

    let bodyJson: Body = {};
    try {
      bodyJson = (await req.json()) as Body;
    } catch {
      bodyJson = {};
    }
    const announcementId = (bodyJson.announcement_id ?? "").trim();
    if (!announcementId) {
      return new Response(
        JSON.stringify({ error: "announcement_id required" }),
        {
          status: 400,
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

    const { data: callerRole, error: roleErr } = await admin
      .from("admin_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleErr || callerRole?.role !== "super_admin") {
      return new Response(
        JSON.stringify({ error: "Only super admins can trigger this" }),
        {
          status: 403,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    const { data: ann, error: annErr } = await admin
      .from("announcements")
      .select("id, title")
      .eq("id", announcementId)
      .maybeSingle();

    if (annErr || !ann?.id) {
      return new Response(JSON.stringify({ error: "Announcement not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const title = String((ann as { title?: string }).title ?? "").trim();
    const text = buildAnnouncementSms(title);

    const warnings: string[] = [];
    if (!smsEnabled) {
      warnings.push("SMS disabled (ARKESEL_SMS_ENABLED).");
    }
    if (!arkeselKey) {
      warnings.push("ARKESEL_SMS_API_KEY not set; SMS skipped.");
    }

    if (!smsEnabled || !arkeselKey) {
      return new Response(
        JSON.stringify({
          ok: true,
          sms_sent: false,
          sent: 0,
          recipients: 0,
          warnings,
        }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const { data: staffRows, error: staffErr } = await admin
      .from("admin_roles")
      .select("user_id");

    if (staffErr) {
      return new Response(JSON.stringify({ error: staffErr.message }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const userIds = [
      ...new Set(
        (staffRows ?? [])
          .map((r) => r.user_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    if (userIds.length === 0) {
      warnings.push("No platform staff in admin_roles.");
      return new Response(
        JSON.stringify({
          ok: true,
          sms_sent: false,
          sent: 0,
          recipients: 0,
          warnings,
        }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const { data: profileRows, error: profErr } = await admin
      .from("profiles")
      .select("id, phone_e164")
      .in("id", userIds);

    if (profErr) {
      return new Response(JSON.stringify({ error: profErr.message }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const e164Set = new Set<string>();
    let missingPhone = 0;
    for (const row of profileRows ?? []) {
      const norm = normalizeSmsRecipient(
        (row as { phone_e164?: string | null }).phone_e164 ?? null,
      );
      if (norm) e164Set.add(norm);
      else missingPhone += 1;
    }

    if (missingPhone > 0) {
      warnings.push(
        `${missingPhone} staff profile(s) have no usable phone_e164; skipped.`,
      );
    }

    const unique = [...e164Set];
    let sent = 0;
    for (const to of unique) {
      const r = await sendArkeselSms({
        apiKey: arkeselKey,
        senderId: arkeselSender,
        to,
        text,
      });
      if (r.ok) sent += 1;
      else warnings.push(`SMS failed (${to.slice(-4)}): ${r.detail}`);
    }

    if (unique.length === 0) {
      warnings.push(
        "No SMS recipients: add phone_e164 to platform staff profiles.",
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sms_sent: sent > 0,
        sent,
        recipients: unique.length,
        warnings,
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
