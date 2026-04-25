import { createClient } from '@supabase/supabase-js'
import { sendSellerPlanRenewalReminderEmail } from '../_shared/sendSellerPlanEmail.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

type SubscriptionRow = {
  id: string
  current_period_end: string | null
  pricing_plan_id: string | null
  store_id: string
  stores:
    | {
        id: string
        name: string | null
        owner_id: string
          whatsapp_phone_e164?: string | null
      }
    | {
        id: string
        name: string | null
        owner_id: string
          whatsapp_phone_e164?: string | null
      }[]
    | null
}

const AUTO_SMS_PLAN_IDS = new Set(['starter', 'growth', 'pro'])

function resolveReminderDays(raw: string | null | undefined): number {
  const n = Number.parseInt(String(raw ?? '').trim(), 10)
  if (!Number.isFinite(n)) return 7
  return Math.min(30, Math.max(1, n))
}

function toIsoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function normalizePhoneRecipient(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 10 && digits.startsWith('0')) return `233${digits.slice(1)}`
  if (digits.startsWith('00') && digits.length > 4) return digits.slice(2)
  return digits
}

async function sendArkeselSms(opts: {
  apiKey: string
  senderId: string | null
  to: string
  text: string
}): Promise<{ ok: true } | { ok: false; detail: string }> {
  const params = new URLSearchParams()
  params.set('action', 'send-sms')
  params.set('api_key', opts.apiKey)
  params.set('to', opts.to)
  params.set('sms', opts.text.slice(0, 640))
  if (opts.senderId && opts.senderId.trim()) params.set('from', opts.senderId.trim())
  const r = await fetch(`https://sms.arkesel.com/sms/api?${params.toString()}`, {
    method: 'GET',
  })
  const body = (await r.text()).slice(0, 500)
  if (!r.ok) return { ok: false, detail: `HTTP ${r.status}: ${body}` }
  return { ok: true }
}

