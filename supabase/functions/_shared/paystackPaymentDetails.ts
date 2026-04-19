/**
 * Normalize Paystack transaction verify `data` fields for DB storage.
 * Amount and fees are in the smallest currency unit (pesewas for GHS).
 * Paystack sometimes returns numeric fields as strings; channel may live on `authorization`.
 */

export function intPesewasFromUnknown(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim().replace(/,/g, ''))
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return null
}

function channelFromVerifyData(data: Record<string, unknown>): string | null {
  const top = data.channel
  if (typeof top === 'string' && top.trim()) return top.trim().toLowerCase()

  const auth = data.authorization
  if (auth != null && typeof auth === 'object' && !Array.isArray(auth)) {
    const ch = (auth as Record<string, unknown>).channel
    if (typeof ch === 'string' && ch.trim()) return ch.trim().toLowerCase()
  }
  return null
}

function feeFromVerifyData(data: Record<string, unknown>): number | null {
  const direct = intPesewasFromUnknown(data.fees)
  if (direct != null) return direct

  const split = data.fees_split
  if (split != null && typeof split === 'object' && !Array.isArray(split)) {
    const s = split as Record<string, unknown>
    const paystack = intPesewasFromUnknown(s.paystack)
    if (paystack != null) return paystack
    const integration = intPesewasFromUnknown(s.integration)
    if (integration != null) return integration
  }
  return null
}

export function extractPaystackPaymentFields(
  data: Record<string, unknown>,
): {
  paid_amount_pesewas: number | null
  payment_channel: string | null
  paystack_fee_pesewas: number | null
} {
  const paid_amount_pesewas = intPesewasFromUnknown(data.amount)
  const payment_channel = channelFromVerifyData(data)
  const paystack_fee_pesewas = feeFromVerifyData(data)

  return { paid_amount_pesewas, payment_channel, paystack_fee_pesewas }
}
