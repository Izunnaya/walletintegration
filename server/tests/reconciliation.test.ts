import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../src/generated/prisma/client.ts";
import { apiPrisma, apiSchema, prepareApiDatabase, closeApiDatabase, fundWallet } from "./apiDatabase.ts";
import { runReconciliation } from "../src/models/reconciliation.ts";
import type { Check } from "../src/models/reconciliation.ts";

// A reconciliation that cannot fail is worth nothing. Each check here is handed exactly the
// damage it exists to find, and is expected to find it — then the damage is rolled back.
//
// The checks return the rows that are WRONG, so an empty result is a pass. That makes a
// broken check indistinguishable from a sound database, which is the whole reason these
// tests inject faults rather than only asserting the happy path. The first version of this
// file found a real bug exactly that way: the checks read unqualified table names, so they
// resolved through search_path and reported a different schema clean.
//
// The damage is raw SQL for the same reason the checks are: Prisma's model operations are
// schema-scoped and raw ones are not, so every table is qualified explicitly.

const namespace = Prisma.raw(`"${apiSchema}"`);

let systemWalletId: bigint;
let adaWalletId: bigint;
let bodeWalletId: bigint;

async function createWallet(email: string, isSystem = false) {
  const user = await apiPrisma.user.create({
    data: {
      email,
      name: email,
      passwordHash: "$2b$12$notarealhashfortestsonly00000000000000000000000000000",
      role: "customer",
    },
  });
  const wallet = await apiPrisma.wallet.create({ data: { ownerId: user.id, isSystem } });
  return wallet.id;
}

type Damage = (client: Prisma.TransactionClient) => Promise<void>;

// Applies the damage, runs the checks, and always rolls back, so every case starts from the
// same sound fixture.
async function reconcileWithDamage(damage?: Damage) {
  const rollback = new Error("rollback");
  let checks: Check[] = [];

  await apiPrisma
    .$transaction(
      async (client) => {
        if (damage) await damage(client);
        checks = await runReconciliation(client, apiSchema);
        throw rollback;
      },
      { maxWait: 20_000, timeout: 40_000 },
    )
    .catch((error) => {
      if (error !== rollback) throw error;
    });

  return checks;
}

const failing = (checks: Check[]) =>
  checks.filter((check) => check.rows.length > 0).map((check) => check.name);

async function transferIdOf(client: Prisma.TransactionClient, reference: string) {
  const rows = await client.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM ${namespace}.transfers WHERE reference = ${reference}
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`No fixture transfer ${reference}`);
  return id;
}

beforeAll(async () => {
  await prepareApiDatabase();

  systemWalletId = await createWallet("system@example.com", true);
  adaWalletId = await createWallet("ada@example.com");
  bodeWalletId = await createWallet("bode@example.com");

  // A sound starting point, built the way the service builds one.
  await fundWallet(adaWalletId, systemWalletId, 500000n, "fixture-ada");
  await fundWallet(bodeWalletId, systemWalletId, 250000n, "fixture-bode");
  await fundWallet(bodeWalletId, adaWalletId, 1000n, "fixture-ada-to-bode");
});

afterAll(async () => {
  await closeApiDatabase();
});

describe("reconciliation on a sound database", () => {
  it("passes every check", async () => {
    const checks = await reconcileWithDamage();

    expect(checks).toHaveLength(6);
    expect(failing(checks)).toEqual([]);
  });
});

describe("reconciliation finds the damage each check exists for", () => {
  it("sees a balance its ledger entries do not add up to", async () => {
    const checks = await reconcileWithDamage(async (client) => {
      await client.$executeRaw`
        UPDATE ${namespace}.wallets SET balance_minor = balance_minor + 1 WHERE id = ${adaWalletId}
      `;
    });

    expect(failing(checks)).toContain("balances match the ledger");
    // Money appearing from nowhere also breaks the system-wide total.
    expect(failing(checks)).toContain("the system balances to zero overall");
  });

  it("sees a transfer with an entry missing", async () => {
    const checks = await reconcileWithDamage(async (client) => {
      const transferId = await transferIdOf(client, "fixture-ada");
      await client.$executeRaw`
        DELETE FROM ${namespace}.ledger_entries
         WHERE transfer_id = ${transferId} AND entry_type = 'credit'
      `;
    });

    expect(failing(checks)).toContain("every transfer has one debit and one credit");
  });

  it("sees a pair that does not cancel", async () => {
    const checks = await reconcileWithDamage(async (client) => {
      const transferId = await transferIdOf(client, "fixture-bode");
      // Still one debit and one credit, and the debit stays negative so
      // ledger_sign_matches_type is satisfied. Only the cancelling check can catch this.
      await client.$executeRaw`
        UPDATE ${namespace}.ledger_entries SET amount_minor = amount_minor - 5
         WHERE transfer_id = ${transferId} AND entry_type = 'debit'
      `;
    });

    expect(failing(checks)).toContain("each pair sums to zero and matches its transfer");
  });

  it("sees an entry attributed to a wallet its transfer never touched", async () => {
    const checks = await reconcileWithDamage(async (client) => {
      const transferId = await transferIdOf(client, "fixture-ada");
      await client.$executeRaw`
        UPDATE ${namespace}.ledger_entries SET wallet_id = ${bodeWalletId}
         WHERE transfer_id = ${transferId} AND entry_type = 'credit'
      `;
    });

    expect(failing(checks)).toContain("entries match their transfer's wallets and currency");
  });

  it("sees a negative customer balance once the constraint stops refusing it", async () => {
    const checks = await reconcileWithDamage(async (client) => {
      // The damage is impossible while wallets_balance_non_negative exists — which is the
      // point of having it. Dropping it inside a transaction that is rolled back is the only
      // way to prove the check would catch a negative balance if the constraint were ever
      // removed. ALTER TABLE is transactional in PostgreSQL, so the constraint comes back.
      await client.$executeRaw`
        ALTER TABLE ${namespace}.wallets DROP CONSTRAINT wallets_balance_non_negative
      `;
      await client.$executeRaw`
        UPDATE ${namespace}.wallets SET balance_minor = -1 WHERE id = ${adaWalletId}
      `;
    });

    expect(failing(checks)).toContain("no customer wallet is negative");
  });

  it("sees money that was never moved out of the funding wallet", async () => {
    const checks = await reconcileWithDamage(async (client) => {
      // A balanced pair of entries, but only the receiving balance moves, so the money came
      // from nowhere. Only the system-wide total catches this.
      await client.$executeRaw`
        UPDATE ${namespace}.wallets SET balance_minor = balance_minor + 999 WHERE id = ${adaWalletId}
      `;
      const transferId = await transferIdOf(client, "fixture-ada");
      await client.$executeRaw`
        UPDATE ${namespace}.ledger_entries SET amount_minor = amount_minor + 999
         WHERE transfer_id = ${transferId} AND entry_type = 'credit'
      `;
    });

    expect(failing(checks)).toContain("the system balances to zero overall");
  });

  it("restores the constraint and the data after every injected fault", async () => {
    // Every case above rolled back, including the dropped constraint. If one had not, this
    // would fail.
    const checks = await reconcileWithDamage();
    expect(failing(checks)).toEqual([]);

    const constraints = await apiPrisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
       WHERE conname = 'wallets_balance_non_negative'
         AND connamespace = ${apiSchema}::regnamespace
    `;
    expect(constraints).toHaveLength(1);
  });
});