function renewalSms160(input: {
  storeName: string | null
  planId: string | null
  periodEndIso: string
}): string {
  const end = new Date(input.periodEndIso)
  const endText = Number.isNaN(end.getTime())
    ? 'soon'
    : end.toISOString().slice(0, 10)
  const store = (input.storeName ?? '').trim() || 'your store'
  const plan = (input.planId ?? '').trim().toLowerCase() || 'plan'
  let msg = `Renewal reminder: ${store} (${plan}) is due by ${endText}. Renew now to avoid storefront interruption. - UandITech`
  if (msg.length > 160) msg = `${msg.slice(0, 159)}…`
  return msg
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') {
    return Response.json({ error: 'POST only' }, { status: 405, headers: cors })
  }

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!url || !serviceKey) {
      return Response.json(
        { error: 'Missing Supabase service configuration' },
        { status: 500, headers: cors },
      )
    }

    const requiredCronSecret = Deno.env.get('CRON_SECRET')?.trim()
    if (requiredCronSecret) {
      const provided = req.headers.get('x-cron-secret')?.trim()
      if (!provided || provided !== requiredCronSecret) {
        return Response.json({ error: 'Forbidden' }, { status: 403, headers: cors })
      }
    }

    const admin = createClient(url, serviceKey)
    const { data: settingRow } = await admin
      .from('platform_settings')
      .select('value')
      .eq('key', 'seller_subscription_renewal_reminder_days')
      .maybeSingle()
    const reminderDays = resolveReminderDays(settingRow?.value ?? null)

    const now = new Date()
    const target = new Date(now.getTime() + reminderDays * 86_400_000)
    const targetDate = toIsoDateUtc(target)
    const lowerBound = `${targetDate}T00:00:00.000Z`
    const upperBound = `${targetDate}T23:59:59.999Z`

    const { data, error } = await admin
      .from('seller_subscriptions')
      .select(
        `
        id,
        store_id,
        current_period_end,
        pricing_plan_id,
        stores ( id, name, owner_id, whatsapp_phone_e164 )
      `,
      )
      .in('status', ['active', 'trialing'])
      .gte('current_period_end', lowerBound)
      .lte('current_period_end', upperBound)

    if (error) {
      return Response.json({ error: error.message }, { status: 500, headers: cors })
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? undefined
    const resendFromEmail =
      Deno.env.get('RESEND_FROM_BILLING_EMAIL') ??
      Deno.env.get('RESEND_FROM_EMAIL') ??
      'onboarding@resend.dev'
    const arkeselKey = Deno.env.get('ARKESEL_SMS_API_KEY')?.trim() ?? ''
    const arkeselSender = Deno.env.get('ARKESEL_SMS_SENDER_ID')?.trim() || null
    const smsEnabledRaw = (Deno.env.get('ARKESEL_SMS_ENABLED') ?? 'true').trim().toLowerCase()
    const smsEnabled = smsEnabledRaw !== 'false' && smsEnabledRaw !== '0' && smsEnabledRaw !== 'no'

    const rows = (data ?? []) as SubscriptionRow[]
    let emailed = 0
    let sms_sent = 0
    let skippedAlreadyNotified = 0
    let skippedNoEmail = 0
    let skippedNoSmsPhone = 0
    const warnings: string[] = []

    for (const row of rows) {
      const store = Array.isArray(row.stores) ? row.stores[0] : row.stores
      if (!store || !row.current_period_end) continue

      // Dedupe: one reminder per subscription per target reminder day.
      const { error: logErr } = await admin
        .from('seller_subscription_renewal_reminder_logs')
        .insert({
          subscription_id: row.id,
          reminder_type: 'before_period_end',
          remind_for_date: targetDate,
        })

      if (logErr) {
        const duplicate = logErr.code === '23505' || /duplicate/i.test(logErr.message || '')
        if (duplicate) {
          skippedAlreadyNotified += 1
          continue
        }
        warnings.push(
          `Log insert failed for subscription ${row.id}: ${logErr.message}`,
        )
        continue
      }

      const { data: ownerRec, error: ownerErr } = await admin.auth.admin.getUserById(store.owner_id)
      if (ownerErr) {
        warnings.push(`Owner lookup failed for store ${store.id}: ${ownerErr.message}`)
        continue
      }
      const to = ownerRec.user?.email?.trim() ?? null
      if (!to) {
        skippedNoEmail += 1
        continue
      }

      await sendSellerPlanRenewalReminderEmail({
        resendApiKey,
        resendFromEmail,
        to,
        planId: row.pricing_plan_id,
        periodEndsAtIso: row.current_period_end,
        storeName: store.name,
      })
      emailed += 1

      const planId = (row.pricing_plan_id ?? '').trim().toLowerCase()
      if (!smsEnabled) continue
      if (!AUTO_SMS_PLAN_IDS.has(planId)) continue
      if (!arkeselKey) {
        warnings.push('ARKESEL_SMS_API_KEY missing; renewal reminder SMS skipped.')
        continue
      }

      const { data: ownerProfile, error: ownerProfileErr } = await admin
        .from('profiles')
        .select('phone_e164')
        .eq('id', store.owner_id)
        .maybeSingle()
      if (ownerProfileErr) {
        warnings.push(`Owner phone lookup failed for store ${store.id}: ${ownerProfileErr.message}`)
        continue
      }

      const targetPhone =
        normalizePhoneRecipient((ownerProfile?.phone_e164 as string | null) ?? null) ??
        normalizePhoneRecipient(store.whatsapp_phone_e164 ?? null)
      if (!targetPhone) {
        skippedNoSmsPhone += 1
        continue
      }

      const smsRes = await sendArkeselSms({
        apiKey: arkeselKey,
        senderId: arkeselSender,
        to: targetPhone,
        text: renewalSms160({
          storeName: store.name,
          planId: row.pricing_plan_id,
          periodEndIso: row.current_period_end,
        }),
      })
      if (!smsRes.ok) {
        warnings.push(`Renewal reminder SMS failed for store ${store.id}: ${smsRes.detail}`)
      } else {
        sms_sent += 1
      }
    }

    return Response.json(
      {
        ok: true,
        reminder_days: reminderDays,
        target_date: targetDate,
        checked: rows.length,
        emailed,
        sms_sent,
        skipped_already_notified: skippedAlreadyNotified,
        skipped_no_email: skippedNoEmail,
        skipped_no_sms_phone: skippedNoSmsPhone,
        warnings,
      },
      { headers: cors },
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Server error' },
      { status: 500, headers: cors },
    )
  }
})
