import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // One test file at a time. The integration tests share a single database, and some of
    // them TRUNCATE, which takes a lock that blocks any other transaction on those tables.
    // Run in parallel they deadlock each other until the timeout rather than failing on
    // anything real.
    fileParallelism: false,

    // The database is hosted, so every query is a round trip, and bcrypt at cost 12 adds
    // a quarter of a second per hash on top. The seed repeatability tests run the whole
    // seed three times, which is a handful of hashes and a few dozen round trips, so 30
    // seconds was not enough. The unit tests still finish in milliseconds.
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
