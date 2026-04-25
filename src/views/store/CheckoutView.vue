<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { placeOrder } from '../../composables/usePlaceOrder'
import { useRealtimeTableRefresh } from '../../composables/useRealtimeTableRefresh'
import { getSupabaseBrowser, isSupabaseConfigured } from '../../lib/supabase'
import { formatGhs } from '../../lib/formatMoney'
import { useCartStore } from '../../stores/cart'
import { useUiStore } from '../../stores/ui'
import { useToastStore } from '../../stores/toast'
import SkeletonCheckout from '../../components/skeleton/SkeletonCheckout.vue'

const route = useRoute()
const router = useRouter()
const cart = useCartStore()
const ui = useUiStore()
const toast = useToastStore()

const slug = computed(() => String(route.params.storeSlug ?? ''))

const store = ref<{ id: string; slug: string; name: string } | null>(null)
const loading = ref(true)

const deliveryAddress = ref('')
const customerNotes = ref('')
const guestName = ref('')
const guestEmail = ref('')
const guestPhone = ref('')
const submitting = ref(false)

async function loadStore(opts?: { silent?: boolean }) {
  const silent = opts?.silent ?? false
  if (!silent) {
    loading.value = true
    store.value = null
  }
  if (!isSupabaseConfigured() || !slug.value) {
    if (!silent) toast.error('Checkout unavailable.')
    store.value = null
    if (!silent) loading.value = false
    return
  }
  const supabase = getSupabaseBrowser()
  const { data, error } = await supabase
    .from('stores')
    .select('id, slug, name')
    .eq('slug', slug.value)
    .eq('is_active', true)
    .maybeSingle()
  if (error || !data) {
    if (!silent) toast.error(error?.message ?? 'Store not found.')
    store.value = null
  } else {
    store.value = data
    if (cart.storeId !== data.id) {
      cart.setStoreContext(data.id, data.slug)
    }
  }
  if (!silent) loading.value = false
}

onMounted(() => {
  void loadStore()
})
watch(slug, () => {
  void loadStore()
})

useRealtimeTableRefresh({
  channelName: () =>
    `storefront-checkout:${slug.value}:${store.value?.id ?? 'pending'}`,
  deps: [slug, () => store.value?.id ?? ''],
  debounceMs: 400,
  getTables: () => {
    const id = store.value?.id
    if (!id) return []
    return [{ table: 'stores', filter: `id=eq.${id}` }]
  },
  onEvent: () => loadStore({ silent: true }),
})

const canSubmit = computed(() => {
  if (!store.value || !cart.lines.length || cart.storeId !== store.value.id)
    return false
  if (!deliveryAddress.value.trim()) return false
  return (
    guestName.value.trim().length > 0 &&
    guestEmail.value.trim().length > 0 &&
    guestPhone.value.trim().length > 0
  )
})

