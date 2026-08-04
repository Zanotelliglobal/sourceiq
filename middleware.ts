import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public routes that must NOT require a Clerk session:
//   • the marketing/landing page and auth pages
//   • the inbound email webhook (verified via Svix signature, not a user session)
//   • the Stripe webhook (verified via Stripe signature)
//   • the unsubscribe endpoint (clicked by suppliers, who have no session;
//     authorized by an unguessable per-supplier reply token)
const isPublic = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/legal(.*)",
  "/api/inbound(.*)",
  "/api/stripe/webhook(.*)",
  "/api/unsubscribe(.*)",
  // Supplier-facing RFI response form + its submit endpoint. Suppliers have no
  // session; authorized by an unguessable per-supplier reply token.
  "/supplier(.*)",
  "/api/supplier-response(.*)",
]);

// DEV-ONLY: when DEV_AUTH_BYPASS=1 (and not in production), skip route
// protection so the app is usable on networks where the Clerk dev handshake
// is blocked. Inert in production. Mirrors the bypass in lib/tenant.ts.
const DEV_BYPASS =
  process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "1";

export default clerkMiddleware((auth, req) => {
  if (!DEV_BYPASS && !isPublic(req)) {
    auth().protect();
  }

  // Referral capture: a `?ref=CODE` on any request stashes the code in a cookie
  // (30 days) so it survives sign-up and is read at org creation for attribution.
  const ref = req.nextUrl.searchParams.get("ref");
  if (ref) {
    const res = NextResponse.next();
    res.cookies.set("siq_ref", ref.trim().toUpperCase().slice(0, 16), {
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });
    return res;
  }
});

export const config = {
  matcher: [
    // Skip Next internals and static files, but always run for API routes.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
