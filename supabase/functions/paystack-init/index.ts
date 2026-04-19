import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

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

type Body = { store_id?: string; plan_id?: string }

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

    const planIdRaw = typeof body.plan_id === 'string' ? body.plan_id.trim().toLowerCase() : ''
    const storeIdRaw = typeof body.store_id === 'string' ? body.store_id.trim() : ''

    const admin = createClient(supabaseUrl, serviceKey)

    const email = user.email ?? `${user.id}@customers.local`

    let amountPesewas: number
    let reference: string
    let metadata: Record<string, string>
    let callbackUrl: string | undefined

    if (storeIdRaw) {
      if (!planIdRaw || !PAID_PLAN_IDS.has(planIdRaw)) {
        return Response.json(
          { error: 'store checkout requires plan_id (starter, growth, or pro)' },
          { status: 400, headers: cors },
        )
      }

      const { data: store, error: se } = await admin
        .from('stores')
        .select('id, name, owner_id')
        .eq('id', storeIdRaw)
        .maybeSingle()

      if (se || !store || store.owner_id !== user.id) {
        return Response.json({ error: 'Store not found' }, { status: 404, headers: cors })
      }

      amountPesewas = PLAN_MONTHLY_PESEWAS[planIdRaw]!
      reference = `sub_${store.id.slice(0, 8)}_${crypto.randomUUID().slice(0, 8)}`
      metadata = {
        store_id: store.id,
        user_id: user.id,
        plan_id: planIdRaw,
        purpose: 'seller_subscription',
      }
      const storeBase =
        Deno.env.get('PAYSTACK_STORE_CALLBACK_BASE_URL') ??
        Deno.env.get('APP_BASE_URL') ??
        ''
      if (storeBase.trim()) {
        callbackUrl = `${storeBase.replace(/\/$/, '')}/dashboard/stores/${store.id}`
      } else {
        callbackUrl = Deno.env.get('PAYSTACK_CALLBACK_URL') ?? undefined
      }
    } else if (planIdRaw) {
      if (!PAID_PLAN_IDS.has(planIdRaw)) {
        return Response.json({ error: 'Invalid plan_id' }, { status: 400, headers: cors })
      }
      amountPesewas = PLAN_MONTHLY_PESEWAS[planIdRaw]!
      reference = `plan_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
      metadata = {
        user_id: user.id,
        plan_id: planIdRaw,
        purpose: 'seller_plan_subscription',
      }
      callbackUrl =
        Deno.env.get('PAYSTACK_PLAN_CALLBACK_URL') ??
        Deno.env.get('PAYSTACK_CALLBACK_URL') ??
        undefined
    } else {
      return Response.json(
        { error: 'Provide store_id (with plan_id) or plan_id' },
        { status: 400, headers: cors },
      )
    }

    const initRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: amountPesewas,
        currency: 'GHS',
        reference,
        callback_url: callbackUrl,
        metadata,
      }),
    })

    const initJson = await initRes.json()
    if (!initRes.ok || !initJson?.data?.authorization_url) {
      return Response.json(
        { error: initJson?.message ?? 'Paystack initialize failed' },
        { status: 400, headers: cors },
      )
    }

    return Response.json(
      {
        authorization_url: initJson.data.authorization_url as string,
        reference: initJson.data.reference as string,
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
