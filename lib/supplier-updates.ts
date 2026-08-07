// ─── SUPPLIER_UPDATED REDUCER ─────────────────────────────────────────────────
// Pure merge logic for the `supplier_updated` SSE event emitted by the
// discovery route (see lib/process-supplier.ts) when a background enrichment
// or contact scrape resolves after the supplier card has already been
// streamed. Extracted from app/events/[id]/page.tsx so it's unit-testable
// without React.

/** Merge a `supplier_updated` event's contact/enrichment fields into the
 * matching supplier by id. Only fields present (non-empty) in the event are
 * patched; everything else on the supplier is left as-is. Returns the same
 * array reference when there is nothing to patch, so callers can pass this
 * straight to setState without triggering a pointless re-render. */
export function applySupplierUpdated<T extends { id: number }>(
  suppliers: T[],
  msg: Record<string, unknown>
): T[] {
  const id = msg.id as number;
  const patch: Partial<Record<"contact_email" | "contact_url" | "contact_phone" | "contact_linkedin" | "enrichment" | "verification_badges", string>> = {};
  if (typeof msg.contact_email === "string" && msg.contact_email) patch.contact_email = msg.contact_email;
  if (typeof msg.contact_url === "string" && msg.contact_url) patch.contact_url = msg.contact_url;
  if (typeof msg.contact_phone === "string" && msg.contact_phone) patch.contact_phone = msg.contact_phone;
  if (typeof msg.contact_linkedin === "string" && msg.contact_linkedin) patch.contact_linkedin = msg.contact_linkedin;
  if (typeof msg.enrichment === "string" && msg.enrichment) patch.enrichment = msg.enrichment;
  if (typeof msg.verification_badges === "string" && msg.verification_badges) patch.verification_badges = msg.verification_badges;

  if (Object.keys(patch).length === 0) return suppliers;
  return suppliers.map(s => (s.id === id ? { ...s, ...patch } : s));
}
