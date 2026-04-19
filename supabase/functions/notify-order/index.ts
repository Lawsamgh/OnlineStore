import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type Body = { order_id?: string; notify_token?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
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
        status,
        guest_name,
        guest_email,
        guest_phone,
        delivery_address,
        customer_notes,
        notify_token,
        stores ( id, name, slug, whatsapp_phone_e164, owner_id )
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
        }[]
      | {
          id: string
          name: string
          slug: string
          whatsapp_phone_e164: string | null
          owner_id: string
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

    const lines = (items ?? [])
      .map(
        (r: { title_snapshot: string; unit_price_cents: number; quantity: number }) =>
          `${r.quantity}× ${r.title_snapshot} @ ${(r.unit_price_cents / 100).toFixed(2)} GHS`,
      )
      .join('\n')

    const textBody = `New order for ${store.name}
Order: ${orderId}
${lines}

Address: ${order.delivery_address ?? '—'}
Notes: ${order.customer_notes ?? '—'}
Guest: ${order.guest_name ?? '—'} / ${order.guest_email ?? '—'} / ${order.guest_phone ?? '—'}
`

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const resendFrom =
      Deno.env.get('RESEND_FROM_EMAIL') ?? 'onboarding@resend.dev'

    const { data: sellerUser, error: ue } = await admin.auth.admin.getUserById(
      store.owner_id,
    )
    const sellerEmail = sellerUser?.user?.email

    if (resendKey && sellerEmail) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `Orders <${resendFrom}>`,
          to: [sellerEmail],
          subject: `[${store.name}] New order`,
          text: textBody,
        }),
      })
      if (!r.ok) {
        console.error('Resend error', await r.text())
      }
    }

    if (resendKey && order.guest_email) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `Orders <${resendFrom}>`,
          to: [order.guest_email],
          subject: `We received your order — ${store.name}`,
          text: `Thanks for your order.\n\n${textBody}`,
        }),
      })
    }

    const waToken = Deno.env.get('WHATSAPP_CLOUD_TOKEN')
    const waPhoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
    const sellerWa = store.whatsapp_phone_e164?.replace(/\D/g, '')

    if (waToken && waPhoneId && sellerWa) {
      const waRes = await fetch(
        `https://graph.facebook.com/v20.0/${waPhoneId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${waToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: sellerWa,
            type: 'text',
            text: {
              preview_url: false,
              body: textBody.slice(0, 4090),
            },
          }),
        },
      )
      if (!waRes.ok) {
        console.error('WhatsApp error', await waRes.text())
      }
    }

    return Response.json({ ok: true }, { headers: cors })
  } catch (e) {
    console.error(e)
    return Response.json(
      { error: e instanceof Error ? e.message : 'Server error' },
      { status: 500, headers: cors },
    )
  }
})
