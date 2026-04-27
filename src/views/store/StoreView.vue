<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useHead } from '@unhead/vue'
import { useRoute } from 'vue-router'
import { getSupabaseBrowser, isSupabaseConfigured } from '../../lib/supabase'
import { formatGhs } from '../../lib/formatMoney'
import {
  whatsappDigitsFromE164,
  whatsappSendUrl,
} from '../../lib/whatsappCustomerLink'
import { resolveStoreThemeTokens } from '../../constants/storeThemes'
import { useRealtimeTableRefresh } from '../../composables/useRealtimeTableRefresh'
import { useCartStore } from '../../stores/cart'
import { useToastStore } from '../../stores/toast'
import SkeletonStoreBrowse from '../../components/skeleton/SkeletonStoreBrowse.vue'

const route = useRoute()
const cart = useCartStore()
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
  theme_id: string | null
  theme_primary_color: string | null
  theme_accent_color: string | null
  theme_bg_color: string | null
  theme_surface_color: string | null
  theme_text_color: string | null
  theme_font_family: string | null
} | null>(null)

const products = ref<
  {
    id: string
    title: string
    description: string | null
    category: string | null
    price_cents: number
    availability: 'in_stock' | 'out_of_stock'
    image_paths: string[]
  }[]
>([])
type ProductReviewRow = {
  id: string
  product_id: string
  rating: number
  comment: string | null
  reviewer_name: string | null
  created_at: string
}
const reviewStatsByProductId = ref(new Map<string, { count: number; avg: number }>())
const reviewItemsByProductId = ref(new Map<string, ProductReviewRow[]>())
const MAX_VISIBLE_PRODUCT_REVIEWS = 20

// ── Search & filter state ──────────────────────────────────────────────────
const searchQuery = ref('')
const selectedCategory = ref<string | null>(null)

const categories = computed(() => {
  const seen = new Set<string>()
  for (const p of products.value) {
    if (p.category) seen.add(p.category)
  }
  return Array.from(seen).sort()
})

const filteredProducts = computed(() => {
  let list = products.value
  if (selectedCategory.value) {
    list = list.filter((p) => p.category === selectedCategory.value)
  }
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false) ||
        (p.category?.toLowerCase().includes(q) ?? false),
    )
  }
  return list
})

function selectCategory(cat: string | null) {
  selectedCategory.value = cat
  searchQuery.value = ''
}

// ── Image helper ───────────────────────────────────────────────────────────
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

