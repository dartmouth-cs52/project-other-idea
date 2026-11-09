import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the demo app with Haptic installed. Turns go to the
// mock model (via a dev-only header) so runs are deterministic and free.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:4100", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: [
    { command: "npm run dev -w @haptic/web", url: "http://localhost:4000/docs", reuseExistingServer: true, timeout: 120_000 },
    { command: "npm run dev -w @haptic/demo", url: "http://localhost:4100", reuseExistingServer: true, timeout: 60_000 },
  ],
});
