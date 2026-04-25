type SmsLogStatus = "sent" | "failed" | "skipped";

type SmsLogEntry = {
  function_name: string;
  event_type: string;
  status: SmsLogStatus;
  recipient_phone_e164?: string | null;
  detail?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Best-effort logging for SMS delivery observability.
 * Never throws, so notification flows are not blocked by logging failures.
 */
export async function logSmsNotification(
  // Accept a real Supabase client. In supabase-js, `.insert()` returns a Postgrest
  // builder (not a raw Promise), so we intentionally keep this loosely typed.
  admin: { from: (table: string) => any },
  entry: SmsLogEntry,
) {
  try {
    const payload: Record<string, unknown> = {
      function_name: entry.function_name,
      event_type: entry.event_type,
      status: entry.status,
      recipient_phone_e164: entry.recipient_phone_e164 ?? null,
      detail: entry.detail ?? null,
      metadata: entry.metadata ?? {},
    };
    const res = await admin.from("sms_notification_logs").insert(payload);
    const error = (res as { error?: { message?: string } | null } | null | undefined)?.error;
    if (error) {
      console.error("[logSmsNotification]", error.message ?? "insert failed");
    }
  } catch (e) {
    console.error("[logSmsNotification]", e);
  }
}
