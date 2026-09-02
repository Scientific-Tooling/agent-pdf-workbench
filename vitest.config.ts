import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Most suites are pure functions; the two that render into a document opt
    // into jsdom with a `@vitest-environment` docblock. Loading jsdom for every
    // file made worker startup the slowest part of the run.
    environment: "node",
    include: ["frontend/src/**/*.test.ts"],
  },
});
