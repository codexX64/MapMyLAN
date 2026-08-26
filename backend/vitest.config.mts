import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Backend suites plus the standalone drop-in modules under ../src.
    include: ["src/**/*.test.ts", "../src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    environment: "node",
  },
});
