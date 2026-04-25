import { logSmsNotification } from "./logSmsNotification.ts";

function planDisplayName(planId: string | null | undefined): string {
  const id = (planId ?? "").trim().toLowerCase();
  if (!id) return "Paid";
  if (id === "starter") return "Starter";
  if (id === "growth") return "Growth";
  if (id === "pro") return "Pro";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function formatGhsFromPesewas(amount: number | null | undefined): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  const ghs = amount / 100;
  return `GH₵ ${ghs.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPeriodEnd(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function normalizeSmsRecipient(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 && digits.startsWith("0")) return `233${digits.slice(1)}`;
  if (digits.startsWith("00") && digits.length > 4) return digits.slice(2);
  return digits;
}

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
  const r = await fetch(`https://sms.arkesel.com/sms/api?${params.toString()}`, {
    method: "GET",
  });
  const body = (await r.text()).slice(0, 500);
  return { ok: r.ok, detail: body };
}

export async function sendSuperAdminSubscriptionAlert(opts: {
  admin: any;
  resendApiKey: string | undefined;
  resendFromEmail: string;
  arkeselApiKey: string | undefined;
  arkeselSenderId: string | null | undefined;
  sellerEmail: string | null | undefined;
  planId: string | null | undefined;
  amountPesewas: number | null | undefined;
  paymentChannel: string | null | undefined;
  periodEndsAtIso: string | null | undefined;
  storeName?: string | null;
  source: "account" | "store";
}): Promise<void> {
  try {
    const { data: superRows, error: superErr } = await opts.admin
      .from("admin_roles")
      .select("user_id")
      .eq("role", "super_admin");
    if (superErr) {
      console.error("[sendSuperAdminSubscriptionAlert] role fetch", superErr.message);
      return;
    }
    const superIds = (superRows ?? [])
      .map((r: { user_id?: string | null }) => r.user_id ?? "")
      .filter(Boolean);
    if (superIds.length === 0) return;

    const planLabel = planDisplayName(opts.planId);
    const amountLabel = formatGhsFromPesewas(opts.amountPesewas);
    const periodLabel = formatPeriodEnd(opts.periodEndsAtIso);
    const channelLabel = (opts.paymentChannel ?? "").trim() || "—";
    const sellerLabel = (opts.sellerEmail ?? "").trim() || "Unknown seller";
    const storeLabel = (opts.storeName ?? "").trim() || "—";
    const subject =
      opts.source === "store"
        ? `Store subscription success — ${storeLabel}`
        : `Seller subscription success — ${planLabel}`;
    const text =
      opts.source === "store"
        ? `Successful store subscription renewal.\nSeller: ${sellerLabel}\nStore: ${storeLabel}\nPlan: ${planLabel}\nAmount: ${amountLabel}\nChannel: ${channelLabel}\nExpiry: ${periodLabel}`
        : `Successful seller paid plan subscription.\nSeller: ${sellerLabel}\nPlan: ${planLabel}\nAmount: ${amountLabel}\nChannel: ${channelLabel}\nExpiry: ${periodLabel}`;

    const html = `<p><strong>${subject}</strong></p>
<p>Seller: <strong>${sellerLabel}</strong></p>
${opts.source === "store" ? `<p>Store: <strong>${storeLabel}</strong></p>` : ""}
<p>Plan: <strong>${planLabel}</strong></p>
<p>Amount: <strong>${amountLabel}</strong></p>
<p>Channel: <strong>${channelLabel}</strong></p>
<p>Expiry: <strong>${periodLabel}</strong></p>`;

    const resendKey = opts.resendApiKey?.trim();
    if (resendKey) {
      const toEmails: string[] = [];
      await Promise.all(
        superIds.map(async (id) => {
          const { data } = await opts.admin.auth.admin.getUserById(id);
          const e = data?.user?.email?.trim();
          if (e) toEmails.push(e);
        }),
      );
      const uniqueEmails = [...new Set(toEmails)];
      if (uniqueEmails.length > 0) {
        const from = opts.resendFromEmail.trim() || "onboarding@resend.dev";
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `Subscriptions <${from}>`,
            to: uniqueEmails,
            subject,
            text,
            html,
          }),
        });
        if (!r.ok) {
          console.error("[sendSuperAdminSubscriptionAlert] email", r.status, await r.text());
        }
      }
    }

    const smsKey = opts.arkeselApiKey?.trim();
    if (!smsKey) {
      await logSmsNotification(opts.admin, {
        function_name: "sendSuperAdminSubscriptionAlert",
        event_type: "super_admin_subscription_alert",
        status: "skipped",
        detail: "ARKESEL_SMS_API_KEY not set",
        metadata: { source: opts.source, store_name: opts.storeName ?? null },
      });
      return;
    }
    const { data: phoneSetting } = await opts.admin
      .from("platform_settings")
      .select("value")
      .eq("key", "super_admin_sms_phone_e164")
      .maybeSingle();
    const recipients: string[] = [];
    const configured = normalizeSmsRecipient((phoneSetting?.value as string | null) ?? null);
    if (configured) {
      recipients.push(configured);
    } else {
      const { data: phones } = await opts.admin
        .from("profiles")
        .select("phone_e164")
        .in("id", superIds);
      for (const p of phones ?? []) {
        const norm = normalizeSmsRecipient((p as { phone_e164?: string | null }).phone_e164 ?? null);
        if (norm) recipients.push(norm);
      }
    }
    const uniqueSms = [...new Set(recipients)];
    if (uniqueSms.length === 0) {
      await logSmsNotification(opts.admin, {
        function_name: "sendSuperAdminSubscriptionAlert",
        event_type: "super_admin_subscription_alert",
        status: "skipped",
        detail: "No super-admin SMS recipient phone found",
        metadata: { source: opts.source, store_name: opts.storeName ?? null },
      });
    }
    const smsText = `${planLabel} subscription success. ${opts.source === "store" ? `Store: ${storeLabel}. ` : ""}Amount: ${amountLabel}. Expiry: ${periodLabel}.`;
    for (const to of uniqueSms) {
      const res = await sendArkeselSms({
        apiKey: smsKey,
        senderId: opts.arkeselSenderId ?? null,
        to,
        text: smsText,
      });
      if (!res.ok) {
        console.error("[sendSuperAdminSubscriptionAlert] sms", to, res.detail);
      }
      await logSmsNotification(opts.admin, {
        function_name: "sendSuperAdminSubscriptionAlert",
        event_type: "super_admin_subscription_alert",
        status: res.ok ? "sent" : "failed",
        recipient_phone_e164: to,
        detail: res.ok ? "sent" : res.detail,
        metadata: { source: opts.source, store_name: opts.storeName ?? null },
      });
    }
  } catch (e) {
    console.error("[sendSuperAdminSubscriptionAlert]", e);
  }
}
