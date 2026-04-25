import { createClient } from 'npm:@supabase/supabase-js'
import { logSmsNotification } from '../_shared/logSmsNotification.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type Body = { order_id?: string; status?: string }
type DeliveryState = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'
const AUTO_SMS_PLAN_IDS = new Set(['starter', 'growth', 'pro'])

const NOTIFY_STATUSES = new Set([
  'confirmed',
  'out_for_delivery',
  'delivered',
  'canceled',
])

const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirmed',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  canceled: 'Canceled',
}

function toOrderReference(orderId: string): string {
  const compact = orderId.replace(/-/g, '').toUpperCase()
  if (compact.length < 8) return `ORD-${compact || 'UNKNOWN'}`
  return `ORD-${compact.slice(0, 4)}-${compact.slice(-4)}`
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
}): Promise<{ ok: true; status: number; bodySlice: string } | { ok: false; status: number; detail: string }> {
  const params = new URLSearchParams()
  params.set('action', 'send-sms')
  params.set('api_key', opts.apiKey)
  params.set('to', opts.to)
  params.set('sms', opts.text.slice(0, 640))
  if (opts.senderId && opts.senderId.trim()) params.set('from', opts.senderId.trim())
  const r = await fetch(`https://sms.arkesel.com/sms/api?${params.toString()}`, { method: 'GET' })
  const bodySlice = (await r.text()).slice(0, 700)
  if (!r.ok) return { ok: false, status: r.status, detail: `HTTP ${r.status}: ${bodySlice}` }
  return { ok: true, status: r.status, bodySlice }
}

