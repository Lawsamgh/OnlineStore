import { createClient } from 'npm:@supabase/supabase-js'

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
const PLAN_PRICING_KEYS: Record<string, string> = {
  starter: 'seller_subscription_monthly_pesewas_starter',
  growth: 'seller_subscription_monthly_pesewas_growth',
  pro: 'seller_subscription_monthly_pesewas_pro',
}

const PAID_PLAN_IDS = new Set(Object.keys(PLAN_MONTHLY_PESEWAS))

type Body = { store_id?: string; plan_id?: string }

function stripWrappingQuotes(v: string): string {
  const s = v.trim()
  if (s.length >= 2) {
    const a = s[0]
    const b = s[s.length - 1]
    if (
      (a === '"' && b === '"') ||
      (a === "'" && b === "'") ||
      (a === '`' && b === '`')
    ) {
      return s.slice(1, -1).trim()
    }
  }
  return s
}

function normalizeOrigin(input: string | null | undefined): string {
  const raw = typeof input === 'string' ? stripWrappingQuotes(input) : ''
  if (!raw) return ''
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

function normalizeAbsoluteUrl(input: string | null | undefined): string {
  const raw = typeof input === 'string' ? stripWrappingQuotes(input) : ''
  if (!raw) return ''
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.toString()
  } catch {
    return ''
  }
}

function isLocalOrigin(origin: string): boolean {
  if (!origin) return false
  try {
    const u = new URL(origin)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  } catch {
    return false
  }
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
    const reqOrigin = normalizeOrigin(req.headers.get('origin'))
    const reqIsLocal = isLocalOrigin(reqOrigin)
    const dynamicPlanMonthlyPesewas = { ...PLAN_MONTHLY_PESEWAS }
    const { data: pricingRows } = await admin
      .from('platform_settings')
      .select('key, value')
      .in('key', Object.values(PLAN_PRICING_KEYS))
    if (Array.isArray(pricingRows)) {
      for (const [planId, key] of Object.entries(PLAN_PRICING_KEYS)) {
        const row = pricingRows.find((r) => r?.key === key)
        const n = Number.parseInt(String(row?.value ?? '').trim(), 10)
        if (Number.isFinite(n) && n > 0) dynamicPlanMonthlyPesewas[planId] = n
      }
    }

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

      amountPesewas = dynamicPlanMonthlyPesewas[planIdRaw]!
      reference = `sub_${store.id.slice(0, 8)}_${crypto.randomUUID().slice(0, 8)}`
      metadata = {
        store_id: store.id,
        user_id: user.id,
        plan_id: planIdRaw,
        purpose: 'seller_subscription',
      }
      const envStoreBase =
        normalizeOrigin(Deno.env.get('PAYSTACK_STORE_CALLBACK_BASE_URL')) ||
        normalizeOrigin(Deno.env.get('APP_BASE_URL'))
      const storeBase = reqIsLocal ? reqOrigin : envStoreBase || reqOrigin
      if (storeBase) {
        callbackUrl = `${storeBase}/dashboard/stores/${store.id}`
      } else {
        callbackUrl =
          normalizeAbsoluteUrl(Deno.env.get('PAYSTACK_CALLBACK_URL')) || undefined
      }
    } else if (planIdRaw) {
      if (!PAID_PLAN_IDS.has(planIdRaw)) {
        return Response.json({ error: 'Invalid plan_id' }, { status: 400, headers: cors })
      }
      amountPesewas = dynamicPlanMonthlyPesewas[planIdRaw]!
      reference = `plan_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
      metadata = {
        user_id: user.id,
        plan_id: planIdRaw,
        purpose: 'seller_plan_subscription',
      }
      const envPlanCallback =
        normalizeAbsoluteUrl(Deno.env.get('PAYSTACK_PLAN_CALLBACK_URL')) ||
        normalizeAbsoluteUrl(Deno.env.get('PAYSTACK_CALLBACK_URL'))
      callbackUrl = reqIsLocal
        ? reqOrigin
          ? `${reqOrigin}/dashboard`
          : envPlanCallback || undefined
        : envPlanCallback || (reqOrigin ? `${reqOrigin}/dashboard` : undefined)
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
