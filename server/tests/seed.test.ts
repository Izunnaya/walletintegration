import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "../src/generated/prisma/client.ts";
import { testPrisma } from "./database.ts";
import { applySeed } from "../src/models/seedData.ts";

afterAll(async () => { await testPrisma.$disconnect(); });

async function inRolledBackTransaction(work: (client: Prisma.TransactionClient) => Promise<void>) {
  const rollback = new Error("test rollback");
  try {
    await testPrisma.$transaction(async (client) => {
      await client.$executeRaw`TRUNCATE idempotency_records, ledger_entries, transfers,
        admin_audit_entries, wallets, users, blacklist_entries CASCADE`;
      await work(client);
      throw rollback;
    }, { timeout: 30000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

type WalletRow = { email: string; is_system: boolean; balance_minor: string; ledger_total: string };
async function walletState(client: Prisma.TransactionClient) {
  return client.$queryRaw<WalletRow[]>`
    SELECT u.email, w.is_system, w.balance_minor::text AS balance_minor,
           COALESCE(SUM(l.amount_minor), 0)::text AS ledger_total
      FROM wallets w JOIN users u ON u.id = w.owner_id
      LEFT JOIN ledger_entries l ON l.wallet_id = w.id
     GROUP BY u.email, w.is_system, w.balance_minor ORDER BY u.email
  `;
}

describe("applySeed", () => {
  it("rolls back users, funding transfers, ledger entries, and balances on an application error", async () => {
    const before = await testPrisma.$transaction([
      testPrisma.user.count(), testPrisma.wallet.count(), testPrisma.transfer.count(),
      testPrisma.ledgerEntry.count(), testPrisma.blacklistEntry.count(),
    ]);
    const failure = new Error("injected error before commit");

    await expect(testPrisma.$transaction(async (client) => {
      await applySeed(client);
      throw failure;
    }, { timeout: 30000 })).rejects.toBe(failure);

    const after = await testPrisma.$transaction([
      testPrisma.user.count(), testPrisma.wallet.count(), testPrisma.transfer.count(),
      testPrisma.ledgerEntry.count(), testPrisma.blacklistEntry.count(),
    ]);
    expect(after).toEqual(before);
  });

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

      const transfers = await client.$queryRawUnsafe<{ count: string }[]>(
        `SELECT COUNT(*)::text AS count FROM transfers WHERE reference LIKE 'seed-fund-%'`,
      );

      expect(transfers[0]?.count).toBe("3");
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

      const result = await client.$queryRawUnsafe<{ count: string }[]>(
        `SELECT COUNT(*)::text AS count FROM wallets WHERE is_system = TRUE`,
      );

      expect(result[0]?.count).toBe("1");
    });
  });

  it("seeds a blacklisted email so a refused registration can be demonstrated", async () => {
    await inRolledBackTransaction(async (client) => {
      await applySeed(client);

      const result = await client.$queryRawUnsafe<{ email: string }[]>(
        `SELECT email FROM blacklist_entries`,
      );

      expect(result.map((row) => row.email)).toContain("fraudster@example.com");
    });
  });

  it("does not reset the admin password on a later run", async () => {
    await inRolledBackTransaction(async (client) => {
      await applySeed(client);

      await client.$executeRawUnsafe(`UPDATE users SET password_hash = 'changed-by-hand' WHERE role = 'admin'`);
      await applySeed(client);

      const admins = await client.$queryRawUnsafe<{ password_hash: string }[]>(
        `SELECT password_hash FROM users WHERE role = 'admin'`,
      );

      // The build spec is explicit that the seed must not reset the admin password, because
      // a deployed credential is changed deliberately, not by whoever runs the seed next.
      for (const admin of admins) {
        expect(admin.password_hash).toBe("changed-by-hand");
      }
    });
  });
});
