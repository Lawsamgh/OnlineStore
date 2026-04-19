<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { getSupabaseBrowser, isSupabaseConfigured } from '../../lib/supabase'
import { waMeLink } from '../../lib/whatsapp'
import { formatGhs } from '../../lib/formatMoney'
import { useCartStore } from '../../stores/cart'
import { useUiStore } from '../../stores/ui'
import { useToastStore } from '../../stores/toast'
import SkeletonStoreBrowse from '../../components/skeleton/SkeletonStoreBrowse.vue'

const route = useRoute()
const cart = useCartStore()
const ui = useUiStore()
const toast = useToastStore()

const slug = computed(() => String(route.params.storeSlug ?? ''))

const loading = ref(true)
const store = ref<{
  id: string
  slug: string
  name: string
  description: string | null
  whatsapp_phone_e164: string | null
  logo_path: string | null
} | null>(null)

const products = ref<
  {
    id: string
    title: string
    description: string | null
    price_cents: number
    image_paths: string[]
  }[]
>([])

function productImageUrl(path: string | undefined): string | null {
  if (!path || !store.value) return null
  if (path.startsWith('http')) return path
  if (!isSupabaseConfigured()) return null
  const supabase = getSupabaseBrowser()
  const { data } = supabase.storage
    .from('product-images')
    .getPublicUrl(`${store.value.id}/${path}`)
  return data.publicUrl
}

function logoUrl(): string | null {
  if (!store.value?.id) return null
  if (!isSupabaseConfigured()) return null
  const supabase = getSupabaseBrowser()
  const p = store.value.logo_path?.trim()
  const key =
    p && p.length > 0 ? p : `${store.value.id}/logo`
  const { data } = supabase.storage.from('store-logos').getPublicUrl(key)
  return data.publicUrl
}

async function load() {
  loading.value = true
  store.value = null
  products.value = []
  if (!isSupabaseConfigured() || !slug.value) {
    toast.error('Store not available.')
    loading.value = false
    return
  }
  const supabase = getSupabaseBrowser()
  const { data: s, error: se } = await supabase
    .from('stores')
    .select('id, slug, name, description, whatsapp_phone_e164, logo_path')
    .eq('slug', slug.value)
    .eq('is_active', true)
    .maybeSingle()
  if (se || !s) {
    toast.error(se?.message ?? 'Store not found.')
    loading.value = false
    return
  }
  store.value = {
    ...s,
    logo_path: s.logo_path?.trim() || null,
  }
  cart.setStoreContext(s.id, s.slug)

  const { data: p, error: pe } = await supabase
    .from('products')
    .select('id, title, description, price_cents, image_paths')
    .eq('store_id', s.id)
    .eq('is_published', true)
    .order('created_at', { ascending: false })
  if (pe) {
    toast.error(pe.message)
  } else {
    products.value = (p ?? []) as typeof products.value
  }
  loading.value = false
}

onMounted(load)
watch(slug, load)

const whatsappHref = computed(() => {
  const w = store.value?.whatsapp_phone_e164
  if (!w) return null
  const text = encodeURIComponent(
    `Hi ${store.value?.name ?? 'there'}, I have a question about your shop.`,
  )
  return waMeLink(w, text)
})

function addToCart(p: (typeof products.value)[0]) {
  cart.addLine({
    productId: p.id,
    title: p.title,
    quantity: 1,
    unitPriceCents: p.price_cents,
  })
  ui.openCart()
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-8">
    <SkeletonStoreBrowse v-if="loading" />
    <p v-else-if="!store" class="text-slate-600">
      This shop could not be found or is not available.
    </p>
    <template v-else-if="store">
      <div class="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div
          class="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
        >
          <img
            v-if="logoUrl()"
            :src="logoUrl()!"
            alt=""
            class="h-full w-full object-cover"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <span v-else class="text-2xl font-bold text-slate-400">{{
            store.name.slice(0, 1).toUpperCase()
          }}</span>
        </div>
        <div class="min-w-0 flex-1">
          <h1 class="text-2xl font-bold tracking-tight text-slate-900">
            {{ store.name }}
          </h1>
          <p v-if="store.description" class="mt-2 text-slate-600">
            {{ store.description }}
          </p>
          <div class="mt-4 flex flex-wrap gap-3">
            <a
              v-if="whatsappHref"
              :href="whatsappHref"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Chat on WhatsApp
            </a>
            <RouterLink
              v-if="cart.lines.length && cart.storeSlug === store.slug"
              :to="`/${store.slug}/checkout`"
              class="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Go to checkout
            </RouterLink>
          </div>
        </div>
      </div>

      <h2 class="mt-12 text-lg font-semibold text-slate-900">Products</h2>
      <p v-if="!products.length" class="mt-2 text-slate-500">
        No published products yet.
      </p>
      <ul
        v-else
        class="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        <li
          v-for="p in products"
          :key="p.id"
          class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <div
            class="aspect-[4/3] bg-slate-100"
          >
            <img
              v-if="productImageUrl(p.image_paths?.[0])"
              :src="productImageUrl(p.image_paths[0])!"
              :alt="p.title"
              class="h-full w-full object-cover"
            />
          </div>
          <div class="p-4">
            <h3 class="font-semibold text-slate-900">{{ p.title }}</h3>
            <p v-if="p.description" class="mt-1 line-clamp-2 text-sm text-slate-600">
              {{ p.description }}
            </p>
            <p class="mt-2 font-medium text-emerald-800">
              {{ formatGhs(p.price_cents) }}
            </p>
            <button
              type="button"
              class="mt-3 w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              @click="addToCart(p)"
            >
              Add to cart
            </button>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>
