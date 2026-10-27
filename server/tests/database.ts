import "dotenv/config";
import { Pool } from "pg";
import { createDatabaseClient } from "../src/models/databaseClient.ts";

// One database and one schema, shared with the application.
//
// **Every database test must do its work inside inRolledBackTransaction.** That is not a
// style preference: some tests TRUNCATE to get a known-empty state, and a TRUNCATE that
// escaped its transaction would delete the seeded demo data for real. Inside a transaction
// that is always rolled back, it is invisible to everything else and undone on the way out.
//
// The rollback sits in a finally block, so it still runs when an assertion fails, when the
// work throws, and when the process is killed - Postgres aborts an open transaction on a
// dropped connection. What it does not survive is a test that commits deliberately, so no
// test does.
//
// An earlier version required a separate TEST_DATABASE_URL and a wallet_test schema. It was
// safer, and it cost a second environment variable, a second migration target, and Neon's
// pooled endpoint refusing the search_path startup parameter that schema scoping needs. One
// schema removes all three.

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. The database tests need a real PostgreSQL.");
}

// The tests use Neon's DIRECT endpoint, not the pooled one.
//
// A pooled connection is a PgBouncer session shared between clients, so session state set
// by one client can still be attached to the backend handed to the next. A stale
// "SET search_path" left behind by an earlier run made every table appear not to exist,
// which is a confusing failure to debug and nothing to do with the code under test.
// The direct endpoint gives each client its own backend, so what a test sees is its own.
const directUrl = new URL(connectionString);
directUrl.hostname = directUrl.hostname.replace("-pooler", "");

export const testPrisma = createDatabaseClient(directUrl.toString());

// The constraint tests deliberately bypass the ORM: they assert on the constraint name
// PostgreSQL reports, which is the evidence that the constraint exists at all.
const rawUrl = new URL(directUrl);
for (const parameter of ["schema", "sslmode", "sslcert", "sslkey", "sslrootcert", "channel_binding"]) {
  rawUrl.searchParams.delete(parameter);
}

const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(rawUrl.hostname);

export const pool = new Pool({
  connectionString: rawUrl.toString(),
  ssl: isLocal ? false : { rejectUnauthorized: true },
});
