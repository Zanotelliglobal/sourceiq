// ─── LEGAL / COMPANY CONSTANTS ────────────────────────────────────────────────
// Single source of truth for the entity details shown on the Privacy Policy and
// Terms of Service pages. Postal address is pulled from the same env var used in
// the CAN-SPAM/CASL email footer so the two never drift apart.

export const COMPANY = {
  /** Consumer-facing product/brand name. */
  product: "SourceGPT",
  /** Registered legal entity operating the service. */
  legalName: "ZNT S.r.l.s.",
  /** Primary domain of the marketing site. */
  site: "sourcegpt.org",
  /** Where the app itself is served. */
  appUrl: process.env.NEXT_PUBLIC_APP_URL || "https://app.sourcegpt.org",
  /** Contact + privacy inbox. */
  contactEmail: process.env.SUPPORT_EMAIL || "hello@sourcegpt.org",
  privacyEmail: process.env.PRIVACY_EMAIL || "privacy@sourcegpt.org",
  /** Registered postal address (shared with the email compliance footer). */
  postalAddress: process.env.MAIL_POSTAL_ADDRESS || null,
} as const;

// Bump this date whenever the policy text is edited materially.
export const LEGAL_LAST_UPDATED = "12 July 2026";
