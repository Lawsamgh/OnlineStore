/**
 * Build WhatsApp Web / app "click to chat" URLs. No API keys — opens wa.me in the browser.
 * @see https://faq.whatsapp.com/general/chats/how-to-use-click-to-chat
 */
export function whatsappDigitsFromE164(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) return null
  return digits
}

export function whatsappSendUrl(phoneDigits: string, message: string): string {
  const q = new URLSearchParams({ text: message })
  return `https://wa.me/${phoneDigits}?${q.toString()}`
}
