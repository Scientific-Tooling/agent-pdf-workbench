import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const repoRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(repoRoot, "frontend"),
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8790",
      },
    },
  },
  build: {
    outDir: resolve(repoRoot, "src/agent_pdf_workbench/web"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "app.js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            return "styles.css";
          }
          return "[name]-[hash][extname]";
        },
      },
    },
  },
});