// ── Data loading ───────────────────────────────────────────────────────────
async function load(opts?: { silent?: boolean }) {
  const silent = opts?.silent ?? false
  if (!silent) {
    loading.value = true
    store.value = null
    products.value = []
  }
  if (!isSupabaseConfigured() || !slug.value) {
    if (!silent) toast.error('Store not available.')
    if (!silent) loading.value = false
    return
  }
  const supabase = getSupabaseBrowser()
  const { data: s, error: se } = await supabase
    .from('stores')
    .select(
      'id, slug, name, description, whatsapp_phone_e164, logo_path, theme_id, theme_primary_color, theme_accent_color, theme_bg_color, theme_surface_color, theme_text_color, theme_font_family',
    )
    .eq('slug', slug.value)
    .eq('is_active', true)
    .maybeSingle()
  if (se || !s) {
    if (!silent) toast.error(se?.message ?? 'Store not found.')
    store.value = null
    products.value = []
    if (!silent) loading.value = false
    return
  }
  store.value = {
    ...s,
    logo_path: s.logo_path?.trim() || null,
    theme_id:
      typeof s.theme_id === 'string' && s.theme_id.trim() ? s.theme_id.trim() : null,
    theme_primary_color:
      typeof s.theme_primary_color === 'string' && s.theme_primary_color.trim()
        ? s.theme_primary_color.trim()
        : null,
    theme_accent_color:
      typeof s.theme_accent_color === 'string' && s.theme_accent_color.trim()
        ? s.theme_accent_color.trim()
        : null,
    theme_bg_color:
      typeof s.theme_bg_color === 'string' && s.theme_bg_color.trim()
        ? s.theme_bg_color.trim()
        : null,
    theme_surface_color:
      typeof s.theme_surface_color === 'string' && s.theme_surface_color.trim()
        ? s.theme_surface_color.trim()
        : null,
    theme_text_color:
      typeof s.theme_text_color === 'string' && s.theme_text_color.trim()
        ? s.theme_text_color.trim()
        : null,
    theme_font_family:
      typeof s.theme_font_family === 'string' && s.theme_font_family.trim()
        ? s.theme_font_family.trim()
        : null,
  }
  cart.setStoreContext(s.id, s.slug)

  const { data: p, error: pe } = await supabase
    .from('products')
    .select(
      'id, title, description, price_cents, availability, image_paths, product_categories ( name )',
    )
    .eq('store_id', s.id)
    .eq('is_published', true)
    .order('created_at', { ascending: false })
  if (pe) {
    if (!silent) toast.error(pe.message)
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
        availability:
          r.availability === 'out_of_stock' ? 'out_of_stock' : 'in_stock',
        image_paths: Array.isArray(r.image_paths)
          ? (r.image_paths as string[])
          : [],
      }
    })
    const productIds = products.value.map((x) => x.id)
    reviewStatsByProductId.value = new Map()
    reviewItemsByProductId.value = new Map()
    if (productIds.length > 0) {
      const { data: reviewsData, error: reviewsError } = await supabase
        .from('product_reviews')
        .select('id, product_id, rating, comment, reviewer_name, created_at')
        .eq('store_id', s.id)
        .eq('is_visible', true)
        .in('product_id', productIds)
        .order('created_at', { ascending: false })
      if (reviewsError) {
        if (!silent) toast.error(reviewsError.message)
      } else {
        const stats = new Map<string, { count: number; sum: number }>()
        const items = new Map<string, ProductReviewRow[]>()
        for (const raw of reviewsData ?? []) {
          const r = raw as Record<string, unknown>
          const pid = typeof r.product_id === 'string' ? r.product_id : ''
          const rating = Number(r.rating)
          if (!pid || !Number.isFinite(rating) || rating < 1 || rating > 5) continue
          const st = stats.get(pid) ?? { count: 0, sum: 0 }
          st.count += 1
          st.sum += rating
          stats.set(pid, st)
          const list = items.get(pid) ?? []
          if (list.length < MAX_VISIBLE_PRODUCT_REVIEWS) {
            list.push({
              id: String(r.id ?? `${pid}-${list.length}`),
              product_id: pid,
              rating,
              comment:
                typeof r.comment === 'string' && r.comment.trim() ? r.comment.trim() : null,
              reviewer_name:
                typeof r.reviewer_name === 'string' && r.reviewer_name.trim()
                  ? r.reviewer_name.trim()
                  : null,
              created_at: String(r.created_at ?? ''),
            })
            items.set(pid, list)
          }
        }
        const mapped = new Map<string, { count: number; avg: number }>()
        for (const [pid, st] of stats.entries()) {
          mapped.set(pid, { count: st.count, avg: st.sum / st.count })
        }
        reviewStatsByProductId.value = mapped
        reviewItemsByProductId.value = items
      }
    }
  }
  if (!silent) loading.value = false
}

function reviewStatForProduct(productId: string): { count: number; avg: number } | null {
  return reviewStatsByProductId.value.get(productId) ?? null
}

function reviewStars(avg: number): string {
  const rounded = Math.max(1, Math.min(5, Math.round(avg)))
  return '★'.repeat(rounded) + '☆'.repeat(5 - rounded)
}

function formatReviewDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Recently'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function reviewerInitial(name: string | null | undefined): string {
  const t = (name ?? '').trim()
  if (!t) return 'V'
  return t[0]!.toUpperCase()
}

onMounted(() => {
  void load()
})
watch(slug, () => {
  searchQuery.value = ''
  selectedCategory.value = null
  void load()
})

useRealtimeTableRefresh({
  channelName: () =>
    `storefront-browse:${slug.value}:${store.value?.id ?? 'pending'}`,
  deps: [slug, () => store.value?.id ?? ''],
  debounceMs: 400,
  getTables: () => {
    const sid = store.value?.id
    if (!sid) return []
    return [
      { table: 'products', filter: `store_id=eq.${sid}` },
      { table: 'stores', filter: `id=eq.${sid}` },
    ]
  },
  onEvent: () => load({ silent: true }),
})

