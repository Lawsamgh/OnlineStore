import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type Body = { store_id?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY') ?? ''
    const amountPesewas = Number(
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

    const body = (await req.json()) as Body
    const storeId = body.store_id
    if (!storeId) {
      return Response.json({ error: 'store_id required' }, { status: 400, headers: cors })
    }

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: store, error: se } = await admin
      .from('stores')
      .select('id, name, owner_id')
      .eq('id', storeId)
      .maybeSingle()

    if (se || !store || store.owner_id !== user.id) {
      return Response.json({ error: 'Store not found' }, { status: 404, headers: cors })
    }

    const email = user.email ?? `${user.id}@customers.local`
    const reference = `sub_${store.id.slice(0, 8)}_${crypto.randomUUID().slice(0, 8)}`

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
        callback_url: Deno.env.get('PAYSTACK_CALLBACK_URL') ?? undefined,
        metadata: {
          store_id: store.id,
          purpose: 'seller_subscription',
        },
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
