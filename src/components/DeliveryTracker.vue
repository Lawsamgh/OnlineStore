<script setup lang="ts">
import type { RealtimeChannel } from '@supabase/supabase-js'
import { onBeforeUnmount, ref, watch } from 'vue'
import { getSupabaseBrowser, isSupabaseConfigured } from '../lib/supabase'
import { useToastStore } from '../stores/toast'
import SkeletonDeliveryMini from './skeleton/SkeletonDeliveryMini.vue'

const toast = useToastStore()

const props = defineProps<{
  orderId: string
}>()

type TrackingRow = {
  stage: string
  driver_name: string | null
  driver_phone: string | null
  last_message: string | null
  last_latitude: number | null
  last_longitude: number | null
  updated_at: string
}

const row = ref<TrackingRow | null>(null)
const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')

let channel: RealtimeChannel | null = null

async function loadOnce() {
  if (!isSupabaseConfigured()) return
  const supabase = getSupabaseBrowser()
  const { data, error } = await supabase
    .from('delivery_tracking')
    .select(
      'stage, driver_name, driver_phone, last_message, last_latitude, last_longitude, updated_at',
    )
    .eq('order_id', props.orderId)
    .maybeSingle()
  if (error) {
    toast.error(error.message)
    status.value = 'error'
    return
  }
  row.value = data as TrackingRow | null
  status.value = 'ready'
}

function subscribe() {
  if (!isSupabaseConfigured()) return
  const supabase = getSupabaseBrowser()
  void loadOnce()
  const name = `delivery:${props.orderId}`
  channel = supabase
    .channel(name)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'delivery_tracking',
        filter: `order_id=eq.${props.orderId}`,
      },
      (payload) => {
        const next = (payload.new ?? payload.old) as TrackingRow | null
        if (next && typeof next === 'object' && 'stage' in next) {
          row.value = next
        }
      },
    )
    .subscribe()
}

function unsubscribe() {
  if (!isSupabaseConfigured()) return
  const supabase = getSupabaseBrowser()
  if (channel) {
    void supabase.removeChannel(channel)
    channel = null
  }
}

watch(
  () => props.orderId,
  () => {
    unsubscribe()
    status.value = 'loading'
    subscribe()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  unsubscribe()
})

const stageLabel: Record<string, string> = {
  pending: 'Pending',
  picked_up: 'Picked up',
  in_transit: 'In transit',
  delivered: 'Delivered',
}
</script>

<template>
  <section
    class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    aria-live="polite"
  >
    <h3 class="text-sm font-semibold text-slate-900">Delivery</h3>
    <SkeletonDeliveryMini v-if="status === 'loading'" />
    <p v-else-if="status === 'error'" class="mt-2 text-sm text-slate-600">
      Delivery updates could not be loaded.
    </p>
    <div v-else-if="row" class="mt-3 space-y-2 text-sm text-slate-700">
      <p>
        <span class="font-medium text-slate-900">Status:</span>
        {{ stageLabel[row.stage] ?? row.stage }}
      </p>
      <p v-if="row.driver_name">
        <span class="font-medium text-slate-900">Driver:</span>
        {{ row.driver_name }}
        <span v-if="row.driver_phone"> · {{ row.driver_phone }}</span>
      </p>
      <p v-if="row.last_message" class="text-slate-600">
        {{ row.last_message }}
      </p>
      <p v-if="row.last_latitude != null && row.last_longitude != null" class="text-xs text-slate-500">
        Last location: {{ row.last_latitude.toFixed(4) }},
        {{ row.last_longitude.toFixed(4) }}
      </p>
      <p class="text-xs text-slate-400">
        Updated {{ new Date(row.updated_at).toLocaleString() }}
      </p>
    </div>
    <p v-else class="mt-2 text-sm text-slate-500">No tracking row yet.</p>
  </section>
</template>