async function sendResend(opts: {
  apiKey: string
  from: string
  to: string
  subject: string
  text: string
}): Promise<{ ok: true } | { ok: false; detail: string }> {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Orders <${opts.from}>`,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
    }),
  })
  if (!r.ok) {
    const t = (await r.text()).slice(0, 500)
    return { ok: false, detail: `HTTP ${r.status}: ${t}` }
  }
  return { ok: true }
}

async function ensureDeliveryLedger(admin: ReturnType<typeof createClient>, orderId: string, status: string) {
  const { error } = await admin
    .from('order_status_notification_deliveries')
    .upsert(
      { order_id: orderId, status },
      { onConflict: 'order_id,status', ignoreDuplicates: false },
    )
  if (error) throw error
}

async function readDeliveryLedger(
  admin: ReturnType<typeof createClient>,
  orderId: string,
  status: string,
): Promise<{
  email_state: DeliveryState
  sms_state: DeliveryState
}> {
  const { data, error } = await admin
    .from('order_status_notification_deliveries')
    .select('email_state,sms_state')
    .eq('order_id', orderId)
    .eq('status', status)
    .maybeSingle()
  if (error || !data) {
    throw new Error(error?.message || 'delivery_ledger_read_failed')
  }
  return data as { email_state: DeliveryState; sms_state: DeliveryState }
}

async function claimChannelIfNeeded(
  admin: ReturnType<typeof createClient>,
  orderId: string,
  status: string,
  channel: 'email' | 'sms',
): Promise<boolean> {
  const stateCol = channel === 'email' ? 'email_state' : 'sms_state'
  const patch = {
    [stateCol]: 'sending',
    last_attempt_at: new Date().toISOString(),
  }
  const { data, error } = await admin
    .from('order_status_notification_deliveries')
    .update(patch)
    .eq('order_id', orderId)
    .eq('status', status)
    .in(stateCol, ['pending', 'failed'])
    .select('id')
    .limit(1)
  if (error) throw error
  return Boolean(data?.length)
}

async function markChannelResult(
  admin: ReturnType<typeof createClient>,
  orderId: string,
  status: string,
  channel: 'email' | 'sms',
  result: { ok: true } | { ok: false; detail: string },
) {
  const stateCol = channel === 'email' ? 'email_state' : 'sms_state'
  const attemptsCol = channel === 'email' ? 'email_attempts' : 'sms_attempts'
  const errorCol = channel === 'email' ? 'email_last_error' : 'sms_last_error'
  const sentAtCol = channel === 'email' ? 'email_sent_at' : 'sms_sent_at'
  const nowIso = new Date().toISOString()
  const { data: cur, error: curErr } = await admin
    .from('order_status_notification_deliveries')
    .select(attemptsCol)
    .eq('order_id', orderId)
    .eq('status', status)
    .maybeSingle()
  if (curErr) throw curErr
  const attempts =
    cur && typeof (cur as Record<string, unknown>)[attemptsCol] === 'number'
      ? Number((cur as Record<string, unknown>)[attemptsCol])
      : 0

  const patch: Record<string, unknown> = {
    [stateCol]: result.ok ? 'sent' : 'failed',
    [attemptsCol]: attempts + 1,
    [errorCol]: result.ok ? null : result.detail.slice(0, 2000),
    last_attempt_at: nowIso,
  }
  if (result.ok) patch[sentAtCol] = nowIso

  const { error } = await admin
    .from('order_status_notification_deliveries')
    .update(patch)
    .eq('order_id', orderId)
    .eq('status', status)
  if (error) throw error
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'POST only' }, { status: 405, headers: cors })
  }

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    if (!url || !serviceKey || !anonKey) {
      return Response.json(
        { error: 'Missing Supabase configuration' },
        { status: 500, headers: cors },
      )
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return Response.json(
        { error: 'Missing authorization header' },
        { status: 401, headers: cors },
      )
    }

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: authData, error: authErr } = await userClient.auth.getUser()
    if (authErr || !authData.user) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401, headers: cors },
      )
    }

    const body = (await req.json()) as Body
    const orderId = body.order_id?.trim()
    const nextStatus = body.status?.trim()
    if (!orderId || !nextStatus) {
      return Response.json(
        { error: 'order_id and status required' },
        { status: 400, headers: cors },
      )
    }
    if (!NOTIFY_STATUSES.has(nextStatus)) {
      return Response.json(
        { ok: true, skipped: 'status_not_notifiable' },
        { headers: cors },
      )
    }

    const admin = createClient(url, serviceKey)
    const { data: order, error: oe } = await admin
      .from('orders')
      .select(
        `
        id,
        order_ref,
        status,
        customer_id,
        guest_name,
        guest_email,
        guest_phone,
        stores ( id, name, owner_id, profiles!stores_owner_id_fkey(signup_plan) )
      `,
      )
      .eq('id', orderId)
      .maybeSingle()

    if (oe || !order) {
      return Response.json({ error: 'Order not found' }, { status: 404, headers: cors })
    }

    const rawStore = order.stores as
      | { id: string; name: string; owner_id: string; profiles?: { signup_plan?: string | null } | null }[]
      | { id: string; name: string; owner_id: string; profiles?: { signup_plan?: string | null } | null }
      | null
    const store = Array.isArray(rawStore) ? rawStore[0] : rawStore
    if (!store) {
      return Response.json({ error: 'Store missing' }, { status: 500, headers: cors })
    }

    if (store.owner_id !== authData.user.id) {
      return Response.json(
        { error: 'Not allowed for this order' },
        { status: 403, headers: cors },
      )
    }

    await ensureDeliveryLedger(admin, order.id, nextStatus)
    const ledgerBefore = await readDeliveryLedger(admin, order.id, nextStatus)

    const warnings: string[] = []
    let anyChannelSent = false
    const resendKey = Deno.env.get('RESEND_API_KEY')?.trim()
    const resendFrom =
      Deno.env.get('RESEND_FROM_ORDERS_EMAIL')?.trim() ||
      Deno.env.get('RESEND_FROM_EMAIL')?.trim() ||
      'onboarding@resend.dev'

    let buyerEmail = order.guest_email?.trim() || null
    const custId = order.customer_id as string | null | undefined
    if (!buyerEmail && custId) {
      const { data: buyerUser } = await admin.auth.admin.getUserById(custId)
      buyerEmail = buyerUser?.user?.email?.trim() || null
    }

    if (ledgerBefore.email_state === 'sent') {
      warnings.push('Buyer status email skipped (already sent).')
    } else if (!resendKey) {
      await admin
        .from('order_status_notification_deliveries')
        .update({ email_state: 'skipped' as DeliveryState })
        .eq('order_id', order.id)
        .eq('status', nextStatus)
      warnings.push('RESEND_API_KEY missing; email skipped.')
    } else if (!buyerEmail) {
      await admin
        .from('order_status_notification_deliveries')
        .update({ email_state: 'skipped' as DeliveryState })
        .eq('order_id', order.id)
        .eq('status', nextStatus)
      warnings.push('Customer email missing on this order; email skipped.')
    } else {
      const claimed = await claimChannelIfNeeded(admin, order.id, nextStatus, 'email')
      if (!claimed) {
        warnings.push('Buyer status email skipped (already in-flight or sent).')
      } else {
        const statusLabel = STATUS_LABEL[nextStatus] ?? nextStatus
        const subject = `[${store.name}] Order ${statusLabel}`
        const orderRef =
          typeof order.order_ref === 'string' && order.order_ref.trim()
            ? order.order_ref.trim()
            : toOrderReference(order.id)
        const text = `Your order status has changed.\n\nStore: ${store.name}\nOrder ref: ${orderRef}\nOrder ID: ${order.id}\nNew status: ${statusLabel}\n\nThank you for ordering.`
        const res = await sendResend({
          apiKey: resendKey,
          from: resendFrom,
          to: buyerEmail,
          subject,
          text,
        })
        await markChannelResult(admin, order.id, nextStatus, 'email', res)
        if (!res.ok) {
          warnings.push(`Buyer status email failed: ${res.detail}`)
        } else {
          anyChannelSent = true
        }
      }
    }

    const smsEnabledRaw = (Deno.env.get('ARKESEL_SMS_ENABLED') ?? 'true').trim().toLowerCase()
    const smsEnabled = smsEnabledRaw !== 'false' && smsEnabledRaw !== '0' && smsEnabledRaw !== 'no'
    const arkeselKey = Deno.env.get('ARKESEL_SMS_API_KEY')?.trim() ?? ''
    const arkeselSender = Deno.env.get('ARKESEL_SMS_SENDER_ID')?.trim() ?? null
    const buyerPhone = normalizePhoneRecipient(order.guest_phone ?? null)
    const statusOrderRef =
      typeof order.order_ref === 'string' && order.order_ref.trim()
        ? order.order_ref.trim()
        : toOrderReference(order.id)
    const planRaw = store.profiles?.signup_plan
    const storePlanId =
      typeof planRaw === 'string' && planRaw.trim() ? planRaw.trim().toLowerCase() : 'free'
    if (ledgerBefore.sms_state === 'sent') {
      warnings.push('Buyer SMS status skipped (already sent).')
      await logSmsNotification(admin, {
        function_name: 'notify-order-status',
        event_type: 'buyer_order_status_notification',
        status: 'skipped',
        recipient_phone_e164: buyerPhone,
        detail: 'already sent',
        metadata: { order_id: order.id, order_ref: statusOrderRef, status: nextStatus, store_id: store.id },
      })
    } else if (!smsEnabled) {
      await admin
        .from('order_status_notification_deliveries')
        .update({ sms_state: 'skipped' as DeliveryState })
        .eq('order_id', order.id)
        .eq('status', nextStatus)
      warnings.push('Buyer SMS status skipped (ARKESEL_SMS_ENABLED=false).')
      await logSmsNotification(admin, {
        function_name: 'notify-order-status',
        event_type: 'buyer_order_status_notification',
        status: 'skipped',
        recipient_phone_e164: buyerPhone,
        detail: 'ARKESEL_SMS_ENABLED=false',
        metadata: { order_id: order.id, order_ref: statusOrderRef, status: nextStatus, store_id: store.id },
      })
    } else if (!AUTO_SMS_PLAN_IDS.has(storePlanId)) {
      await admin
        .from('order_status_notification_deliveries')
        .update({ sms_state: 'skipped' as DeliveryState })
        .eq('order_id', order.id)
        .eq('status', nextStatus)
      warnings.push('Buyer SMS status skipped (free tier is manual SMS only).')
      await logSmsNotification(admin, {
        function_name: 'notify-order-status',
        event_type: 'buyer_order_status_notification',
        status: 'skipped',
        recipient_phone_e164: buyerPhone,
        detail: 'plan not eligible',
        metadata: { order_id: order.id, order_ref: statusOrderRef, status: nextStatus, store_id: store.id },
      })
    } else if (!arkeselKey) {
      await admin
        .from('order_status_notification_deliveries')
        .update({ sms_state: 'skipped' as DeliveryState })
        .eq('order_id', order.id)
        .eq('status', nextStatus)
      warnings.push('Buyer SMS status skipped (ARKESEL_SMS_API_KEY missing).')
      await logSmsNotification(admin, {
        function_name: 'notify-order-status',
        event_type: 'buyer_order_status_notification',
        status: 'skipped',
        recipient_phone_e164: buyerPhone,
        detail: 'ARKESEL_SMS_API_KEY missing',
        metadata: { order_id: order.id, order_ref: statusOrderRef, status: nextStatus, store_id: store.id },
      })
    } else if (!buyerPhone) {
      await admin
        .from('order_status_notification_deliveries')
        .update({ sms_state: 'skipped' as DeliveryState })
        .eq('order_id', order.id)
        .eq('status', nextStatus)
      warnings.push('Buyer SMS status skipped (missing recipient phone).')
      await logSmsNotification(admin, {
        function_name: 'notify-order-status',
        event_type: 'buyer_order_status_notification',
        status: 'skipped',
        recipient_phone_e164: null,
        detail: 'missing recipient phone',
        metadata: { order_id: order.id, order_ref: statusOrderRef, status: nextStatus, store_id: store.id },
      })
    } else {
      const claimed = await claimChannelIfNeeded(admin, order.id, nextStatus, 'sms')
      if (!claimed) {
        warnings.push('Buyer SMS status skipped (already in-flight or sent).')
        await logSmsNotification(admin, {
          function_name: 'notify-order-status',
          event_type: 'buyer_order_status_notification',
          status: 'skipped',
          recipient_phone_e164: buyerPhone,
          detail: 'already in-flight or sent',
          metadata: { order_id: order.id, order_ref: statusOrderRef, status: nextStatus, store_id: store.id },
        })
      } else {
        const statusLabel = STATUS_LABEL[nextStatus] ?? nextStatus
        const text = `Order update: ${store.name}. Ref ${statusOrderRef}. Status: ${statusLabel}.`
        const smsRes = await sendArkeselSms({
          apiKey: arkeselKey,
          senderId: arkeselSender,
          to: buyerPhone,
          text,
        })
        await markChannelResult(admin, order.id, nextStatus, 'sms', smsRes)
        if (!smsRes.ok) {
          warnings.push(`Buyer SMS status failed: ${smsRes.detail}`)
          await logSmsNotification(admin, {
            function_name: 'notify-order-status',
            event_type: 'buyer_order_status_notification',
            status: 'failed',
            recipient_phone_e164: buyerPhone,
            detail: smsRes.detail,
            metadata: { order_id: order.id, order_ref: statusOrderRef, status: nextStatus, store_id: store.id },
          })
        } else {
          anyChannelSent = true
          await logSmsNotification(admin, {
            function_name: 'notify-order-status',
            event_type: 'buyer_order_status_notification',
            status: 'sent',
            recipient_phone_e164: buyerPhone,
            detail: 'sent',
            metadata: { order_id: order.id, order_ref: statusOrderRef, status: nextStatus, store_id: store.id },
          })
        }
      }
    }

    return Response.json(
      { ok: true, sent: anyChannelSent, ...(warnings.length ? { warnings } : {}) },
      { headers: cors },
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Server error' },
      { status: 500, headers: cors },
    )
  }
})
