export function toOrderReference(orderId: string): string {
  const compact = orderId.replace(/-/g, "").toUpperCase();
  if (compact.length < 8) return `ORD-${compact || "UNKNOWN"}`;
  return `ORD-${compact.slice(0, 4)}-${compact.slice(-4)}`;
}
