import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import LandingContent from "@/components/LandingContent";

// Public marketing landing. Signed-in users are sent straight to the dashboard;
// signed-out visitors get the credibility → book-demo funnel (MASTER.md: Landing).
// The presentational markup lives in the LandingContent client component so it
// can use the i18n hook; this server wrapper only handles the auth redirect.
export default function Home() {
  const { userId } = auth();
  if (userId) redirect("/dashboard");

  return <LandingContent />;
}
