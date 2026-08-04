import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import AppShell from "@/components/AppShell";
import TopNav from "@/components/TopNav";
import SiteFooter from "@/components/SiteFooter";
import CookieConsent from "@/components/CookieConsent";
import { LanguageProvider } from "@/components/LanguageProvider";

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

export const metadata: Metadata = {
  title: "SourceIQ — AI Supplier Intelligence",
  description: "Multi-agent supplier discovery and procurement intelligence platform",
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
