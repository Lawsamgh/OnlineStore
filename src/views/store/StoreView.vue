<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getSupabaseBrowser, isSupabaseConfigured } from '../../lib/supabase'
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
    category: string | null
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
    .select(
      'id, title, description, price_cents, image_paths, product_categories ( name )',
    )
    .eq('store_id', s.id)
    .eq('is_published', true)
    .order('created_at', { ascending: false })
  if (pe) {
    toast.error(pe.message)
  } else {
    products.value = (p ?? []).map((row) => {
      const r = row as Record<string, unknown>
      const rel = r.product_categories as { name?: string } | null | undefined
      const category =
        rel &&
        typeof rel === 'object' &&
        typeof rel.name === 'string' &&
        rel.name.trim()
          ? rel.name.trim()
          : null
      return {
        id: String(r.id),
        title: String(r.title),
        description:
          typeof r.description === 'string' && r.description.trim()
            ? r.description.trim()
            : null,
        category,
        price_cents: Number(r.price_cents) || 0,
        image_paths: Array.isArray(r.image_paths)
          ? (r.image_paths as string[])
          : [],
      }
    })
  }
  loading.value = false
}

onMounted(load)
watch(slug, load)

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
      <p
        v-if="store.description"
        class="max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-[15px]"
      >
        {{ store.description }}
      </p>

      <h2
        class="text-lg font-semibold tracking-tight text-slate-900"
        :class="store.description ? 'mt-8' : 'mt-0'"
      >
        Products
      </h2>
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
            <div class="flex flex-wrap items-start justify-between gap-2">
              <h3 class="min-w-0 font-semibold text-slate-900">{{ p.title }}</h3>
              <span
                v-if="p.category"
                class="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600"
                >{{ p.category }}</span
              >
            </div>
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
