<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { formatGhs } from '../lib/formatMoney'
import { useCartStore } from '../stores/cart'
import { useUiStore } from '../stores/ui'

const cart = useCartStore()
const ui = useUiStore()
const route = useRoute()

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
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="ui.cartDrawerOpen"
        class="fixed inset-0 z-40 bg-slate-900/40"
        aria-hidden="true"
      />
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-200 ease-out"
      leave-active-class="transition-transform duration-200 ease-in"
      enter-from-class="translate-x-full"
      leave-to-class="translate-x-full"
    >
      <aside
        v-if="ui.cartDrawerOpen"
        class="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl"
        role="dialog"
        aria-label="Shopping cart"
      >
        <header
          class="flex items-center justify-between border-b border-slate-100 px-4 py-3"
        >
          <h2 class="text-lg font-semibold text-slate-900">Cart</h2>
          <button
            type="button"
            class="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close cart"
            @click="close"
          >
            ✕
          </button>
        </header>

        <div v-if="cart.lines.length === 0" class="flex flex-1 flex-col items-center justify-center px-6 text-center text-slate-500">
          <p>Your cart is empty.</p>
          <p class="mt-2 text-sm">Browse a store and add products.</p>
        </div>

        <ul v-else class="flex-1 divide-y divide-slate-100 overflow-y-auto px-4 py-2">
          <li
            v-for="line in cart.lines"
            :key="line.productId"
            class="flex gap-3 py-3"
          >
            <div class="min-w-0 flex-1">
              <p class="font-medium text-slate-900">{{ line.title }}</p>
              <p class="text-sm text-slate-500">
                {{ formatGhs(line.unitPriceCents) }} each
              </p>
              <div class="mt-2 flex items-center gap-2">
                <label class="sr-only" :for="`qty-${line.productId}`">Quantity</label>
                <input
                  :id="`qty-${line.productId}`"
                  type="number"
                  min="1"
                  class="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
                  :value="line.quantity"
                  @change="
                    cart.setQty(
                      line.productId,
                      Number(($event.target as HTMLInputElement).value) || 1,
                    )
                  "
                />
                <button
                  type="button"
                  class="text-sm text-red-600 hover:underline"
                  @click="cart.removeLine(line.productId)"
                >
                  Remove
                </button>
              </div>
            </div>
            <div class="shrink-0 text-right text-sm font-medium text-slate-800">
              {{ formatGhs(line.unitPriceCents * line.quantity) }}
            </div>
          </li>
        </ul>

        <footer
          v-if="cart.lines.length"
          class="border-t border-slate-100 bg-slate-50 px-4 py-4"
        >
          <div class="mb-3 flex justify-between text-sm text-slate-600">
            <span>Subtotal</span>
            <span class="font-semibold text-slate-900">{{
              formatGhs(cart.lineTotalCents)
            }}</span>
          </div>
          <p class="mb-3 text-xs text-slate-500">
            No online product payment — you arrange payment with the seller.
          </p>
          <RouterLink
            v-if="canCheckout()"
            :to="checkoutPath()"
            class="block w-full rounded-lg bg-emerald-700 py-2.5 text-center text-sm font-semibold text-white hover:bg-emerald-800"
            @click="close"
          >
            Checkout
          </RouterLink>
          <p v-else class="text-center text-xs text-amber-700">
            Open this store’s page to check out, or your cart is for another shop.
          </p>
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>
