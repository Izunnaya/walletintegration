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

const url = new URL(connectionString);

// sslmode and channel_binding are libpq parameters. node-postgres does not implement
// channel binding, and it warns that it currently treats sslmode=require as verify-full
// but will stop. Dropping both and configuring TLS below means the behaviour is stated
// here rather than inherited from a string a hosting provider generated.
url.searchParams.delete("sslmode");
url.searchParams.delete("channel_binding");

const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";

export const pool = new Pool({
  connectionString: url.toString(),
  // Hosted Postgres requires TLS, with the certificate verified against a real CA.
  ssl: isLocal ? false : { rejectUnauthorized: true },
});
