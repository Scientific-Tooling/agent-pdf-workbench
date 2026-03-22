import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const repoRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(repoRoot, "frontend"),
  base: "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "PDF Workbench",
        short_name: "PDF Workbench",
        description: "Scientific paper reading and annotation tool",
        theme_color: "#2563eb",
        background_color: "#f0f4f8",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg}"],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
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
