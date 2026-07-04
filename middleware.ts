import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public routes that must NOT require a Clerk session:
//   • the marketing/landing page and auth pages
//   • the inbound email webhook (verified via Svix signature, not a user session)
//   • the Stripe webhook (verified via Stripe signature)
const isPublic = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/inbound(.*)",
  "/api/stripe/webhook(.*)",
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
});

export const config = {
  matcher: [
    // Skip Next internals and static files, but always run for API routes.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
