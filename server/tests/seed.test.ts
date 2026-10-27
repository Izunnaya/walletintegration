import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../src/models/db.ts";
import { applySeed } from "../src/models/seedData.ts";

// The build spec requires a test that running the seed twice does not fund anyone twice.
//
// Each test empties the tables and seeds from scratch inside a transaction that is rolled
// back, so it exercises the real first-run path without disturbing the committed demo data.
// TRUNCATE is transactional in Postgres, so the rollback puts everything back.

afterAll(async () => {
  await pool.end();
});

async function inRolledBackTransaction(work: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `TRUNCATE idempotency_records, ledger_entries, transfers, admin_audit_entries,
                wallets, users, blacklist_entries CASCADE`,
    );
    await work(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

type WalletRow = { email: string; is_system: boolean; balance_minor: string; ledger_total: string };

async function walletState(client: PoolClient) {
  const result = await client.query<WalletRow>(
    `SELECT u.email,
            w.is_system,
            w.balance_minor::text AS balance_minor,
            COALESCE(SUM(l.amount_minor), 0)::text AS ledger_total
       FROM wallets w
       JOIN users u ON u.id = w.owner_id
       LEFT JOIN ledger_entries l ON l.wallet_id = w.id
      GROUP BY u.email, w.is_system, w.balance_minor
      ORDER BY u.email`,
  );
  return result.rows;
}

describe("applySeed", () => {
  it("funds every demo customer on the first run", async () => {
    await inRolledBackTransaction(async (client) => {
      const { funded } = await applySeed(client);

      expect(funded).toEqual(["ada@example.com", "bode@example.com", "chidi@example.com"]);
    });
  });

  it("funds nobody on a second run, and leaves every balance unchanged", async () => {
    await inRolledBackTransaction(async (client) => {
      await applySeed(client);
      const afterFirst = await walletState(client);

      const { funded } = await applySeed(client);
      const afterSecond = await walletState(client);

      expect(funded).toEqual([]);
      expect(afterSecond).toEqual(afterFirst);
    });
  });

  it("still funds nobody on a third run", async () => {
    await inRolledBackTransaction(async (client) => {
      await applySeed(client);
      const afterFirst = await walletState(client);

      await applySeed(client);
      const { funded } = await applySeed(client);

      expect(funded).toEqual([]);
      expect(await walletState(client)).toEqual(afterFirst);
    });
  });

  it("creates exactly one transfer per funded customer, however often it runs", async () => {
    await inRolledBackTransaction(async (client) => {
      await applySeed(client);
      await applySeed(client);

      const transfers = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM transfers WHERE reference LIKE 'seed-fund-%'`,
      );

      expect(transfers.rows[0]?.count).toBe("3");
    });
  });

  it("gives every customer balance matching ledger history, so none is invented", async () => {
    await inRolledBackTransaction(async (client) => {
      await applySeed(client);

      // Invariant 8 at the point the money is created. A balance written without entries
      // would show up here as a mismatch.
      for (const wallet of await walletState(client)) {
        expect(wallet.balance_minor, `${wallet.email} balance vs ledger`).toBe(
          wallet.ledger_total,
        );
      }
    });
  });

  it("funds customers out of the system wallet, leaving it negative by the exact total", async () => {
    await inRolledBackTransaction(async (client) => {
      await applySeed(client);
      const wallets = await walletState(client);

      const system = wallets.find((wallet) => wallet.is_system);
      const customerTotal = wallets
        .filter((wallet) => !wallet.is_system)
        .reduce((sum, wallet) => sum + BigInt(wallet.balance_minor), 0n);

      // The money was moved, not created: what the customers hold is exactly what the
      // system wallet is down.
      expect(system).toBeDefined();
      expect(BigInt(system?.balance_minor ?? "0")).toBe(-customerTotal);
    });
  });

  it("creates exactly one system wallet", async () => {
    await inRolledBackTransaction(async (client) => {
      await applySeed(client);
      await applySeed(client);

      const result = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM wallets WHERE is_system = TRUE`,
      );

      expect(result.rows[0]?.count).toBe("1");
    });
  });

  it("seeds a blacklisted email so a refused registration can be demonstrated", async () => {
    await inRolledBackTransaction(async (client) => {
      await applySeed(client);

      const result = await client.query<{ email: string }>(
        `SELECT email FROM blacklist_entries`,
      );

      expect(result.rows.map((row) => row.email)).toContain("fraudster@example.com");
    });
  });

  it("does not reset the admin password on a later run", async () => {
    await inRolledBackTransaction(async (client) => {
      await applySeed(client);

      await client.query(`UPDATE users SET password_hash = 'changed-by-hand' WHERE role = 'admin'`);
      await applySeed(client);

      const admins = await client.query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE role = 'admin'`,
      );

      // The build spec is explicit that the seed must not reset the admin password, because
      // a deployed credential is changed deliberately, not by whoever runs the seed next.
      for (const admin of admins.rows) {
        expect(admin.password_hash).toBe("changed-by-hand");
      }
    });
  });
});
