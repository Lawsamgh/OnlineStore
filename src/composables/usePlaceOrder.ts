import { getSupabaseBrowser, isSupabaseConfigured } from '../lib/supabase'
import { formatFunctionsInvokeError } from '../lib/formatFunctionsInvokeError'
import type { CartLine } from '../stores/cart'

export type CheckoutGuest = {
  guestName: string
  guestEmail: string
  guestPhone: string
}

export type PlaceOrderInput = {
  storeSlug: string
  deliveryAddress: string
  customerNotes: string
  lines: CartLine[]
  guest: CheckoutGuest | null
}

export type PlacedOrder = {
  id: string
  notify_token: string
}

export async function placeOrder(input: PlaceOrderInput): Promise<{
  order: PlacedOrder
  notifyOk: boolean
  notifyError: string | null
}> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured')
  }
  const supabase = getSupabaseBrowser()

  const payloadLines = input.lines.map((l) => ({
    product_id: l.productId,
    quantity: l.quantity,
  }))

  const { data: rows, error: rpcErr } = await supabase.rpc(
    'create_order_from_cart',
    {
      p_store_slug: input.storeSlug,
      p_lines: payloadLines,
      p_delivery_address: input.deliveryAddress,
      p_customer_notes: input.customerNotes,
      p_guest_name: input.guest?.guestName ?? null,
      p_guest_email: input.guest?.guestEmail ?? null,
      p_guest_phone: input.guest?.guestPhone ?? null,
    },
  )

  if (rpcErr) {
    throw rpcErr
  }

  const row = Array.isArray(rows) ? rows[0] : rows
  const orderId = row?.order_id as string | undefined
  const notifyToken = row?.notify_token as string | undefined
  if (!orderId || !notifyToken) {
    throw new Error('Order was not created')
  }

  let notifyOk = false
  let notifyError: string | null = null
  const { data: fnData, error: fnErr } = await supabase.functions.invoke(
    'notify-order',
    {
      body: {
        order_id: orderId,
        notify_token: notifyToken,
      },
    },
  )

  if (fnErr) {
    notifyError = formatFunctionsInvokeError(fnErr, 'notify-order')
  } else if (fnData && typeof fnData === 'object' && 'error' in fnData) {
    notifyError = String((fnData as { error: string }).error)
  } else {
    notifyOk = true
  }

  return {
    order: { id: orderId, notify_token: notifyToken },
    notifyOk,
    notifyError,
  }
}