// ── Cart ───────────────────────────────────────────────────────────────────
function addToCart(p: (typeof products.value)[0]) {
  if (p.availability === 'out_of_stock') {
    toast.info('This product is currently out of stock.')
    return
  }
  cart.addLine({
    productId: p.id,
    title: p.title,
    quantity: 1,
    unitPriceCents: p.price_cents,
    imageUrl: productImageUrl(p.image_paths?.[0]),
  })
  toast.success(`"${p.title}" added to cart`)
}

// ── Product detail drawer ──────────────────────────────────────────────────
type Product = (typeof products.value)[0]
const selectedProduct = ref<Product | null>(null)
const drawerImageIndex = ref(0)

function openProduct(p: Product) {
  selectedProduct.value = p
  drawerImageIndex.value = 0
  document.body.style.overflow = 'hidden'
}
function closeProduct() {
  selectedProduct.value = null
  document.body.style.overflow = ''
}

// ── WhatsApp links ─────────────────────────────────────────────────────────
const whatsappProductLinks = computed(() => {
  const s = store.value
  const out = new Map<string, string>()
  if (!s) return out
  const digits = whatsappDigitsFromE164(s.whatsapp_phone_e164)
  if (!digits) return out
  for (const p of products.value) {
    const body = `Hi — I'm interested in "${p.title}" (${formatGhs(p.price_cents)}) from ${s.name}.`
    out.set(p.id, whatsappSendUrl(digits, body))
  }
  return out
})

const storefrontTheme = computed(() => resolveStoreThemeTokens(store.value ?? {}))

