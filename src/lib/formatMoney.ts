export function formatGhs(cents: number): string {
  return `GH₵ ${(cents / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
