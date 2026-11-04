import "dotenv/config";
import { Pool } from "pg";
import { createDatabaseClient } from "../src/models/databaseClient.ts";

import { testDatabaseUrl } from "./testDatabaseUrl.ts";

const directUrl = testDatabaseUrl(process.env.TEST_DATABASE_URL);

export const testPrisma = createDatabaseClient(directUrl.toString(), {
  // Generous, because the tests reach a hosted database across a VPN and Prisma's default
  // two second maxWait is shorter than a single round trip under load.
  transactionOptions: { maxWait: 20_000, timeout: 40_000 },
});

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
