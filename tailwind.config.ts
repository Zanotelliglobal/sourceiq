import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        // Brand — Trust Blue (procurement/enterprise credibility)
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
        // Accent — Signal Amber, reserved for the primary CTA only
        accent: {
          DEFAULT: "#d97706",
          fg: "#ffffff",
        },
        // Semantic funnel-status tokens (always pair with a label/icon — never color-only)
        status: {
          long: "#64748b",     // Long list  (slate)
          contacted: "#3b82f6",// Contacted  (blue)
          responded: "#059669",// Responded  (green)
          declined: "#dc2626", // Declined   (red)
          shortlist: "#d97706",// Shortlisted(amber/gold)
        },
      },
      boxShadow: {
        sm: "0 1px 2px rgba(15,23,42,0.05)",
        md: "0 4px 6px rgba(15,23,42,0.08)",
        lg: "0 10px 15px rgba(15,23,42,0.10)",
        xl: "0 20px 25px rgba(15,23,42,0.12)",
      },
    },
  },
  plugins: [],
};
export default config;
