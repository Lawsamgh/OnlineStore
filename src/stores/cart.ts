import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type CartLine = {
  productId: string
  title: string
  quantity: number
  unitPriceCents: number
  imageUrl?: string | null
}

export const useCartStore = defineStore('cart', () => {
  const lines = ref<CartLine[]>([])
  const storeId = ref<string | null>(null)
  const storeSlug = ref<string | null>(null)

  const itemCount = computed(() =>
    lines.value.reduce((sum, line) => sum + line.quantity, 0),
  )

  const lineTotalCents = computed(() =>
    lines.value.reduce(
      (sum, line) => sum + line.unitPriceCents * line.quantity,
      0,
    ),
  )

  function setStoreContext(id: string, slug: string) {
    if (storeId.value && storeId.value !== id) {
      lines.value = []
    }
    storeId.value = id
    storeSlug.value = slug
  }

  function clearStoreContext() {
    storeId.value = null
    storeSlug.value = null
    lines.value = []
  }

  function addLine(line: CartLine) {
    const existing = lines.value.find((l) => l.productId === line.productId)
    if (existing) {
      existing.quantity += line.quantity
    } else {
      lines.value.push({ ...line })
    }
  }

  function setQty(productId: string, qty: number) {
    const line = lines.value.find((l) => l.productId === productId)
    if (!line) return
    if (qty <= 0) {
      lines.value = lines.value.filter((l) => l.productId !== productId)
    } else {
      line.quantity = qty
    }
  }

  function removeLine(productId: string) {
    lines.value = lines.value.filter((l) => l.productId !== productId)
  }

  function clearLines() {
    lines.value = []
  }

  function clear() {
    clearLines()
    clearStoreContext()
  }

  return {
    lines,
    storeId,
    storeSlug,
    itemCount,
    lineTotalCents,
    setStoreContext,
    clearStoreContext,
    addLine,
    setQty,
    removeLine,
    clearLines,
    clear,
  }
})
