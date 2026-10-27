import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // One test file at a time. The integration tests share a single database, and some of
    // them TRUNCATE, which takes a lock that blocks any other transaction on those tables.
    // Run in parallel they deadlock each other until the timeout rather than failing on
    // anything real.
    fileParallelism: false,

    // The database is hosted, so every query is a round trip. The unit tests finish in
    // milliseconds; this headroom is for the ones that talk to Postgres.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
