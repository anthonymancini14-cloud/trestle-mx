import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      // Server-only guard is a Next.js build-time check; a no-op under test.
      "server-only": path.resolve(import.meta.dirname, "tests/server-only-stub.ts"),
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
