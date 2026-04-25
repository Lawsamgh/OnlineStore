<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { formatGhs } from '../lib/formatMoney'
import { clearBodyScrollLock, setBodyScrollLocked } from '../lib/bodyScrollLock'
import { useCartStore } from '../stores/cart'
import { useUiStore } from '../stores/ui'

const cart = useCartStore()
const ui = useUiStore()
const route = useRoute()

watch(
  () => ui.cartDrawerOpen,
  (open) => {
    setBodyScrollLocked("cart-drawer", open)
  },
)

onBeforeUnmount(() => {
  clearBodyScrollLock("cart-drawer")
})

function close() {
  ui.closeCart()
}

const checkoutPath = () => {
  const slug = cart.storeSlug
  if (!slug) return '/'
  return `/${slug}/checkout`
}

const canCheckout = () =>
  cart.lines.length > 0 && cart.storeSlug && route.params.storeSlug === cart.storeSlug
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <Transition
      enter-active-class="transition-opacity duration-250"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="ui.cartDrawerOpen"
        class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        aria-hidden="true"
        @click="close"
      />
    </Transition>

    <!-- Drawer — slides up from bottom on mobile, from right on md+ -->
    <Transition
      enter-active-class="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
      leave-active-class="transition-transform duration-250 ease-in"
      enter-from-class="translate-y-full md:translate-y-0 md:translate-x-full"
      leave-to-class="translate-y-full md:translate-y-0 md:translate-x-full"
    >
      <aside
        v-if="ui.cartDrawerOpen"
        class="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl bg-white shadow-2xl md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-96 md:rounded-none md:rounded-l-3xl"
        role="dialog"
        aria-label="Shopping cart"
      >
        <!-- Drag handle (mobile only) -->
        <div class="flex justify-center pt-3 pb-1 md:hidden">
          <div class="h-1 w-10 rounded-full bg-slate-200" />
        </div>

        <!-- Header -->
        <header class="flex items-center justify-between px-5 pb-3 pt-2 md:pt-5">
          <div class="flex items-center gap-2.5">
            <!-- Bag icon -->
            <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
              <svg class="h-5 w-5 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
            </div>
            <div>
              <h2 class="text-base font-bold text-slate-900">My Cart</h2>
              <p class="text-[11px] text-slate-400">
                {{ cart.itemCount }} {{ cart.itemCount === 1 ? 'item' : 'items' }}
              </p>
            </div>
          </div>
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
            aria-label="Close cart"
            @click="close"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <!-- Divider -->
        <div class="mx-5 h-px bg-slate-100" />

        <!-- Empty state -->
        <div
          v-if="cart.lines.length === 0"
          class="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center"
        >
          <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
            <svg class="h-8 w-8 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
          </div>
          <p class="font-semibold text-slate-700">Your cart is empty</p>
          <p class="text-sm text-slate-400">Add products from the store to get started.</p>
          <button
            type="button"
            class="mt-1 rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
            @click="close"
          >
            Continue browsing
          </button>
        </div>

        <!-- Cart items -->
        <ul v-else class="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          <li
            v-for="line in cart.lines"
            :key="line.productId"
            class="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3"
          >
            <!-- Product image -->
            <div class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-slate-50 shadow-sm">
              <img
                v-if="line.imageUrl"
                :src="line.imageUrl"
                :alt="line.title"
                class="h-full w-full object-cover"
              />
              <svg
                v-else
                class="h-6 w-6 text-slate-200"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>

            <!-- Details -->
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-slate-900">{{ line.title }}</p>
              <p class="text-xs text-slate-400 mt-0.5">{{ formatGhs(line.unitPriceCents) }} each</p>

              <!-- Qty stepper -->
              <div class="mt-2 flex items-center gap-2">
                <div class="flex items-center rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <button
                    type="button"
                    class="flex h-7 w-7 items-center justify-center text-slate-500 transition hover:bg-slate-100 active:scale-90 disabled:opacity-30"
                    :disabled="line.quantity <= 1"
                    :aria-label="`Decrease quantity of ${line.title}`"
                    @click="cart.setQty(line.productId, line.quantity - 1)"
                  >
                    <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                  <span class="w-7 text-center text-xs font-bold text-slate-800 tabular-nums">
                    {{ line.quantity }}
                  </span>
                  <button
                    type="button"
                    class="flex h-7 w-7 items-center justify-center text-slate-500 transition hover:bg-slate-100 active:scale-90"
                    :aria-label="`Increase quantity of ${line.title}`"
                    @click="cart.setQty(line.productId, line.quantity + 1)"
                  >
                    <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>

                <!-- Remove -->
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded-xl border border-slate-200 bg-white text-rose-400 transition hover:border-rose-200 hover:bg-rose-50 active:scale-90"
                  :aria-label="`Remove ${line.title}`"
                  @click="cart.removeLine(line.productId)"
                >
                  <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4h6v2" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Line total -->
            <p class="shrink-0 text-sm font-bold text-slate-900">
              {{ formatGhs(line.unitPriceCents * line.quantity) }}
            </p>
          </li>
        </ul>

        <!-- Footer -->
        <footer
          v-if="cart.lines.length"
          class="shrink-0 border-t border-slate-100 bg-white px-5 pb-6 pt-4"
        >
          <!-- Subtotal row -->
          <div class="mb-3 flex items-center justify-between">
            <span class="text-sm text-slate-500">Subtotal</span>
            <span class="text-lg font-extrabold text-slate-900">{{ formatGhs(cart.lineTotalCents) }}</span>
          </div>

          <!-- Info note -->
          <div class="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5">
            <svg class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p class="text-[11px] leading-relaxed text-amber-700">
              No online payment — you arrange payment directly with the seller after placing your order.
            </p>
          </div>

          <!-- Checkout CTA -->
          <RouterLink
            v-if="canCheckout()"
            :to="checkoutPath()"
            class="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-slate-700 active:scale-[0.98]"
            @click="close"
          >
            Place order
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </RouterLink>
          <p
            v-else
            class="flex items-center justify-center gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 py-3 text-xs font-medium text-amber-700"
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Open this store's page to check out.
          </p>
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>
