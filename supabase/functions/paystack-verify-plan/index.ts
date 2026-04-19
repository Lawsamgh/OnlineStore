import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { sendSellerPlanSubscribedEmail } from '../_shared/sendSellerPlanEmail.ts'
import {
  extractPaystackPaymentFields,
  intPesewasFromUnknown,
} from '../_shared/paystackPaymentDetails.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

/** Monthly GHS × 100 (pesewas). Keep aligned with `src/constants/pricingPlans.ts`. */
const PLAN_MONTHLY_PESEWAS: Record<string, number> = {
  starter: 15000,
  growth: 35000,
  pro: 65000,
}

const PAID_PLAN_IDS = new Set(Object.keys(PLAN_MONTHLY_PESEWAS))

type Body = { reference?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY') ?? ''

    if (!supabaseUrl || !anonKey || !serviceKey || !paystackSecret) {
      return Response.json(
        { error: 'Missing Paystack or Supabase configuration' },
        { status: 500, headers: cors },
      )
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser()
    if (authErr || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors })
    }

    let body: Body
    try {
      body = (await req.json()) as Body
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: cors })
    }

    const reference = typeof body.reference === 'string' ? body.reference.trim() : ''
    if (!reference || !reference.startsWith('plan_')) {
      return Response.json({ error: 'Invalid reference' }, { status: 400, headers: cors })
    }

    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${paystackSecret}` },
      },
    )
    const verifyJson = (await verifyRes.json()) as {
      status?: boolean
      message?: string
      data?: {
        status?: string
        amount?: number
        channel?: string
        fees?: number | string
        metadata?: Record<string, unknown>
        customer?: unknown
      }
    }

    if (!verifyRes.ok || !verifyJson?.data) {
      return Response.json(
        { error: verifyJson?.message ?? 'Paystack verify failed' },
        { status: 400, headers: cors },
      )
    }

    const d = verifyJson.data
    if (d.status !== 'success') {
      return Response.json({ error: 'Payment was not successful' }, { status: 400, headers: cors })
    }

    const meta = d.metadata ?? {}
    const purpose = typeof meta.purpose === 'string' ? meta.purpose : ''
    if (purpose !== 'seller_plan_subscription') {
      return Response.json({ error: 'Not a plan checkout' }, { status: 400, headers: cors })
    }

    const metaUserId = typeof meta.user_id === 'string' ? meta.user_id : ''
    if (!metaUserId || metaUserId !== user.id) {
      return Response.json({ error: 'Payment does not belong to this account' }, { status: 403, headers: cors })
    }

    const planId = typeof meta.plan_id === 'string' ? meta.plan_id.trim().toLowerCase() : ''
    if (!PAID_PLAN_IDS.has(planId)) {
      return Response.json({ error: 'Invalid plan in payment' }, { status: 400, headers: cors })
    }

    const expected = PLAN_MONTHLY_PESEWAS[planId]
    const paid = intPesewasFromUnknown(d.amount)
    if (paid == null || paid !== expected) {
      return Response.json({ error: 'Amount mismatch' }, { status: 400, headers: cors })
    }

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: existing, error: guErr } = await admin.auth.admin.getUserById(user.id)
    if (guErr || !existing?.user) {
      return Response.json(
        { error: guErr?.message ?? 'Could not load user' },
        { status: 500, headers: cors },
      )
    }

    const prev = (existing.user.user_metadata ?? {}) as Record<string, unknown>
    const { error: upErr } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...prev, signup_plan: planId },
    })
    if (upErr) {
      return Response.json({ error: upErr.message }, { status: 500, headers: cors })
    }

    /** Keep `seller_subscriptions` in sync so dashboard plan upgrades show in Table Editor / store UI. */
    const { data: ownedStores, error: stErr } = await admin
      .from('stores')
      .select('id')
      .eq('owner_id', user.id)

    if (stErr) {
      return Response.json({ error: stErr.message }, { status: 500, headers: cors })
    }

    let paystackCustomerCode: string | null = null
    const cust = d.customer
    if (cust != null && typeof cust === 'object' && 'customer_code' in cust) {
      const cc = (cust as { customer_code?: string }).customer_code
      if (typeof cc === 'string' && cc.trim()) paystackCustomerCode = cc.trim()
    } else if (typeof cust === 'number') {
      paystackCustomerCode = String(cust)
    }

    const periodEnd = new Date()
    periodEnd.setUTCDate(periodEnd.getUTCDate() + 30)

    const payFields = extractPaystackPaymentFields(d as unknown as Record<string, unknown>)

    const storeRows = ownedStores ?? []
    if (storeRows.length > 0) {
      const nowIso = new Date().toISOString()
      const subRows = storeRows.map((s) => ({
        store_id: s.id as string,
        paystack_customer_code: paystackCustomerCode,
        paystack_subscription_code: null,
        status: 'active' as const,
        plan_interval: 'monthly' as const,
        current_period_end: periodEnd.toISOString(),
        pricing_plan_id: planId,
        updated_at: nowIso,
        paid_amount_pesewas: payFields.paid_amount_pesewas,
        payment_channel: payFields.payment_channel,
        paystack_fee_pesewas: payFields.paystack_fee_pesewas,
      }))
      const { error: subErr } = await admin.from('seller_subscriptions').upsert(subRows, {
        onConflict: 'store_id',
      })
      if (subErr) {
        return Response.json({ error: subErr.message }, { status: 500, headers: cors })
      }
    }

    await sendSellerPlanSubscribedEmail({
      resendApiKey: Deno.env.get('RESEND_API_KEY') ?? undefined,
      resendFromEmail: Deno.env.get('RESEND_FROM_EMAIL') ?? 'onboarding@resend.dev',
      to: existing.user.email ?? user.email ?? undefined,
      planId,
      source: 'account',
      periodEndsAtIso: periodEnd.toISOString(),
    })

    return Response.json(
      {
        ok: true,
        plan_id: planId,
        stores_synced: storeRows.length,
        payment_snapshot: payFields,
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
