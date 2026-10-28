import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // One test file at a time. The integration tests share a single database, and some of
    // them TRUNCATE, which takes a lock that blocks any other transaction on those tables.
    // Run in parallel they deadlock each other until the timeout rather than failing on
    // anything real.
    fileParallelism: false,

    // The service logs one JSON line per request, which would bury the test output in a
    // few hundred of them. The logger tests are unaffected: they build their own logger at
    // info level writing into an array, which is the only place log output is asserted on.
    env: { LOG_LEVEL: "silent" },

    // The database is hosted, so every query is a round trip, and bcrypt at cost 12 adds
    // a quarter of a second per hash on top. The seed repeatability tests run the whole
    // seed three times, which is a handful of hashes and a few dozen round trips, so 30
    // seconds was not enough. The unit tests still finish in milliseconds.
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
