import { createClient } from 'npm:@supabase/supabase-js'
import { logSmsNotification } from '../_shared/logSmsNotification.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type Body = { order_id?: string; notify_token?: string }
const AUTO_SMS_PLAN_IDS = new Set(['starter', 'growth', 'pro'])
type DeliveryState = 'pending' | 'sending' | 'sent' | 'failed'

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

async function sendArkeselSms(opts: {
  apiKey: string
  senderId: string | null
  to: string
  text: string
}): Promise<{ ok: true; status: number; bodySlice: string } | { ok: false; status: number; detail: string; bodySlice: string }> {
  const params = new URLSearchParams()
  params.set('action', 'send-sms')
  params.set('api_key', opts.apiKey)
  params.set('to', opts.to)
  params.set('sms', opts.text.slice(0, 640))
  if (opts.senderId && opts.senderId.trim()) {
    params.set('from', opts.senderId.trim())
  }
  const url = `https://sms.arkesel.com/sms/api?${params.toString()}`
  const r = await fetch(url, { method: 'GET' })
  const bodyText = (await r.text()).slice(0, 700)
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      detail: `HTTP ${r.status}: ${bodyText}`,
      bodySlice: bodyText,
    }
  }
  return { ok: true, status: r.status, bodySlice: bodyText }
}

function normalizePhoneRecipient(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (!digits) return null
  // Ghana local mobile format (e.g. 0594042786) -> international (233594042786)
  if (digits.length === 10 && digits.startsWith('0')) {
    return `233${digits.slice(1)}`
  }
  // Handle accidental 00 prefix for international numbers.
  if (digits.startsWith('00') && digits.length > 4) {
    return digits.slice(2)
  }
  return digits
}

function toOrderReference(orderId: string): string {
  const compact = orderId.replace(/-/g, '').toUpperCase()
  if (compact.length < 8) return `ORD-${compact || 'UNKNOWN'}`
  return `ORD-${compact.slice(0, 4)}-${compact.slice(-4)}`
}

function compactText(raw: string | null | undefined, max = 24): string {
  const oneLine = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!oneLine) return 'N/A'
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, Math.max(1, max - 1))}…`
}

function sellerSms160(input: {
  orderRef: string
  storeName: string
  buyerName: string | null | undefined
  buyerPhone: string | null | undefined
}): string {
  let msg = `A new order (#${compactText(input.orderRef, 16)}) has been placed for ${compactText(input.storeName, 18)} by ${compactText(input.buyerName, 16)}, whose contact is ${compactText(input.buyerPhone, 15)}. Check dashboard.`
  if (msg.length > 160) msg = `${msg.slice(0, 159)}…`
  return msg
}

function buyerOrderSms160(input: {
  orderRef: string
  storeName: string
  totalGhs: number
  itemCount: number
}): string {
  const total = Number.isFinite(input.totalGhs) ? input.totalGhs.toFixed(2) : '0.00'
  let msg = `Order received: ${compactText(input.storeName, 18)}. Ref ${compactText(input.orderRef, 16)}. Items ${input.itemCount}. Total GHS ${total}. We'll contact you soon.`
  if (msg.length > 160) msg = `${msg.slice(0, 159)}…`
  return msg
}

async function ensureDeliveryLedger(admin: ReturnType<typeof createClient>, orderId: string) {
  const { error } = await admin
    .from('order_notification_deliveries')
    .upsert({ order_id: orderId }, { onConflict: 'order_id', ignoreDuplicates: false })
  if (error) throw error
}

async function readDeliveryLedger(
  admin: ReturnType<typeof createClient>,
  orderId: string,
): Promise<Record<string, DeliveryState>> {
  const { data, error } = await admin
    .from('order_notification_deliveries')
    .select('seller_email_state,buyer_email_state,seller_sms_state,buyer_sms_state')
    .eq('order_id', orderId)
    .maybeSingle()
  if (error || !data) throw new Error(error?.message || 'order_delivery_ledger_read_failed')
  return data as Record<string, DeliveryState>
}

