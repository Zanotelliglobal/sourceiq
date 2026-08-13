import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import AppShell from "@/components/AppShell";
import TopNav from "@/components/TopNav";
import SiteFooter from "@/components/SiteFooter";
import CookieConsent from "@/components/CookieConsent";
import { LanguageProvider } from "@/components/LanguageProvider";
import { COMPANY } from "@/lib/legal";

// UI/marketing face — professional but approachable (top-ranked B2B/enterprise pairing).
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
});
// Data face — tabular figures for scores, spend, token costs (prevents column jitter).
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
});

const siteUrl = `https://${COMPANY.site}`;
const title = "SourceIQ — AI Supplier Intelligence";
const description =
  "SourceIQ deploys AI agents to discover, score, and shortlist qualified suppliers across global networks — turning weeks of procurement desk research into minutes.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: title, template: "%s — SourceIQ" },
  description,
  keywords: [
    "AI supplier sourcing",
    "supplier discovery software",
    "procurement intelligence platform",
    "AI procurement agent",
    "supplier scoring and shortlisting",
    "vendor sourcing automation",
  ],
  authors: [{ name: "SourceIQ" }],
  alternates: { canonical: siteUrl },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "SourceIQ",
    title,
    description,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
    <html lang="en" className={`${jakarta.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans">
        <LanguageProvider>
          <div className="min-h-screen flex flex-col">
            <TopNav />
            <main className="flex-1"><AppShell>{children}</AppShell></main>
            <SiteFooter />
          </div>
          <CookieConsent />
        </LanguageProvider>
      </body>
    </html>
    </ClerkProvider>
  );
}
