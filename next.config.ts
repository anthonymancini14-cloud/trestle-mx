import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: false,
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
