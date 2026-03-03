import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
