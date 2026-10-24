import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4173/stepcast/",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun scripts/serve.ts",
    url: "http://localhost:4173/stepcast/",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--auto-accept-this-tab-capture",
            "--auto-select-desktop-capture-source=Entire screen",
          ],
        },
      },
    },
  ],
});
