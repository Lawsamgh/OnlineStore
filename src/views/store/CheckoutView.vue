<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { placeOrder } from '../../composables/usePlaceOrder'
import { getSupabaseBrowser, isSupabaseConfigured } from '../../lib/supabase'
import { formatGhs } from '../../lib/formatMoney'
import { useAuthStore } from '../../stores/auth'
import { useCartStore } from '../../stores/cart'
import { useUiStore } from '../../stores/ui'
import { useToastStore } from '../../stores/toast'
import SkeletonCheckout from '../../components/skeleton/SkeletonCheckout.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
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

async function loadStore() {
  loading.value = true
  if (!isSupabaseConfigured() || !slug.value) {
    toast.error('Checkout unavailable.')
    loading.value = false
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
    toast.error(error?.message ?? 'Store not found.')
    store.value = null
  } else {
    store.value = data
    if (cart.storeId !== data.id) {
      cart.setStoreContext(data.id, data.slug)
    }
  }
  loading.value = false
}

onMounted(loadStore)
watch(slug, loadStore)

const canSubmit = computed(() => {
  if (!store.value || !cart.lines.length || cart.storeId !== store.value.id)
    return false
  if (!deliveryAddress.value.trim()) return false
  if (auth.isSignedIn) return true
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
      guest: auth.isSignedIn
        ? null
        : {
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
    if (!result.notifyOk && result.notifyError) {
      // Optional: toast — keep on page navigation; success view can read sessionStorage
      sessionStorage.setItem(
        'lastOrderNotifyWarning',
        result.notifyError,
      )
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
  <div class="mx-auto max-w-lg px-4 py-8">
    <RouterLink
      :to="`/${slug}`"
      class="text-sm font-medium text-emerald-700 hover:text-emerald-800"
    >
      ← Back to store
    </RouterLink>
    <h1 class="mt-4 text-2xl font-bold text-slate-900">Checkout</h1>
    <p class="mt-2 text-sm text-slate-600">
      Pay the seller directly (cash, MoMo, etc.). This step only sends your order
      to the shop.
    </p>

    <SkeletonCheckout v-if="loading" />
    <p v-else-if="!store" class="mt-6 text-slate-600">
      This checkout link is not valid or the store is unavailable.
    </p>

    <template v-else-if="store">
      <p v-if="!cart.lines.length" class="mt-6 text-amber-800">
        Your cart is empty.
        <RouterLink class="font-medium underline" :to="`/${slug}`"
          >Return to {{ store.name }}</RouterLink
        >
      </p>

      <form v-else class="mt-6 space-y-4" @submit.prevent="submit">
        <div>
          <label class="block text-sm font-medium text-slate-700" for="addr"
            >Delivery address *</label
          >
          <textarea
            id="addr"
            v-model="deliveryAddress"
            required
            rows="3"
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700" for="notes"
            >Notes for seller</label
          >
          <textarea
            id="notes"
            v-model="customerNotes"
            rows="2"
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
          />
        </div>

        <template v-if="!auth.isSignedIn">
          <p class="text-sm text-slate-600">
            Guest checkout — or
            <RouterLink to="/login" class="font-medium text-emerald-700"
              >sign in</RouterLink
            >
          </p>
          <div>
            <label class="block text-sm font-medium text-slate-700" for="gname"
              >Full name *</label
            >
            <input
              id="gname"
              v-model="guestName"
              type="text"
              required
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700" for="gemail"
              >Email *</label
            >
            <input
              id="gemail"
              v-model="guestEmail"
              type="email"
              required
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700" for="gphone"
              >Phone *</label
            >
            <input
              id="gphone"
              v-model="guestPhone"
              type="tel"
              required
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </template>

        <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <div class="flex justify-between">
            <span>Items</span>
            <span>{{ cart.itemCount }}</span>
          </div>
          <div class="mt-1 flex justify-between font-semibold text-slate-900">
            <span>Total (reference)</span>
            <span>{{ formatGhs(cart.lineTotalCents) }}</span>
          </div>
        </div>

        <button
          type="submit"
          class="w-full rounded-lg bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          :disabled="!canSubmit || submitting"
        >
          {{ submitting ? 'Placing order…' : 'Place order' }}
        </button>
      </form>
    </template>
  </div>
</template>
