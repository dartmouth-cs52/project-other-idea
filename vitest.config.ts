import preact from "@preact/preset-vite";
import { playwright } from "@vitest/browser-playwright";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "protocol", include: ["packages/protocol/test/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias: { "@": resolve(import.meta.dirname, "apps/web") } },
        test: { name: "web", include: ["apps/web/test/**/*.test.ts"], environment: "node" },
      },
      {
        plugins: [preact()],
        define: { __HAPTIC_DEV__: "true", __HAPTIC_VERSION__: '"test"' },
        test: { name: "sdk-unit", include: ["packages/sdk/test/unit/**/*.test.ts"], environment: "node" },
      },
      {
        plugins: [preact()],
        define: { __HAPTIC_DEV__: "true", __HAPTIC_VERSION__: '"test"' },
        test: {
          name: "sdk-browser",
          include: ["packages/sdk/test/browser/**/*.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }, { browser: "webkit" }, { browser: "firefox" }],
          },
        },
      },
    ],
  },
});
