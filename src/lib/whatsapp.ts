/** Build a WhatsApp click-to-chat link (digits only in path). */
export function waMeLink(phoneE164OrDigits: string, text?: string): string {
  const digits = phoneE164OrDigits.replace(/\D/g, '')
  if (!digits) return 'https://wa.me/'
  const u = new URL(`https://wa.me/${digits}`)
  if (text) u.searchParams.set('text', text)
  return u.toString()
}
