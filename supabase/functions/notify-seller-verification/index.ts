import { createClient } from "@supabase/supabase-js";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Body = {
  seller_id: string;
  status: "approved" | "rejected";
  reject_reason?: string | null;
  store_name?: string | null;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const arkeselKey = Deno.env.get("ARKESEL_SMS_API_KEY")?.trim() ?? "";
    const arkeselSender = Deno.env.get("ARKESEL_SMS_SENDER_ID")?.trim() || null;

    const body = (await req.json()) as Body;
    const { seller_id, status, reject_reason, store_name } = body;

    if (!seller_id || !status) {
      return new Response(
        JSON.stringify({ error: "seller_id and status required" }),
        {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    const sb = createClient(supabaseUrl, serviceKey);

    // Fetch seller's phone from profiles (primary) and seller_verifications (fallback)
    const [{ data: profile }, { data: verifRecord }] = await Promise.all([
      sb
        .from("profiles")
        .select("phone_e164, display_name")
        .eq("id", seller_id)
        .maybeSingle(),
      sb
        .from("seller_verifications")
        .select("contact_phone_e164")
        .eq("seller_id", seller_id)
        .maybeSingle(),
    ]);

    const phone =
      (profile?.phone_e164 as string | null)?.trim() ||
      (verifRecord?.contact_phone_e164 as string | null)?.trim() ||
      null;
    const sellerName = (profile?.display_name as string | null) ?? "Seller";
    const shop = store_name?.trim() || "your store";

    const warnings: string[] = [];
    let smsSent = false;

    if (!arkeselKey) {
      warnings.push("ARKESEL_SMS_API_KEY not set; SMS skipped.");
    } else if (!phone) {
      warnings.push("Seller has no phone on file; SMS skipped.");
    } else {
      let message = "";
      if (status === "approved") {
        message = `Hi ${sellerName}, your identity verification for ${shop} has been APPROVED. Kindly wait for Access grant SMS to proceed. - UandITech`;
      } else {
        const reason = reject_reason?.trim()
          ? `Reason: ${reject_reason.trim()}.`
          : "Please log in to see the reason.";
        message = `Hi ${sellerName}, your verification for ${shop} was REJECTED. ${reason} Resubmit via your dashboard. - UandITech`;
      }
      // Enforce 160 char limit
      message = message.slice(0, 160);

      const smsResult = await sendArkeselSms({
        apiKey: arkeselKey,
        senderId: arkeselSender,
        to: phone,
        text: message,
      });
      smsSent = smsResult.ok;
      if (!smsResult.ok) warnings.push(`SMS failed: ${smsResult.detail}`);
    }

    return new Response(
      JSON.stringify({ ok: true, sms_sent: smsSent, warnings }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
