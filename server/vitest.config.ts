import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,

    env: { LOG_LEVEL: "silent", JWT_SECRET: "wallet-test-signing-secret-not-for-production" },

    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
