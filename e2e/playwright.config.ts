import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./",
  testMatch: "*.spec.ts",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:4000",
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  reporter: [["list"], ["html", { open: "never", outputFolder: "report" }]],
});