async function claimChannelIfNeeded(
  admin: ReturnType<typeof createClient>,
  orderId: string,
  stateCol: 'seller_email_state' | 'buyer_email_state' | 'seller_sms_state' | 'buyer_sms_state',
) {
  const { data, error } = await admin
    .from('order_notification_deliveries')
    .update({ [stateCol]: 'sending', last_attempt_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .in(stateCol, ['pending', 'failed'])
    .select('id')
    .limit(1)
  if (error) throw error
  return Boolean(data?.length)
}

async function markChannelResult(
  admin: ReturnType<typeof createClient>,
  orderId: string,
  channel: 'seller_email' | 'buyer_email' | 'seller_sms' | 'buyer_sms',
  result: { ok: true } | { ok: false; detail: string },
) {
  const stateCol = `${channel}_state`
  const attemptsCol = `${channel}_attempts`
  const lastErrorCol = `${channel}_last_error`
  const sentAtCol = `${channel}_sent_at`
  const { data: cur, error: curErr } = await admin
    .from('order_notification_deliveries')
    .select(attemptsCol)
    .eq('order_id', orderId)
    .maybeSingle()
  if (curErr) throw curErr
  const attempts =
    cur && typeof (cur as Record<string, unknown>)[attemptsCol] === 'number'
      ? Number((cur as Record<string, unknown>)[attemptsCol])
      : 0
  const nowIso = new Date().toISOString()
  const patch: Record<string, unknown> = {
    [stateCol]: result.ok ? 'sent' : 'failed',
    [attemptsCol]: attempts + 1,
    [lastErrorCol]: result.ok ? null : result.detail.slice(0, 2000),
    last_attempt_at: nowIso,
  }
  if (result.ok) patch[sentAtCol] = nowIso
  const { error } = await admin
    .from('order_notification_deliveries')
    .update(patch)
    .eq('order_id', orderId)
  if (error) throw error
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  const warnings: string[] = []
  let smsAttempted = false
  let smsAccepted = false
  let smsHttpStatus: number | null = null
  let smsSkipReason: string | null = null
  let smsRecipientTail: string | null = null
  let smsRecipientFull: string | null = null
  let smsBodySlice: string | null = null
    const channelResults = {
      seller_email: 'not_attempted',
      buyer_email: 'not_attempted',
      seller_sms: 'not_attempted',
      buyer_sms: 'not_attempted',
    } as Record<string, 'sent' | 'failed' | 'skipped' | 'not_attempted'>

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!url || !serviceKey) {
      return Response.json(
        { error: 'Missing Supabase service configuration' },
        { status: 500, headers: cors },
      )
    }

    const body = (await req.json()) as Body
    const orderId = body.order_id
    const notifyToken = body.notify_token
    if (!orderId || !notifyToken) {
      return Response.json(
        { error: 'order_id and notify_token required' },
        { status: 400, headers: cors },
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
        delivery_address,
        customer_notes,
        notify_token,
        stores ( id, name, slug, whatsapp_phone_e164, owner_id, profiles!stores_owner_id_fkey(signup_plan) )
      `,
      )
      .eq('id', orderId)
      .eq('notify_token', notifyToken)
      .maybeSingle()

    if (oe || !order) {
      return Response.json({ error: 'Order not found' }, { status: 404, headers: cors })
    }

    const rawStore = order.stores as
      | {
          id: string
          name: string
          slug: string
          whatsapp_phone_e164: string | null
          owner_id: string
          profiles?: { signup_plan?: string | null } | null
        }[]
      | {
          id: string
          name: string
          slug: string
          whatsapp_phone_e164: string | null
          owner_id: string
          profiles?: { signup_plan?: string | null } | null
        }
      | null
    const store = Array.isArray(rawStore) ? rawStore[0] : rawStore
    if (!store) {
      return Response.json({ error: 'Store missing' }, { status: 500, headers: cors })
    }

    const { data: items, error: ie } = await admin
      .from('order_items')
      .select('title_snapshot, unit_price_cents, quantity')
      .eq('order_id', orderId)

    if (ie) {
      return Response.json({ error: ie.message }, { status: 500, headers: cors })
    }
    await ensureDeliveryLedger(admin, orderId)
    const delivery = await readDeliveryLedger(admin, orderId)

    const lines = (items ?? [])
      .map(
        (r: { title_snapshot: string; unit_price_cents: number; quantity: number }) =>
          `${r.quantity}× ${r.title_snapshot} @ ${(r.unit_price_cents / 100).toFixed(2)} GHS`,
      )
      .join('\n')

    const orderRef =
      typeof order.order_ref === 'string' && order.order_ref.trim()
        ? order.order_ref.trim()
        : toOrderReference(orderId)
    const itemCount = (items ?? []).reduce((sum, r) => sum + (Number.isFinite(r.quantity) ? r.quantity : 0), 0)
    const totalGhs = (items ?? []).reduce(
      (sum, r) => sum + (Number.isFinite(r.unit_price_cents) ? r.unit_price_cents : 0) * (Number.isFinite(r.quantity) ? r.quantity : 0),
      0,
    ) / 100

    const textBody = `New order for ${store.name}
Order ref: ${orderRef}
Order ID: ${orderId}
${lines}

Address: ${order.delivery_address ?? '—'}
Notes: ${order.customer_notes ?? '—'}
Guest: ${order.guest_name ?? '—'} / ${order.guest_email ?? '—'} / ${order.guest_phone ?? '—'}
`

    const resendKey = Deno.env.get('RESEND_API_KEY')?.trim()
    const resendFrom =
      Deno.env.get('RESEND_FROM_ORDERS_EMAIL')?.trim() ||
      Deno.env.get('RESEND_FROM_EMAIL')?.trim() ||
      'onboarding@resend.dev'
    const resendFromLower = resendFrom.toLowerCase()
    const usesResendDevSender =
      resendFromLower.includes('onboarding@resend.dev') ||
      resendFromLower.endsWith('@resend.dev')

    const { data: sellerUser, error: ue } = await admin.auth.admin.getUserById(
      store.owner_id,
    )
    if (ue) {
      warnings.push(
        `Could not load store owner email (auth): ${ue.message}. Seller was not emailed.`,
      )
    }
    const sellerEmail = sellerUser?.user?.email?.trim() || null

    if (!resendKey) {
      warnings.push(
        'RESEND_API_KEY is not set on this project — seller and buyer confirmation emails were skipped. Add the secret under Supabase → Edge Functions → Secrets.',
      )
    } else {
      if (usesResendDevSender) {
        warnings.push(
          'Order sender uses a @resend.dev test domain: customer confirmations may not reach arbitrary inboxes until you verify your domain in Resend and set RESEND_FROM_ORDERS_EMAIL (or RESEND_FROM_EMAIL) to an address on that domain.',
        )
      }
      if (delivery.seller_email_state === 'sent') {
        channelResults.seller_email = 'skipped'
        warnings.push('Seller email already sent; skipping replay.')
      } else if (!sellerEmail) {
        channelResults.seller_email = 'skipped'
        warnings.push(
          'Store owner has no email on their auth account — seller order email was skipped.',
        )
      } else {
        const claimed = await claimChannelIfNeeded(admin, orderId, 'seller_email_state')
        if (!claimed) {
          channelResults.seller_email = 'skipped'
          warnings.push('Seller email already in-flight or sent; skipping replay.')
        } else {
          const sellerRes = await sendResend({
            apiKey: resendKey,
            from: resendFrom,
            to: sellerEmail,
            subject: `[${store.name}] New order`,
            text: textBody,
          })
          await markChannelResult(admin, orderId, 'seller_email', sellerRes)
          if (!sellerRes.ok) {
            channelResults.seller_email = 'failed'
            console.error('[notify-order] seller Resend', sellerRes.detail)
            warnings.push(
              `Seller email failed (Resend). Verify RESEND_FROM_ORDERS_EMAIL (or RESEND_FROM_EMAIL) uses a verified domain in Resend, and that the recipient is allowed for your plan. ${sellerRes.detail}`,
            )
          } else {
            channelResults.seller_email = 'sent'
          }
        }
      }

      let buyerEmail = order.guest_email?.trim() || null
      const guestStored = Boolean(buyerEmail)
      const custId = order.customer_id as string | null | undefined
      if (!buyerEmail && custId) {
        const { data: buyerUser, error: be } = await admin.auth.admin.getUserById(
          custId,
        )
        if (be) {
          warnings.push(
            `Could not load buyer email (auth): ${be.message}. Buyer confirmation was skipped.`,
          )
        } else {
          buyerEmail = buyerUser?.user?.email?.trim() || null
        }
      }
      if (buyerEmail && custId && !guestStored) {
        warnings.push(
          'Buyer confirmation used the signed-in account email because guest_email was empty on this order. Apply the latest create_order_from_cart migration (order saves checkout email even with a session) so the address from checkout is stored and emailed.',
        )
      }
      if (delivery.buyer_email_state === 'sent') {
        channelResults.buyer_email = 'skipped'
        warnings.push('Buyer confirmation email already sent; skipping replay.')
      } else if (buyerEmail) {
        const claimed = await claimChannelIfNeeded(admin, orderId, 'buyer_email_state')
        if (!claimed) {
          channelResults.buyer_email = 'skipped'
          warnings.push('Buyer confirmation email already in-flight or sent; skipping replay.')
        } else {
          const guestRes = await sendResend({
            apiKey: resendKey,
            from: resendFrom,
            to: buyerEmail,
            subject: `We received your order — ${store.name}`,
            text: `Thanks for your order.\n\n${textBody}`,
          })
          await markChannelResult(admin, orderId, 'buyer_email', guestRes)
          if (!guestRes.ok) {
            channelResults.buyer_email = 'failed'
            console.error('[notify-order] buyer Resend', guestRes.detail)
            warnings.push(`Buyer confirmation email failed: ${guestRes.detail}`)
          } else {
            channelResults.buyer_email = 'sent'
          }
        }
      } else {
        channelResults.buyer_email = 'skipped'
      }
    }

    const sellerSms = normalizePhoneRecipient(store.whatsapp_phone_e164)
    const planRaw = store.profiles?.signup_plan
    const storePlanId =
      typeof planRaw === 'string' && planRaw.trim()
        ? planRaw.trim().toLowerCase()
        : 'free'
    smsRecipientTail = sellerSms ? sellerSms.slice(-4) : null
    smsRecipientFull = sellerSms
    const smsEnabledRaw = (Deno.env.get('ARKESEL_SMS_ENABLED') ?? 'true').trim().toLowerCase()
    const smsEnabled = smsEnabledRaw !== 'false' && smsEnabledRaw !== '0' && smsEnabledRaw !== 'no'
    const arkeselKey = Deno.env.get('ARKESEL_SMS_API_KEY')?.trim() ?? ''
    const arkeselSender = Deno.env.get('ARKESEL_SMS_SENDER_ID')?.trim() ?? null
    if (delivery.seller_sms_state === 'sent') {
      channelResults.seller_sms = 'skipped'
      smsSkipReason = 'already_sent'
    } else if (!smsEnabled) {
      channelResults.seller_sms = 'skipped'
      smsSkipReason = 'disabled'
    } else if (!AUTO_SMS_PLAN_IDS.has(storePlanId)) {
      channelResults.seller_sms = 'skipped'
      smsSkipReason = 'plan_not_eligible_manual_only'
    } else if (!arkeselKey) {
      channelResults.seller_sms = 'skipped'
      smsSkipReason = 'missing_api_key'
      warnings.push('ARKESEL_SMS_API_KEY missing; seller SMS notification skipped.')
    } else if (!sellerSms) {
      channelResults.seller_sms = 'skipped'
      smsSkipReason = 'missing_or_invalid_recipient'
      warnings.push('Store phone is missing/invalid; seller SMS notification skipped.')
    } else {
      const claimed = await claimChannelIfNeeded(admin, orderId, 'seller_sms_state')
      if (!claimed) {
        channelResults.seller_sms = 'skipped'
        smsSkipReason = 'already_in_flight_or_sent'
      } else {
        smsAttempted = true
        const smsOrderText = sellerSms160({
          orderRef,
          storeName: store.name,
          buyerName: order.guest_name,
          buyerPhone: order.guest_phone,
        })
        const smsRes = await sendArkeselSms({
          apiKey: arkeselKey,
          senderId: arkeselSender,
          to: sellerSms,
          text: smsOrderText,
        })
        smsHttpStatus = smsRes.status
        smsBodySlice = smsRes.bodySlice
        await markChannelResult(admin, orderId, 'seller_sms', smsRes)
        if (!smsRes.ok) {
          channelResults.seller_sms = 'failed'
          smsAccepted = false
          warnings.push(`Seller SMS failed (Arkesel): ${smsRes.detail}`)
          await logSmsNotification(admin, {
            function_name: 'notify-order',
            event_type: 'seller_order_notification',
            status: 'failed',
            recipient_phone_e164: sellerSms,
            detail: smsRes.detail,
            metadata: { order_id: orderId, order_ref: orderRef, store_id: store.id },
          })
        } else {
          channelResults.seller_sms = 'sent'
          smsAccepted = true
          await logSmsNotification(admin, {
            function_name: 'notify-order',
            event_type: 'seller_order_notification',
            status: 'sent',
            recipient_phone_e164: sellerSms,
            detail: 'sent',
            metadata: { order_id: orderId, order_ref: orderRef, store_id: store.id },
          })
        }
      }
    }

    const buyerSms = normalizePhoneRecipient(order.guest_phone ?? null)
    if (delivery.buyer_sms_state === 'sent') {
      channelResults.buyer_sms = 'skipped'
      warnings.push('Buyer order SMS already sent; skipping replay.')
    } else if (!smsEnabled) {
      channelResults.buyer_sms = 'skipped'
      warnings.push('Buyer order SMS skipped (ARKESEL_SMS_ENABLED=false).')
    } else if (!AUTO_SMS_PLAN_IDS.has(storePlanId)) {
      channelResults.buyer_sms = 'skipped'
      warnings.push('Buyer order SMS skipped (free tier is manual SMS only).')
    } else if (!arkeselKey) {
      channelResults.buyer_sms = 'skipped'
      warnings.push('Buyer order SMS skipped (ARKESEL_SMS_API_KEY missing).')
    } else if (!buyerSms) {
      channelResults.buyer_sms = 'skipped'
      warnings.push('Buyer order SMS skipped (missing recipient phone).')
    } else {
      const claimed = await claimChannelIfNeeded(admin, orderId, 'buyer_sms_state')
      if (!claimed) {
        channelResults.buyer_sms = 'skipped'
        warnings.push('Buyer order SMS already in-flight or sent; skipping replay.')
      } else {
        const buyerText = buyerOrderSms160({
          orderRef,
          storeName: store.name,
          totalGhs,
          itemCount,
        })
        const buyerSmsRes = await sendArkeselSms({
          apiKey: arkeselKey,
          senderId: arkeselSender,
          to: buyerSms,
          text: buyerText,
        })
        await markChannelResult(admin, orderId, 'buyer_sms', buyerSmsRes)
        if (!buyerSmsRes.ok) {
          channelResults.buyer_sms = 'failed'
          warnings.push(`Buyer order SMS failed: ${buyerSmsRes.detail}`)
          await logSmsNotification(admin, {
            function_name: 'notify-order',
            event_type: 'buyer_order_notification',
            status: 'failed',
            recipient_phone_e164: buyerSms,
            detail: buyerSmsRes.detail,
            metadata: { order_id: orderId, order_ref: orderRef, store_id: store.id },
          })
        } else {
          channelResults.buyer_sms = 'sent'
          await logSmsNotification(admin, {
            function_name: 'notify-order',
            event_type: 'buyer_order_notification',
            status: 'sent',
            recipient_phone_e164: buyerSms,
            detail: 'sent',
            metadata: { order_id: orderId, order_ref: orderRef, store_id: store.id },
          })
        }
      }
    }

    return Response.json(
      {
        ok: true,
        ...(warnings.length ? { warnings } : {}),
        channels: channelResults,
        diagnostics: {
          sms_attempted: smsAttempted,
          sms_accepted: smsAccepted,
          sms_http_status: smsHttpStatus,
          sms_skip_reason: smsSkipReason,
          sms_recipient_tail: smsRecipientTail,
          sms_recipient_full: smsRecipientFull,
          sms_body_slice: smsBodySlice,
        },
      },
      { headers: cors },
    )
  } catch (e) {
    console.error(e)
    return Response.json(
      { error: e instanceof Error ? e.message : 'Server error' },
      { status: 500, headers: cors },
    )
  }
})
