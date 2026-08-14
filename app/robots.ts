import type { MetadataRoute } from "next";
import { COMPANY } from "@/lib/legal";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/settings", "/billing", "/api/", "/events", "/supplier"],
    },
    sitemap: `https://${COMPANY.site}/sitemap.xml`,
  };
}
