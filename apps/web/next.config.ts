import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        // The embeddable script. Its URL doesn't change between releases, so
        // keep the cache short.
        source: "/sdk/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: process.env.NODE_ENV === "production" ? "public, max-age=300" : "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