async function submit() {
  if (!store.value || !canSubmit.value) return
  submitting.value = true
  try {
    const result = await placeOrder({
      storeSlug: store.value.slug,
      deliveryAddress: deliveryAddress.value.trim(),
      customerNotes: customerNotes.value.trim(),
      lines: cart.lines,
      guest: {
        guestName: guestName.value.trim(),
        guestEmail: guestEmail.value.trim(),
        guestPhone: guestPhone.value.trim(),
      },
    })
    cart.clearLines()
    ui.closeCart()
    toast.success('Order placed.')
    await router.push({
      name: 'order-success',
      params: { storeSlug: store.value.slug, orderId: result.order.id },
      query: { t: result.order.notify_token },
    })
    const warnBits: string[] = []
    if (!result.notifyOk && result.notifyError) warnBits.push(result.notifyError)
    if (result.notifyWarnings?.length) warnBits.push(...result.notifyWarnings)
    if (warnBits.length) {
      sessionStorage.setItem('lastOrderNotifyWarning', warnBits.join(' '))
    } else {
      sessionStorage.removeItem('lastOrderNotifyWarning')
    }
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'Checkout failed')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
    <div class="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">

      <!-- Back link -->
      <RouterLink
        :to="`/${slug}`"
        class="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-emerald-700"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        Back to store
      </RouterLink>

      <!-- Page heading -->
      <div class="mt-6 mb-8">
        <h1 class="text-3xl font-extrabold tracking-tight text-slate-900">Checkout</h1>
        <p class="mt-1.5 text-sm text-slate-500">
          Pay the seller directly (cash, MoMo, etc.) — this step sends your order to the shop.
        </p>
      </div>

      <!-- Skeleton -->
      <SkeletonCheckout v-if="loading" />

      <!-- Error state -->
      <div
        v-else-if="!store"
        class="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm"
      >
        <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
          <svg class="h-7 w-7 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        </span>
        <h2 class="mt-4 text-lg font-semibold text-slate-800">Store unavailable</h2>
        <p class="mt-1 text-sm text-slate-500">This checkout link is not valid or the store is currently inactive.</p>
      </div>

      <template v-else-if="store">
        <!-- Empty cart -->
        <div
          v-if="!cart.lines.length"
          class="flex flex-col items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 px-6 py-14 text-center"
        >
          <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100">
            <svg class="h-7 w-7 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          </span>
          <h2 class="mt-4 text-lg font-semibold text-amber-900">Your cart is empty</h2>
          <p class="mt-1 text-sm text-amber-700">Add items before checking out.</p>
          <RouterLink
            :to="`/${slug}`"
            class="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700"
          >
            Return to {{ store.name }}
          </RouterLink>
        </div>

        <!-- Main checkout layout -->
        <form v-else class="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]" @submit.prevent="submit">

          <!-- Left column: form sections -->
          <div class="space-y-5">

            <!-- Delivery section -->
            <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div class="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
                  <svg class="h-4 w-4 text-emerald-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                </span>
                <div>
                  <p class="text-sm font-semibold text-slate-800">Delivery details</p>
                  <p class="text-xs text-slate-500">Where should we deliver?</p>
                </div>
              </div>
              <div class="space-y-4 p-5">
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-wide text-slate-500" for="addr">
                    Delivery address <span class="text-red-500">*</span>
                  </label>
                  <textarea
                    id="addr"
                    v-model="deliveryAddress"
                    required
                    rows="3"
                    placeholder="Enter your full delivery address…"
                    :disabled="submitting"
                    class="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 shadow-inner transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-wide text-slate-500" for="notes">
                    Notes for seller <span class="text-slate-400 normal-case font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="notes"
                    v-model="customerNotes"
                    rows="2"
                    placeholder="Any special instructions or requests…"
                    :disabled="submitting"
                    class="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 shadow-inner transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>
            </section>

            <!-- Contact section -->
            <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div class="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-100">
                  <svg class="h-4 w-4 text-blue-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </span>
                <div>
                  <p class="text-sm font-semibold text-slate-800">Contact details</p>
                  <p class="text-xs text-slate-500">For order updates and delivery</p>
                </div>
              </div>
              <div class="space-y-4 p-5">
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-wide text-slate-500" for="gname">
                    Full name <span class="text-red-500">*</span>
                  </label>
                  <input
                    id="gname"
                    v-model="guestName"
                    type="text"
                    required
                    autocomplete="name"
                    placeholder="Your full name"
                    :disabled="submitting"
                    class="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 shadow-inner transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label class="block text-xs font-semibold uppercase tracking-wide text-slate-500" for="gemail">
                      Email <span class="text-red-500">*</span>
                    </label>
                    <input
                      id="gemail"
                      v-model="guestEmail"
                      type="email"
                      required
                      autocomplete="email"
                      placeholder="you@example.com"
                      :disabled="submitting"
                      class="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 shadow-inner transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold uppercase tracking-wide text-slate-500" for="gphone">
                      Phone <span class="text-red-500">*</span>
                    </label>
                    <input
                      id="gphone"
                      v-model="guestPhone"
                      type="tel"
                      required
                      autocomplete="tel"
                      placeholder="+233 XX XXX XXXX"
                      :disabled="submitting"
                      class="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 shadow-inner transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>
            </section>
          </div>

          <!-- Right column: order summary + CTA -->
          <div class="flex flex-col gap-5">
            <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div class="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-100">
                  <svg class="h-4 w-4 text-violet-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
                </span>
                <div>
                  <p class="text-sm font-semibold text-slate-800">Order summary</p>
                  <p class="text-xs text-slate-500">{{ cart.lines.length }} item{{ cart.lines.length !== 1 ? 's' : '' }} in your cart</p>
                </div>
              </div>
              <div class="divide-y divide-slate-100 px-5">
                <div
                  v-for="line in cart.lines"
                  :key="line.productId"
                  class="flex items-center justify-between gap-3 py-3.5"
                >
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-slate-800">{{ line.title }}</p>
                    <p class="text-xs text-slate-500">Qty {{ line.quantity }}</p>
                  </div>
                  <p class="shrink-0 text-sm font-semibold text-slate-900">
                    {{ formatGhs(line.unitPriceCents * line.quantity) }}
                  </p>
                </div>
              </div>
              <div class="border-t border-dashed border-slate-200 bg-slate-50/60 px-5 py-4">
                <div class="flex items-center justify-between text-xs text-slate-500">
                  <span>Subtotal</span>
                  <span>{{ formatGhs(cart.lineTotalCents) }}</span>
                </div>
                <div class="mt-1 flex items-center justify-between text-xs text-slate-500">
                  <span>Delivery</span>
                  <span class="text-emerald-600 font-medium">Pay seller directly</span>
                </div>
                <div class="mt-3 flex items-center justify-between">
                  <span class="text-sm font-semibold text-slate-900">Total (reference)</span>
                  <span class="text-lg font-extrabold text-emerald-700">{{ formatGhs(cart.lineTotalCents) }}</span>
                </div>
              </div>
            </section>

            <!-- Trust badge -->
            <div class="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
              <svg class="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <p class="text-xs leading-relaxed text-emerald-800">
                Your contact info is only shared with the seller to process your order. Payment is made directly to them.
              </p>
            </div>

            <!-- Submit button -->
            <button
              type="submit"
              class="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-emerald-700 py-4 text-sm font-bold tracking-wide text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!canSubmit || submitting"
            >
              <svg v-if="!submitting" class="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              <svg v-else class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" /></svg>
              {{ submitting ? 'Placing your order…' : 'Place order' }}
            </button>

            <p class="text-center text-[11px] text-slate-400">
              By placing this order you agree to the seller's terms.
            </p>
          </div>
        </form>
      </template>
    </div>
  </div>
</template>
