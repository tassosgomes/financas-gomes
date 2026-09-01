import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Integration suites are intentionally opt-in and run serially against one
 * disposable PostgreSQL database. The test files themselves still guard on
 * T15_INTEGRATION/T08_INTEGRATION so an accidental broad Vitest invocation
 * cannot mutate a database.
 */
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    include: [
      "src/**/*.integration.test.ts",
      "src/modules/households/protected-resource.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
