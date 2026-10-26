import os from "node:os";
import path from "node:path";

import { defineConfig } from "@playwright/test";

const E2E_PORT = Number(process.env.APW_E2E_PORT ?? "8790");
const E2E_URL = `http://127.0.0.1:${E2E_PORT}`;
const python = process.env.APW_E2E_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const database = path.join(os.tmpdir(), "apw", `e2e-events-${E2E_PORT}.db`);

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
    command: `"${python}" -m agent_pdf_workbench.viewer_server --db-path "${database}" --port ${E2E_PORT} --pdf-root "${os.tmpdir()}"`,
    env: { PYTHONPATH: "src" },
    url: `${E2E_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
