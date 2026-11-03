import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: false,
  experimental: {
    // Demo document uploads travel with the form (2 MB cap in lib/documents.ts). Live uploads go straight to storage.
    serverActions: { bodySizeLimit: "3mb" },
  },
  // Planning Mode reads its standards context from markdown at runtime.
  outputFileTracingIncludes: {
    "/api/ai/planning": ["./lib/anthropic/context/**/*.md"],
    "/planning/[id]": ["./lib/anthropic/context/**/*.md"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
