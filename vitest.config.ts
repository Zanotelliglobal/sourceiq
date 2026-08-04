import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit-test runner for pure application logic (pricing, tier entitlement, usage
// accounting). We map the `@/…` import alias to the repo root so tests import
// modules exactly like the app does (mirrors tsconfig `paths`).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
