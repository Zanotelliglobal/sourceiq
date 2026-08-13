import type { MetadataRoute } from "next";
import { COMPANY } from "@/lib/legal";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = `https://${COMPANY.site}`;
  const now = new Date();

  return [
    { url: base, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/sign-up`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/sign-in`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/legal/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/legal/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
