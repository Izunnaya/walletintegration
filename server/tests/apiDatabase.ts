import "dotenv/config";
import { testDatabaseUrl } from "./testDatabaseUrl.ts";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { createDatabaseClient } from "../src/models/databaseClient.ts";

// A schema of its own for the history, admin and rate-limit tests, created from the real
// migration and dropped afterwards. They write committed rows — a blocked user, an audit
// entry — so they cannot share a schema with anything else, and rolling back is not an
// option when the point is to prove a commit happened.

export const apiSchema = `wallet_api_test_${randomUUID().replaceAll("-", "")}`;

const url = testDatabaseUrl(process.env.TEST_DATABASE_URL, apiSchema);

export const apiPrisma = createDatabaseClient(url.toString(), {
  // Generous: the database is hosted and Prisma's two second default maxWait is shorter than
  // a round trip under load.
  transactionOptions: { maxWait: 20_000, timeout: 40_000 },
});

const rawUrl = new URL(url);
for (const parameter of ["schema", "sslmode", "channel_binding"]) rawUrl.searchParams.delete(parameter);

const pool = new Pool({
  connectionString: rawUrl.toString(),
  ssl: ["localhost", "127.0.0.1"].includes(rawUrl.hostname) ? false : { rejectUnauthorized: true },
});

let created = false;

export async function prepareApiDatabase() {
  const migrationsDirectory = new URL("../prisma/migrations/", import.meta.url);
  const migrations = (await readdir(migrationsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

  const client = await pool.connect();
  try {
    // One transaction, so a migration that fails part way leaves no schema rather than a
    // half-built one the next run trips over.
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${apiSchema}"`);
    await client.query(`SET LOCAL search_path TO "${apiSchema}"`);
    for (const migration of migrations) {
      const sql = await readFile(new URL(`${migration}/migration.sql`, migrationsDirectory), "utf8");
      // The test owns the transaction. A migration COMMIT would reset SET LOCAL and
      // send the next migration to the connection's default schema.
      await client.query(sql.replace(/^(?:BEGIN|COMMIT);\s*$/gm, ""));
    }
    await client.query("COMMIT");
    created = true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function closeApiDatabase() {
  await apiPrisma.$disconnect();
  try {
    if (created) await pool.query(`DROP SCHEMA "${apiSchema}" CASCADE`);
  } finally {
    await pool.end();
  }
}

// Money is moved the way the service moves it: a transfer row, two signed ledger entries and
// both balances. Writing a balance directly would leave the fixtures failing the very
// reconciliation the tests rely on.
export async function fundWallet(walletId: bigint, fromWalletId: bigint, amountMinor: bigint, reference: string) {
  await apiPrisma.$transaction(async (client) => {
    const transfer = await client.transfer.create({
      data: {
        reference,
        sourceWalletId: fromWalletId,
        destinationWalletId: walletId,
        amountMinor,
      },
    });

    await client.ledgerEntry.createMany({
      data: [
        { transferId: transfer.id, walletId: fromWalletId, entryType: "debit", amountMinor: -amountMinor },
        { transferId: transfer.id, walletId: walletId, entryType: "credit", amountMinor: amountMinor },
      ],
    });

    await client.wallet.update({
      where: { id: fromWalletId },
      data: { balanceMinor: { decrement: amountMinor } },
    });

    await client.wallet.update({
      where: { id: walletId },
      data: { balanceMinor: { increment: amountMinor } },
    });

    return transfer;
  });
}
