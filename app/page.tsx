import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import LandingContent from "@/components/LandingContent";
import { COMPANY } from "@/lib/legal";

// Structured data for search engines (SoftwareApplication rich result).
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "SourceIQ",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: `https://${COMPANY.site}`,
  description:
    "AI agents that discover, score, and shortlist qualified suppliers across global networks.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "14-day free trial, no credit card required",
  },
};

// Public marketing landing. Signed-in users are sent straight to the dashboard;
// signed-out visitors get the credibility → book-demo funnel (MASTER.md: Landing).
// The presentational markup lives in the LandingContent client component so it
// can use the i18n hook; this server wrapper only handles the auth redirect.
export default function Home() {
  const { userId } = auth();
  if (userId) redirect("/dashboard");

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingContent />
    </>
  );
}
