import { createClient } from 'npm:@supabase/supabase-js'
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

/** Monthly GHS × 100 (pesewas). Keep aligned with `paystack-init` and `src/constants/pricingPlans.ts`. */
const PLAN_MONTHLY_PESEWAS: Record<string, number> = {
  starter: 15000,
  growth: 35000,
  pro: 65000,
}
const PLAN_PRICING_KEYS: Record<string, string> = {
  starter: 'seller_subscription_monthly_pesewas_starter',
  growth: 'seller_subscription_monthly_pesewas_growth',
  pro: 'seller_subscription_monthly_pesewas_pro',
}

const PAID_PLAN_IDS = new Set(Object.keys(PLAN_MONTHLY_PESEWAS))

type Body = { reference?: string; store_id?: string }

function strMeta(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY') ?? ''
    const legacyExpectedPesewas = Number(
      Deno.env.get('PAYSTACK_SUBSCRIPTION_AMOUNT_PESEWAS') ?? '10000',
    )

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
    const storeIdBody = typeof body.store_id === 'string' ? body.store_id.trim() : ''
    if (!reference.startsWith('sub_')) {
      return Response.json({ error: 'Invalid reference' }, { status: 400, headers: cors })
    }
    if (!storeIdBody) {
      return Response.json({ error: 'store_id required' }, { status: 400, headers: cors })
    }

    const admin = createClient(supabaseUrl, serviceKey)
    const dynamicPlanMonthlyPesewas = { ...PLAN_MONTHLY_PESEWAS }
    const { data: pricingRows } = await admin
      .from('platform_settings')
      .select('key, value')
      .in('key', Object.values(PLAN_PRICING_KEYS))
    if (Array.isArray(pricingRows)) {
      for (const [id, key] of Object.entries(PLAN_PRICING_KEYS)) {
        const row = pricingRows.find((r) => r?.key === key)
        const n = Number.parseInt(String(row?.value ?? '').trim(), 10)
        if (Number.isFinite(n) && n > 0) dynamicPlanMonthlyPesewas[id] = n
      }
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

    let meta: Record<string, unknown> =
      d.metadata != null && typeof d.metadata === 'object' && !Array.isArray(d.metadata)
        ? (d.metadata as Record<string, unknown>)
        : {}
    if (typeof d.metadata === 'string') {
      try {
        const parsed = JSON.parse(d.metadata) as unknown
        if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          meta = parsed as Record<string, unknown>
        }
      } catch {
        meta = {}
      }
    }
    const purpose = typeof meta.purpose === 'string' ? meta.purpose : ''
    if (purpose !== 'seller_subscription') {
      return Response.json({ error: 'Not a store subscription checkout' }, { status: 400, headers: cors })
    }

    const metaUserId = strMeta(meta.user_id)
    if (!metaUserId || metaUserId !== user.id) {
      return Response.json({ error: 'Payment does not belong to this account' }, { status: 403, headers: cors })
    }

    const metaStoreId = strMeta(meta.store_id)
    if (!metaStoreId || metaStoreId !== storeIdBody) {
      return Response.json(
        { error: 'Store does not match payment' },
        { status: 400, headers: cors },
      )
    }

    const metaPlan = strMeta(meta.plan_id).toLowerCase()
    const paid = intPesewasFromUnknown(d.amount) ?? NaN

    /** Infer tier from charged pesewas when Paystack omits or flattens `plan_id` in verify metadata. */
    function planIdFromAmount(pesewas: number): string | null {
      for (const [id, v] of Object.entries(dynamicPlanMonthlyPesewas)) {
        if (v === pesewas) return id
      }
      return null
    }

    let feePlanId: string | null = null
    if (metaPlan && PAID_PLAN_IDS.has(metaPlan)) {
      const expected = dynamicPlanMonthlyPesewas[metaPlan]!
      if (paid !== expected) {
        return Response.json({ error: 'Amount mismatch' }, { status: 400, headers: cors })
      }
      feePlanId = metaPlan
    } else {
      const inferred = planIdFromAmount(paid)
      if (inferred) {
        feePlanId = inferred
      } else if (paid === legacyExpectedPesewas) {
        feePlanId = null
      } else {
        return Response.json({ error: 'Amount mismatch' }, { status: 400, headers: cors })
      }
    }

    let paystackCustomerCode: string | null = null
    const cust = d.customer
    if (cust != null && typeof cust === 'object' && 'customer_code' in cust) {
      const cc = (cust as { customer_code?: string }).customer_code
      if (typeof cc === 'string' && cc.trim()) paystackCustomerCode = cc.trim()
    } else if (typeof cust === 'number') {
      paystackCustomerCode = String(cust)
    }

    const { data: store, error: se } = await admin
      .from('stores')
      .select('id, owner_id, name')
      .eq('id', metaStoreId)
      .maybeSingle()

    if (se || !store || store.owner_id !== user.id) {
      return Response.json({ error: 'Store not found' }, { status: 404, headers: cors })
    }

    const periodEnd = new Date()
    periodEnd.setUTCDate(periodEnd.getUTCDate() + 30)

    const payFields = extractPaystackPaymentFields(d as unknown as Record<string, unknown>)

    const subRow: Record<string, unknown> = {
      store_id: metaStoreId,
      paystack_customer_code: paystackCustomerCode,
      paystack_subscription_code: null,
      status: 'active',
      plan_interval: 'monthly',
      current_period_end: periodEnd.toISOString(),
      updated_at: new Date().toISOString(),
      paid_amount_pesewas: payFields.paid_amount_pesewas,
      payment_channel: payFields.payment_channel,
      paystack_fee_pesewas: payFields.paystack_fee_pesewas,
    }
    if (feePlanId) subRow.pricing_plan_id = feePlanId
    else subRow.pricing_plan_id = null

    const { error: upErr } = await admin.from('seller_subscriptions').upsert(subRow, {
      onConflict: 'store_id',
    })

    if (upErr) {
      return Response.json({ error: upErr.message }, { status: 500, headers: cors })
    }

    if (feePlanId) {
      const { data: existing, error: guErr } = await admin.auth.admin.getUserById(user.id)
      if (guErr || !existing?.user) {
        return Response.json(
          { error: guErr?.message ?? 'Could not load user' },
          { status: 500, headers: cors },
        )
      }
      const prev = (existing.user.user_metadata ?? {}) as Record<string, unknown>
      const { error: authUpErr } = await admin.auth.admin.updateUserById(user.id, {
        user_metadata: { ...prev, signup_plan: feePlanId },
      })
      if (authUpErr) {
        return Response.json({ error: authUpErr.message }, { status: 500, headers: cors })
      }
    }

    const storeRec = store as { name?: string | null } | null
    const storeName = storeRec?.name?.trim() ? storeRec.name.trim() : null

    await sendSellerPlanSubscribedEmail({
      resendApiKey: Deno.env.get('RESEND_API_KEY') ?? undefined,
      resendFromEmail:
        Deno.env.get('RESEND_FROM_BILLING_EMAIL') ??
        Deno.env.get('RESEND_FROM_EMAIL') ??
        'onboarding@resend.dev',
      to: user.email ?? undefined,
      planId: feePlanId,
      source: 'store',
      periodEndsAtIso: periodEnd.toISOString(),
      storeName,
    })

    return Response.json(
      {
        ok: true,
        store_id: metaStoreId,
        plan_id: feePlanId,
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
