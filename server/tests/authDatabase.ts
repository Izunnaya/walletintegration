import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool } from "./database.ts";
import { createDatabaseClient } from "../src/models/databaseClient.ts";

// Only this generated schema is created, modified and removed by the HTTP tests.
export const authSchema = `wallet_auth_test_${randomUUID().replaceAll("-", "")}`;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for auth integration tests.");
const url = new URL(connectionString);
url.hostname = url.hostname.replace("-pooler", "");
url.searchParams.set("schema", authSchema);
export const authPrisma = createDatabaseClient(url.toString(), {
  // Generous, because the tests reach a hosted database across a VPN and Prisma's default
  // two second maxWait is shorter than a single round trip under load.
  transactionOptions: { maxWait: 20_000, timeout: 40_000 },
});
let created = false;

export async function prepareAuthDatabase() {
  const migration = await readFile(new URL("../prisma/migrations/0_init/migration.sql", import.meta.url), "utf8");
  const client = await pool.connect();
  try {
    // One transaction, so a migration that fails part way leaves no schema at all rather
    // than a half-built one the next run would trip over. SET LOCAL scopes the search_path
    // to this transaction, so nothing has to reset it afterwards.
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${authSchema}"`);
    await client.query(`SET LOCAL search_path TO "${authSchema}"`);
    await client.query(migration);
    await client.query("COMMIT");
    created = true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function closeAuthDatabase() {
  await authPrisma.$disconnect();
  try {
    if (created) await pool.query(`DROP SCHEMA "${authSchema}" CASCADE`);
  } finally {
    await pool.end();
  }
}

export async function failWalletCreation(fail: boolean) {
  if (fail) {
    await pool.query(`CREATE FUNCTION "${authSchema}".reject_wallet() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected wallet failure'; END $$`);
    await pool.query(`CREATE TRIGGER reject_wallet BEFORE INSERT ON "${authSchema}".wallets
      FOR EACH ROW EXECUTE FUNCTION "${authSchema}".reject_wallet()`);
  } else {
    await pool.query(`DROP TRIGGER IF EXISTS reject_wallet ON "${authSchema}".wallets`);
    await pool.query(`DROP FUNCTION IF EXISTS "${authSchema}".reject_wallet()`);
  }
}
