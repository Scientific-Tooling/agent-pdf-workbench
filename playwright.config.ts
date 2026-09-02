import os from "node:os";

import { defineConfig } from "@playwright/test";

const E2E_PORT = 8790;
const E2E_URL = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: "frontend/e2e",
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: E2E_URL,
    trace: "on-first-retry",
  },
  webServer: {
    // --pdf-root mirrors the recommended local posture; the specs write their
    // fixture PDFs into the OS temp directory.
    command: `PYTHONPATH=src python3 -m agent_pdf_workbench.viewer_server --db-path /tmp/apw/e2e-events.db --port ${E2E_PORT} --pdf-root ${os.tmpdir()}`,
    url: `${E2E_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
