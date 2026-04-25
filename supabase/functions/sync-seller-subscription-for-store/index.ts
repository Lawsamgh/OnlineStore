import { createClient } from 'npm:@supabase/supabase-js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const PAID_PLAN_IDS = new Set(['starter', 'growth', 'pro'])

type Body = { store_id?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return Response.json(
        { error: 'Missing Supabase configuration' },
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
    const storeId = typeof body.store_id === 'string' ? body.store_id.trim() : ''
    if (!storeId) {
      return Response.json({ error: 'store_id required' }, { status: 400, headers: cors })
    }

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: store, error: stErr } = await admin
      .from('stores')
      .select('id, owner_id')
      .eq('id', storeId)
      .maybeSingle()
    if (stErr || !store || store.owner_id !== user.id) {
      return Response.json({ error: 'Store not found' }, { status: 404, headers: cors })
    }

    const { data: userRec, error: userRecErr } = await admin.auth.admin.getUserById(user.id)
    if (userRecErr || !userRec?.user) {
      return Response.json(
        { error: userRecErr?.message ?? 'Could not load user' },
        { status: 500, headers: cors },
      )
    }
    const metadata = (userRec.user.user_metadata ?? {}) as Record<string, unknown>
    const planRaw =
      typeof metadata.signup_plan === 'string' ? metadata.signup_plan.trim().toLowerCase() : ''
    if (!PAID_PLAN_IDS.has(planRaw)) {
      return Response.json(
        { ok: true, synced: false, reason: 'plan_not_paid', store_id: storeId },
        { headers: cors },
      )
    }

    const nowIso = new Date().toISOString()
    const periodEnd = new Date()
    periodEnd.setUTCDate(periodEnd.getUTCDate() + 30)

    const subRow = {
      store_id: storeId,
      status: 'active' as const,
      plan_interval: 'monthly' as const,
      current_period_end: periodEnd.toISOString(),
      pricing_plan_id: planRaw,
      updated_at: nowIso,
    }
    const { error: upErr } = await admin.from('seller_subscriptions').upsert(subRow, {
      onConflict: 'store_id',
    })
    if (upErr) {
      return Response.json({ error: upErr.message }, { status: 500, headers: cors })
    }

    return Response.json(
      { ok: true, synced: true, store_id: storeId, plan_id: planRaw },
      { headers: cors },
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Server error' },
      { status: 500, headers: cors },
    )
  }
})

