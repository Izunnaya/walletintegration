import { Pool } from "pg";

// One pool for the whole process.
//
// A plain query borrows a client and hands it straight back. A transaction checks one out
// with pool.connect() and keeps it until COMMIT, which is what makes SELECT ... FOR UPDATE
// locks hold across statements. Running two statements of one transaction on two different
// clients would silently escape the locks, so the transaction client is always passed
// explicitly rather than reached for.

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. The service cannot start without a database.");
}

const isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");

export const pool = new Pool({
  connectionString,
  // Hosted Postgres requires TLS. Certificate verification stays on.
  ssl: isLocal ? false : { rejectUnauthorized: true },
});
