import preact from "@preact/preset-vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

// Builds the embeddable script as one classic IIFE file. The web app serves it
// from /sdk/haptic.js.
export default defineConfig(({ mode }) => ({
  plugins: [preact({ devToolsEnabled: false, prefreshEnabled: false })],
  define: {
    __HAPTIC_DEV__: JSON.stringify(mode !== "production"),
    __HAPTIC_VERSION__: JSON.stringify(pkg.version),
    "process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development"),
  },
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      name: "HapticSDK",
      formats: ["iife"],
      fileName: () => "haptic.js",
    },
    outDir: resolve(import.meta.dirname, "../../apps/web/public/sdk"),
    emptyOutDir: true,
    target: "es2020",
    minify: mode === "production",
    sourcemap: true,
    reportCompressedSize: true,
  },
}));
