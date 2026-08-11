/** @type {import('next').NextConfig} */

// Baseline security headers applied to every response. These mitigate
// clickjacking, MIME sniffing, referrer leakage, and force HTTPS.
//
// NOTE: there is no Content-Security-Policy header here yet. A CSP scoped to
// Clerk + Stripe origins (with script-src/style-src covering the app's own
// inline usage) is tracked separately (see issue #77) — it needs to be
// designed and verified against a real build before shipping, since a
// misconfigured CSP could silently break the Clerk widget, Stripe checkout,
// or inline styles instead of failing loudly.
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
