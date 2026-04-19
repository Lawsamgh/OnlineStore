<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import DeliveryTracker from '../../components/DeliveryTracker.vue'
import { useAuthStore } from '../../stores/auth'
import { useToastStore } from '../../stores/toast'

const route = useRoute()
const auth = useAuthStore()
const toast = useToastStore()

const storeSlug = String(route.params.storeSlug ?? '')
const orderId = String(route.params.orderId ?? '')
const token = String(route.query.t ?? '')

onMounted(() => {
  const w = sessionStorage.getItem('lastOrderNotifyWarning')
  if (w) {
    toast.info(`Notifications may be delayed: ${w}`)
    sessionStorage.removeItem('lastOrderNotifyWarning')
  }
})
</script>

<template>
  <div class="mx-auto max-w-lg px-4 py-12 text-center">
    <p class="text-3xl" aria-hidden="true">✓</p>
    <h1 class="mt-2 text-2xl font-bold text-slate-900">Order placed</h1>
    <p class="mt-2 text-sm text-slate-600">
      The seller has been notified (email &amp; WhatsApp when configured). Save
      your reference:
    </p>
    <p class="mt-4 break-all font-mono text-xs text-slate-800">{{ orderId }}</p>
    <p v-if="token" class="mt-1 text-xs text-slate-500">
      Confirmation token recorded for notifications.
    </p>
    <div class="mt-8 space-y-4 text-left">
      <DeliveryTracker v-if="auth.isSignedIn" :order-id="orderId" />
      <p v-else class="text-sm text-slate-500">
        <RouterLink to="/login" class="font-medium text-emerald-700"
          >Sign in</RouterLink
        >
        to see live delivery updates for this order.
      </p>
    </div>
    <RouterLink
      :to="`/${storeSlug}`"
      class="mt-8 inline-block text-sm font-medium text-emerald-700 hover:text-emerald-800"
    >
      Continue shopping
    </RouterLink>
  </div>
</template>
