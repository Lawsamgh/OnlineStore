/** Resend confirmation when a seller completes a paid plan / platform subscription. */

function planDisplayName(planId: string | null | undefined): string | null {
  if (!planId || typeof planId !== 'string') return null
  const id = planId.trim().toLowerCase()
  if (id === 'starter') return 'Starter'
  if (id === 'growth') return 'Growth'
  if (id === 'pro') return 'Pro'
  return id.charAt(0).toUpperCase() + id.slice(1)
}

function formatPeriodEnd(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return d.toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type SellerPlanEmailSource = 'account' | 'store'

/**
 * Fire-and-forget Resend email. Does not throw — logs on failure.
 * Skips when `RESEND_API_KEY` or recipient email is missing.
 */
export async function sendSellerPlanSubscribedEmail(opts: {
  resendApiKey: string | undefined
  resendFromEmail: string
  to: string | null | undefined
  planId: string | null | undefined
  source: SellerPlanEmailSource
  /** Current period end (ISO) shown in the email */
  periodEndsAtIso: string
  /** For `store` source — shop display name */
  storeName?: string | null
}): Promise<void> {
  const key = opts.resendApiKey?.trim()
  const to = opts.to?.trim()
  if (!key || !to) return

  const from = opts.resendFromEmail.trim() || 'onboarding@resend.dev'
  const label = planDisplayName(opts.planId)
  const endHuman = formatPeriodEnd(opts.periodEndsAtIso)
  const endBlock =
    endHuman.length > 0
      ? `\n\nYour current period is set to end: ${endHuman}.`
      : ''

  let subject: string
  let text: string
  let html: string

  if (opts.source === 'account') {
    const tier = label ?? 'your new plan'
    subject = `Subscription confirmed — ${tier}`
    text = `Hello,

Thank you for subscribing. Your seller account is now on the ${tier} plan.${endBlock}

You can manage your shops and billing from your seller dashboard.

— The team`
    html = `<p>Hello,</p><p>Thank you for subscribing. Your seller account is now on the <strong>${escapeHtml(
      tier,
    )}</strong> plan.</p>${
      endHuman
        ? `<p>Your current period is set to end: <strong>${escapeHtml(endHuman)}</strong>.</p>`
        : ''
    }<p>You can manage your shops and billing from your seller dashboard.</p><p>— The team</p>`
  } else {
    const shop = opts.storeName?.trim() || 'your store'
    const tierPhrase = label ? ` on the ${label} plan` : ''
    subject = `Platform subscription active — ${shop}`
    text = `Hello,

Your platform subscription for "${shop}" is confirmed${tierPhrase}.${endBlock}

You can review this store anytime from your seller dashboard.

— The team`
    html = `<p>Hello,</p><p>Your platform subscription for <strong>${escapeHtml(
      shop,
    )}</strong> is confirmed${label ? ` on the <strong>${escapeHtml(label)}</strong> plan` : ''}.</p>${
      endHuman
        ? `<p>Your current period is set to end: <strong>${escapeHtml(endHuman)}</strong>.</p>`
        : ''
    }<p>You can review this store anytime from your seller dashboard.</p><p>— The team</p>`
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Subscriptions <${from}>`,
        to: [to],
        subject,
        text,
        html,
      }),
    })
    if (!r.ok) {
      console.error('[sendSellerPlanSubscribedEmail] Resend HTTP', r.status, await r.text())
    }
  } catch (e) {
    console.error('[sendSellerPlanSubscribedEmail]', e)
  }
}

/** 7-day renewal reminder email for active/trialing seller subscriptions. */
export async function sendSellerPlanRenewalReminderEmail(opts: {
  resendApiKey: string | undefined
  resendFromEmail: string
  to: string | null | undefined
  planId: string | null | undefined
  periodEndsAtIso: string
  storeName?: string | null
}): Promise<void> {
  const key = opts.resendApiKey?.trim()
  const to = opts.to?.trim()
  if (!key || !to) return

  const from = opts.resendFromEmail.trim() || 'onboarding@resend.dev'
  const label = planDisplayName(opts.planId) ?? 'current'
  const endHuman = formatPeriodEnd(opts.periodEndsAtIso)
  const shop = opts.storeName?.trim() || 'your store'

  const subject = `Renewal reminder — ${shop} (${label})`
  const text = `Hello,

Your store subscription for "${shop}" is due to end in 7 days.
Plan: ${label}
${endHuman ? `Current period end: ${endHuman}` : ''}

To avoid storefront interruption, please renew before the period ends.

— The team`

  const html = `<p>Hello,</p>
<p>Your store subscription for <strong>${escapeHtml(shop)}</strong> is due to end in <strong>7 days</strong>.</p>
<p>Plan: <strong>${escapeHtml(label)}</strong></p>
${endHuman ? `<p>Current period end: <strong>${escapeHtml(endHuman)}</strong></p>` : ''}
<p>To avoid storefront interruption, please renew before the period ends.</p>
<p>— The team</p>`

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Subscriptions <${from}>`,
        to: [to],
        subject,
        text,
        html,
      }),
    })
    if (!r.ok) {
      console.error('[sendSellerPlanRenewalReminderEmail] Resend HTTP', r.status, await r.text())
    }
  } catch (e) {
    console.error('[sendSellerPlanRenewalReminderEmail]', e)
  }
}
