import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.mjs",
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8030",
    viewport: { width: 1440, height: 960 },
    actionTimeout: 15000,
  },
  webServer: {
    command:
      "cd /Users/leekhan/project/floorplan3d_OS3/backend && /Users/leekhan/project/floorplan3d_blender/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8030",
    url: "http://localhost:8030/api/samples",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