useHead(computed(() => {
  const s = store.value
  const title = s ? `${s.name} — Shop on UandITech` : 'UandITech Store'
  const description = s?.description?.trim()
    ? s.description.trim()
    : s ? `Browse products at ${s.name}. Cart and checkout available.` : ''
  return {
    title,
    meta: [
      { name: 'description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
    ],
  }
}))

// ── Auto category icon ─────────────────────────────────────────────────────
// Ordered from most-specific to most-general so earlier rules win.
// Simple substring rules — no word boundaries so plurals like "Computers",
// "Sneakers", "Tables" all match correctly.
const CATEGORY_ICON_RULES: [RegExp, string][] = [
  // Electronics & tech (most-specific first)
  [/laptop|notebook|macbook|chromebook/i, '💻'],
  [/computer|desktop|monitor|imac/i, '🖥️'],
  [/tablet|ipad/i, '📱'],
  [/phone|mobile|smartphone|iphone|android/i, '📱'],
  [/headphone|earphone|earbud|airpod|speaker|audio/i, '🎧'],
  [/camera|photo|lens|dslr/i, '📷'],
  [/tv\b|television|projector/i, '📺'],
  [/smartwatch|wristwatch|timepiece/i, '⌚'],
  [/watch(?!er)/i, '⌚'],
  [/electronic|gadget|tech/i, '⚡'],
  // Vehicles & auto
  [/spare.?part|engine|tyre|tire|muffler/i, '🔩'],
  [/car|auto|vehicle|motorbike|motorcycle|truck/i, '🚗'],
  [/bicycle|bike|cycle/i, '🚲'],
  // Fashion & clothing
  [/sneaker|trainer/i, '👟'],
  [/shoe|boot|heel|sandal|slipper|footwear/i, '👞'],
  [/bag|handbag|purse|wallet|backpack|luggage|suitcase/i, '👜'],
  [/sunglass|eyewear|spectacle/i, '🕶️'],
  [/hat|cap|beanie|helmet/i, '🧢'],
  [/dress|gown|skirt|blouse/i, '👗'],
  [/shirt|t-shirt|tshirt|polo/i, '👕'],
  [/trouser|pant|jean|short/i, '👖'],
  [/underwear|lingerie|sock/i, '🩱'],
  [/cloth|wear|apparel|fashion|outfit|costume/i, '👔'],
  // Jewellery & accessories
  [/ring|necklace|bracelet|earring|pendant|jewel|jewelry|jewellery/i, '💍'],
  [/gold|silver|bead/i, '💍'],
  [/perfume|fragrance|cologne/i, '🌸'],
  // Beauty & health
  [/makeup|cosmetic|lipstick|mascara|foundation|skincare/i, '💄'],
  [/hair|wig|weave|extension/i, '💇'],
  [/medicine|drug|pharmacy|supplement|vitamin|health/i, '💊'],
  // Food & drinks
  [/drink|beverage|juice|water|soda|alcohol|wine|beer/i, '🥤'],
  [/food|snack|meal|rice|bread|cake|biscuit|chocolate|candy|sweet/i, '🍔'],
  [/fruit|vegetable|produce|grocery/i, '🥦'],
  // Furniture & home
  [/sofa|couch/i, '🛋️'],
  [/chair|seat|stool/i, '🪑'],
  [/table|desk|counter/i, '🪑'],
  [/bed|mattress|pillow|bedding/i, '🛏️'],
  [/kitchen|cookware|utensil|cutlery|appliance/i, '🍳'],
  [/lamp|lighting|bulb/i, '💡'],
  [/furniture|interior|decor/i, '🏠'],
  [/home|house/i, '🏠'],
  // Sports & fitness
  [/football|soccer/i, '⚽'],
  [/basketball/i, '🏀'],
  [/gym|fitness|workout|exercise|dumbbell/i, '🏋️'],
  [/sport|athletic|outdoor|camping|hiking|swim/i, '🏃'],
  // Kids & baby
  [/baby|infant|toddler/i, '👶'],
  [/toy|puzzle|lego|doll/i, '🧸'],
  [/game|gaming|console/i, '🎮'],
  [/book|stationery|notebook|pen|pencil/i, '📚'],
  [/kid|child|school/i, '🎒'],
  // Garden & pets
  [/pet|dog|cat|animal|fish|bird/i, '🐾'],
  [/garden|plant|flower|seed/i, '🌱'],
  // Tools & building
  [/tool|hardware|drill|plumb/i, '🔧'],
  [/paint|brush|varnish/i, '🖌️'],
  [/electric|cable|charger|usb|adapter/i, '🔌'],
  // Music & arts
  [/music|guitar|piano|drum|instrument/i, '🎵'],
  [/art|craft|design/i, '🎨'],
  // Office
  [/office|printer|paper|ink|toner/i, '📎'],
]

function categoryIcon(cat: string): string {
  for (const [re, icon] of CATEGORY_ICON_RULES) {
    if (re.test(cat)) return icon
  }
  // Deterministic fallback from a set of generic shopping icons
  const fallbacks = ['🛍️', '📦', '🏷️', '🛒', '✨']
  let hash = 0
  for (let i = 0; i < cat.length; i++) hash = (hash * 31 + cat.charCodeAt(i)) >>> 0
  return fallbacks[hash % fallbacks.length]!
}
</script>

<template>
  <div
    :style="{ color: storefrontTheme.text, fontFamily: storefrontTheme.fontFamily }"
  >
    <!-- ── Loading skeleton ──────────────────────────────────────────────── -->
    <SkeletonStoreBrowse v-if="loading" />

    <!-- ── Store not found ───────────────────────────────────────────────── -->
    <p v-else-if="!store" class="px-4 py-12 text-center text-sm" :style="{ color: storefrontTheme.muted }">
      This shop could not be found or is not available.
    </p>

    <!-- ── Store content ─────────────────────────────────────────────────── -->
    <template v-else-if="store">
      <div class="mx-auto w-full max-w-5xl">

      <!-- Search bar -->
      <div class="px-4 pt-4 pb-2">
        <div
          class="flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 shadow-sm transition-shadow focus-within:shadow-md"
          :style="{
            borderColor: storefrontTheme.border,
            backgroundColor: storefrontTheme.surface,
          }"
        >
          <!-- Search icon -->
          <svg
            class="h-4 w-4 shrink-0"
            :style="{ color: storefrontTheme.muted }"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            v-model="searchQuery"
            type="search"
            placeholder="Search products…"
            class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-sm"
            :style="{
              color: storefrontTheme.text,
              caretColor: storefrontTheme.primary,
            }"
            @focus="selectedCategory = null"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="shrink-0 rounded-full p-0.5 transition-opacity hover:opacity-70"
            :style="{ color: storefrontTheme.muted }"
            aria-label="Clear search"
            @click="searchQuery = ''"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Category pills — sticky below the storefront header -->
      <div
        v-if="categories.length >= 1 && !searchQuery"
        class="sticky top-[68px] z-30 sm:top-[72px]"
        :style="{
          backgroundColor: `${storefrontTheme.surface}e8`,
          backdropFilter: 'blur(14px) saturate(160%)',
          WebkitBackdropFilter: 'blur(14px) saturate(160%)',
          borderBottom: `1px solid ${storefrontTheme.border}`,
          boxShadow: '0 4px 16px -6px rgba(0,0,0,0.08)',
        }"
      >
        <div
          class="flex gap-2 overflow-x-auto px-4 py-2.5 scrollbar-none"
          style="-webkit-overflow-scrolling: touch; scrollbar-width: none;"
        >
        <!-- All pill -->
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-semibold transition-all"
          :style="
            selectedCategory === null
              ? {
                  backgroundColor: storefrontTheme.primary,
                  color: storefrontTheme.primaryText,
                  borderColor: storefrontTheme.primary,
                }
              : {
                  backgroundColor: storefrontTheme.surface,
                  color: storefrontTheme.text,
                  borderColor: storefrontTheme.border,
                }
          "
          @click="selectCategory(null)"
        >
          All
        </button>

        <!-- Category pills -->
        <button
          v-for="cat in categories"
          :key="cat"
          type="button"
          class="inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all"
          :style="
            selectedCategory === cat
              ? {
                  backgroundColor: storefrontTheme.primary,
                  color: storefrontTheme.primaryText,
                  borderColor: storefrontTheme.primary,
                }
              : {
                  backgroundColor: storefrontTheme.surface,
                  color: storefrontTheme.text,
                  borderColor: storefrontTheme.border,
                }
          "
          @click="selectCategory(cat)"
        >
          <span class="text-sm leading-none" aria-hidden="true">{{ categoryIcon(cat) }}</span>
          {{ cat }}
        </button>
        </div>
      </div>

      <!-- Section heading -->
      <div class="flex items-center gap-3 px-4 pt-4 pb-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2.5">
            <!-- Accent bar -->
            <span
              class="h-5 w-1 shrink-0 rounded-full"
              :style="{ backgroundColor: storefrontTheme.primary }"
              aria-hidden="true"
            />
            <h2
              class="truncate text-base font-extrabold tracking-tight sm:text-lg"
              :style="{ color: storefrontTheme.text }"
            >
              {{ searchQuery ? 'Search results' : selectedCategory ?? 'New In' }}
            </h2>
          </div>
        </div>
        <!-- Count badge -->
        <span
          class="shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold tabular-nums"
          :style="{
            backgroundColor: storefrontTheme.surface,
            color: storefrontTheme.primary,
            borderColor: storefrontTheme.border,
          }"
        >
          {{ filteredProducts.length }} item{{ filteredProducts.length === 1 ? '' : 's' }}
        </span>
      </div>

      <!-- No products at all -->
      <p
        v-if="!products.length"
        class="px-4 pb-8 text-sm"
        :style="{ color: storefrontTheme.muted }"
      >
        No published products yet — check back soon.
      </p>

      <!-- No results for current filter / search -->
      <div
        v-else-if="!filteredProducts.length"
        class="flex flex-col items-center gap-2 px-4 py-12 text-center"
      >
        <svg
          class="h-10 w-10 opacity-30"
          :style="{ color: storefrontTheme.muted }"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <p class="text-sm" :style="{ color: storefrontTheme.muted }">
          No products match
          <strong>{{ searchQuery || selectedCategory }}</strong>
        </p>
        <button
          type="button"
          class="mt-1 text-xs font-semibold underline underline-offset-2"
          :style="{ color: storefrontTheme.primary }"
          @click="searchQuery = ''; selectedCategory = null"
        >
          Clear filter
        </button>
      </div>

      <!-- Product grid -->
      <ul
        v-else
        class="grid grid-cols-2 gap-3 px-4 pb-10 sm:grid-cols-3 lg:grid-cols-4"
      >
        <li
          v-for="p in filteredProducts"
          :key="p.id"
          class="group flex flex-col overflow-hidden rounded-2xl border shadow-sm cursor-pointer"
          :class="p.availability === 'out_of_stock' ? 'ring-2 ring-rose-300/70' : ''"
          :style="{
            borderColor: storefrontTheme.border,
            backgroundColor: storefrontTheme.surface,
          }"
          @click="openProduct(p)"
        >
          <!-- Product image -->
          <div
            class="relative aspect-square w-full overflow-hidden"
            :style="{ backgroundColor: storefrontTheme.bg }"
          >
            <img
              v-if="productImageUrl(p.image_paths?.[0])"
              :src="productImageUrl(p.image_paths[0])!"
              :alt="p.title"
              class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              :class="p.availability === 'out_of_stock' ? 'opacity-60 grayscale-[35%]' : ''"
            />
            <!-- Placeholder when no image -->
            <div
              v-else
              class="flex h-full w-full items-center justify-center"
              aria-hidden="true"
            >
              <svg
                class="h-12 w-12 opacity-20"
                :style="{ color: storefrontTheme.muted }"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>

            <!-- Category badge on image -->
            <span
              v-if="p.category"
              class="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-sm backdrop-blur-sm"
              :style="{
                backgroundColor: `${storefrontTheme.surface}cc`,
                color: storefrontTheme.muted,
              }"
            >
              {{ p.category }}
            </span>
            <span
              v-if="p.availability === 'out_of_stock'"
              class="absolute right-2 top-2 rounded-full border border-rose-200 bg-rose-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm"
            >
              Out of stock
            </span>
          </div>

          <!-- Card body -->
          <div class="flex flex-1 flex-col gap-1 p-3">
            <h3
              class="line-clamp-2 text-sm font-semibold leading-snug"
              :style="{ color: storefrontTheme.text }"
            >
              {{ p.title }}
            </h3>
            <p
              v-if="reviewStatForProduct(p.id)"
              class="text-[11px] font-semibold"
              :style="{ color: storefrontTheme.muted }"
            >
              {{ reviewStars(reviewStatForProduct(p.id)!.avg) }}
              <span class="ml-1">
                {{ reviewStatForProduct(p.id)!.avg.toFixed(1) }} ({{ reviewStatForProduct(p.id)!.count }})
              </span>
            </p>

            <p
              v-if="p.description"
              class="line-clamp-2 text-xs leading-relaxed"
              :style="{ color: storefrontTheme.muted }"
            >
              {{ p.description }}
            </p>

            <!-- Price + add-to-cart row -->
            <div class="mt-auto flex items-center justify-between pt-2">
              <span
                class="text-sm font-bold"
                :style="{ color: storefrontTheme.primary }"
              >
                {{ formatGhs(p.price_cents) }}
              </span>

              <!-- Round "+" add to cart button -->
              <button
                type="button"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm transition-transform active:scale-90"
                :style="{
                  backgroundColor:
                    p.availability === 'out_of_stock'
                      ? storefrontTheme.border
                      : storefrontTheme.primary,
                  color:
                    p.availability === 'out_of_stock'
                      ? storefrontTheme.muted
                      : storefrontTheme.primaryText,
                }"
                :aria-label="
                  p.availability === 'out_of_stock'
                    ? `${p.title} is out of stock`
                    : `Add ${p.title} to cart`
                "
                :disabled="p.availability === 'out_of_stock'"
                @click.stop="addToCart(p)"
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
            <p
              v-if="p.availability === 'out_of_stock'"
              class="mt-1 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-rose-700"
            >
              Out of stock
            </p>

            <!-- WhatsApp link (full row, below price) -->
            <a
              v-if="whatsappProductLinks.get(p.id)"
              :href="whatsappProductLinks.get(p.id)"
              target="_blank"
              rel="noopener noreferrer"
              title="Opens WhatsApp with a short message about this product."
              class="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-xl border py-1.5 text-xs font-semibold no-underline transition-opacity hover:opacity-80"
              @click.stop
              :style="{
                borderColor: storefrontTheme.border,
                color: storefrontTheme.text,
                backgroundColor: storefrontTheme.bg,
              }"
            >
              <svg
                class="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="#25D366"
                aria-hidden="true"
              >
                <path
                  d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.887.709.385 1.262.616 1.694.789.712.282 1.36.242 1.871.147.571-.108 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
                />
              </svg>
              Ask on WhatsApp
            </a>
          </div>
        </li>
      </ul>
      </div>

    </template>

    <!-- ── Product detail drawer ───────────────────────────────────────── -->
    <Teleport to="body">
      <!-- Backdrop -->
      <Transition name="sf-backdrop">
        <div
          v-if="selectedProduct"
          class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
          aria-hidden="true"
          @click="closeProduct()"
        />
      </Transition>

      <!-- Drawer -->
      <Transition name="sf-drawer">
        <div
          v-if="selectedProduct"
          class="fixed bottom-0 left-0 right-0 z-50 flex max-h-[92dvh] flex-col overflow-hidden rounded-t-3xl shadow-2xl"
          :style="{
            backgroundColor: storefrontTheme.surface,
            fontFamily: storefrontTheme.fontFamily,
            color: storefrontTheme.text,
          }"
          role="dialog"
          :aria-label="selectedProduct.title"
        >
          <!-- Drag handle -->
          <div class="flex justify-center pt-3 pb-1 shrink-0">
            <div
              class="h-1 w-10 rounded-full opacity-30"
              :style="{ backgroundColor: storefrontTheme.muted }"
            />
          </div>

          <!-- Close button -->
          <button
            type="button"
            class="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full transition-opacity hover:opacity-70"
            :style="{
              backgroundColor: storefrontTheme.bg,
              color: storefrontTheme.muted,
            }"
            aria-label="Close"
            @click="closeProduct()"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <!-- Scrollable body -->
          <div class="flex-1 overflow-y-auto">
            <!-- Main image -->
            <div
              class="relative w-full"
              style="aspect-ratio: 4/3"
              :style="{ backgroundColor: storefrontTheme.bg }"
            >
              <img
                v-if="productImageUrl(selectedProduct.image_paths?.[drawerImageIndex])"
                :src="productImageUrl(selectedProduct.image_paths[drawerImageIndex])!"
                :alt="selectedProduct.title"
                class="h-full w-full object-cover"
              />
              <div
                v-else
                class="flex h-full w-full items-center justify-center"
                aria-hidden="true"
              >
                <svg
                  class="h-16 w-16 opacity-20"
                  :style="{ color: storefrontTheme.muted }"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </div>
            </div>

            <!-- Thumbnail row (multiple images) -->
            <div
              v-if="selectedProduct.image_paths.length > 1"
              class="flex gap-2 overflow-x-auto px-4 pt-3 pb-1"
              style="scrollbar-width: none; -webkit-overflow-scrolling: touch;"
            >
              <button
                v-for="(path, idx) in selectedProduct.image_paths"
                :key="idx"
                type="button"
                class="h-14 w-14 shrink-0 overflow-hidden rounded-xl border-2 transition-all"
                :style="{
                  borderColor: drawerImageIndex === idx ? storefrontTheme.primary : storefrontTheme.border,
                  backgroundColor: storefrontTheme.bg,
                }"
                :aria-label="`Image ${idx + 1}`"
                @click="drawerImageIndex = idx"
              >
                <img
                  v-if="productImageUrl(path)"
                  :src="productImageUrl(path)!"
                  :alt="`${selectedProduct.title} image ${idx + 1}`"
                  class="h-full w-full object-cover"
                />
              </button>
            </div>

            <!-- Details -->
            <div class="px-5 pt-4 pb-2">
              <!-- Category badge -->
              <span
                v-if="selectedProduct.category"
                class="mb-2 inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                :style="{
                  borderColor: storefrontTheme.border,
                  backgroundColor: storefrontTheme.bg,
                  color: storefrontTheme.muted,
                }"
              >
                {{ selectedProduct.category }}
              </span>

              <h2
                class="text-xl font-extrabold leading-snug tracking-tight"
                :style="{ color: storefrontTheme.text }"
              >
                {{ selectedProduct.title }}
              </h2>

              <p
                class="mt-1 text-2xl font-black"
                :style="{ color: storefrontTheme.primary }"
              >
                {{ formatGhs(selectedProduct.price_cents) }}
              </p>
              <p
                v-if="reviewStatForProduct(selectedProduct.id)"
                class="mt-1 text-xs font-semibold"
                :style="{ color: storefrontTheme.muted }"
              >
                {{ reviewStars(reviewStatForProduct(selectedProduct.id)!.avg) }}
                <span class="ml-1">
                  {{ reviewStatForProduct(selectedProduct.id)!.avg.toFixed(1) }}
                  from {{ reviewStatForProduct(selectedProduct.id)!.count }} review{{
                    reviewStatForProduct(selectedProduct.id)!.count === 1 ? '' : 's'
                  }}
                </span>
              </p>

              <p
                v-if="selectedProduct.description"
                class="mt-3 text-sm leading-relaxed"
                :style="{ color: storefrontTheme.muted }"
              >
                {{ selectedProduct.description }}
              </p>

            </div>

            <!-- Action buttons -->
            <div class="flex flex-col gap-2.5 px-5 pt-3 pb-8">
              <button
                type="button"
                class="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold shadow-md transition-transform active:scale-[0.98]"
                :style="{
                  backgroundColor:
                    selectedProduct.availability === 'out_of_stock'
                      ? storefrontTheme.border
                      : storefrontTheme.primary,
                  color:
                    selectedProduct.availability === 'out_of_stock'
                      ? storefrontTheme.muted
                      : storefrontTheme.primaryText,
                }"
                :disabled="selectedProduct.availability === 'out_of_stock'"
                @click="addToCart(selectedProduct); closeProduct()"
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {{
                  selectedProduct.availability === 'out_of_stock'
                    ? 'Out of stock'
                    : 'Add to cart'
                }}
              </button>

              <a
                v-if="whatsappProductLinks.get(selectedProduct.id)"
                :href="whatsappProductLinks.get(selectedProduct.id)"
                target="_blank"
                rel="noopener noreferrer"
                class="flex w-full items-center justify-center gap-2 rounded-2xl border py-3.5 text-sm font-bold no-underline transition-opacity hover:opacity-80"
                :style="{
                  borderColor: storefrontTheme.border,
                  backgroundColor: storefrontTheme.bg,
                  color: storefrontTheme.text,
                }"
              >
                <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="#25D366" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.887.709.385 1.262.616 1.694.789.712.282 1.36.242 1.871.147.571-.108 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                </svg>
                Ask on WhatsApp
              </a>

              <div class="mt-2 space-y-2">
                <h3 class="text-xs font-extrabold uppercase tracking-wide" :style="{ color: storefrontTheme.text }">
                  Customer reviews
                </h3>
                <div
                  v-if="(reviewItemsByProductId.get(selectedProduct.id) ?? []).length"
                  class="max-h-56 space-y-2 overflow-y-auto rounded-2xl border p-2.5"
                  :style="{ borderColor: storefrontTheme.border, backgroundColor: `${storefrontTheme.bg}cc` }"
                >
                  <div
                    v-for="rv in reviewItemsByProductId.get(selectedProduct.id) ?? []"
                    :key="rv.id"
                    class="rounded-xl border px-3 py-2.5"
                    :style="{ borderColor: storefrontTheme.border, backgroundColor: storefrontTheme.surface }"
                  >
                    <div class="flex items-start gap-2.5">
                      <span
                        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                        :style="{
                          backgroundColor: `${storefrontTheme.primary}22`,
                          color: storefrontTheme.primary,
                        }"
                        aria-hidden="true"
                      >
                        {{ reviewerInitial(rv.reviewer_name) }}
                      </span>
                      <div class="min-w-0 flex-1">
                        <p class="text-[11px] font-semibold" :style="{ color: storefrontTheme.text }">
                          {{ reviewStars(rv.rating) }}
                          <span class="ml-1">{{ rv.reviewer_name || 'Verified buyer' }}</span>
                          <span class="ml-2 text-[10px]" :style="{ color: storefrontTheme.muted }">
                            {{ formatReviewDate(rv.created_at) }}
                          </span>
                        </p>
                        <p
                          v-if="rv.comment"
                          class="mt-1 text-xs leading-relaxed"
                          :style="{ color: storefrontTheme.muted }"
                        >
                          {{ rv.comment }}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <p
                  v-else
                  class="rounded-xl border px-3 py-2 text-xs"
                  :style="{ borderColor: storefrontTheme.border, color: storefrontTheme.muted, backgroundColor: storefrontTheme.bg }"
                >
                  No reviews yet for this product.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<style scoped>
/* Backdrop fade */
.sf-backdrop-enter-active,
.sf-backdrop-leave-active {
  transition: opacity 0.25s ease;
}
.sf-backdrop-enter-from,
.sf-backdrop-leave-to {
  opacity: 0;
}

/* Drawer slide up */
.sf-drawer-enter-active,
.sf-drawer-leave-active {
  transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1);
}
.sf-drawer-enter-from,
.sf-drawer-leave-to {
  transform: translateY(100%);
}
</style>
