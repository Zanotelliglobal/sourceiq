// Shared supplier-dedup helpers. Extracted from app/api/orchestrate/route.ts
// so app/api/investigate-quick/route.ts (Quick Investigation) can dedup
// candidates against existing suppliers for an event using the exact same
// logic as the full-investigation pipeline.

// Dedup on BOTH a normalized company name and a website domain, so
// "Acme Manufacturing Inc." and "Acme Mfg" (or two listings that share a
// domain) collapse to one. Exact-string matching leaked obvious dupes.
export const normName = (n: string) =>
  (n || "")
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|company|srl|spa|sa|ag|kg|bv|plc|pvt|pte|group|holding|holdings|industries|manufacturing|mfg)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

export const domainOf = (url: string | null | undefined) => {
  if (!url) return "";
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();
};
