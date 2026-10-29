import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../src/generated/prisma/client.ts";
import { apiPrisma, apiSchema, prepareApiDatabase, closeApiDatabase, fundWallet } from "./apiDatabase.ts";
import { runReconciliation } from "../src/models/reconciliation.ts";
import type { Check } from "../src/models/reconciliation.ts";

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

async function reconcileWithDamage(damage?: Damage) {
  const rollback = new Error("rollback");
  let checks: Check[] = [];

  await apiPrisma
    .$transaction(
      async (client) => {
        if (damage) {
          // Only these fault-injection tests bypass history protection; rollback restores it.
          await client.$executeRaw`ALTER TABLE ${namespace}.transfers DISABLE TRIGGER transfers_immutable`;
          await client.$executeRaw`ALTER TABLE ${namespace}.ledger_entries DISABLE TRIGGER ledger_entries_immutable`;
          await damage(client);
        }
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

const failing = (checks: Check[]) => checks.filter((check) => check.rows.length > 0).map((check) => check.name);

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

  await fundWallet(adaWalletId, systemWalletId, 500000n, "fixture-ada");
  await fundWallet(bodeWalletId, systemWalletId, 250000n, "fixture-bode");
  await fundWallet(bodeWalletId, adaWalletId, 1000n, "fixture-ada-to-bode");
});

afterAll(async () => {
  await closeApiDatabase();
});

describe("the checks still find the damage they exist for", () => {
  it("passes on a sound database", async () => {
    const checks = await reconcileWithDamage();
    expect(checks.map((check) => check.name)).toEqual([
      "balances match the ledger",
      "every transfer has one debit and one credit",
      "each pair sums to zero and matches its transfer",
      "entries match their transfer's wallets and currency",
      "no customer wallet is negative",
      "the system balances to zero overall",
      "stored idempotent answers match their transfers",
    ]);
    expect(failing(checks)).toEqual([]);
  });

  it("still catches a kobo added to a balance, on this fixture too", async () => {
    const checks = await reconcileWithDamage(async (client) => {
      await client.$executeRaw`
        UPDATE ${namespace}.wallets SET balance_minor = balance_minor + 1 WHERE id = ${adaWalletId}
      `;
    });
    expect(failing(checks)).toContain("balances match the ledger");
    expect(failing(checks)).toContain("the system balances to zero overall");
  });
});

describe("damage reconciliation cannot see after a database owner bypasses history protection", () => {
  it("does not see a committed transfer rewritten to a different amount", async () => {
    const checks = await reconcileWithDamage(async (client) => {
      const transferId = await transferIdOf(client, "fixture-ada-to-bode");
      const extra = 900n;
      await client.$executeRaw`
        UPDATE ${namespace}.transfers SET amount_minor = amount_minor + ${extra} WHERE id = ${transferId}
      `;
      await client.$executeRaw`
        UPDATE ${namespace}.ledger_entries SET amount_minor = amount_minor - ${extra}
         WHERE transfer_id = ${transferId} AND entry_type = 'debit'
      `;
      await client.$executeRaw`
        UPDATE ${namespace}.ledger_entries SET amount_minor = amount_minor + ${extra}
         WHERE transfer_id = ${transferId} AND entry_type = 'credit'
      `;
      await client.$executeRaw`
        UPDATE ${namespace}.wallets SET balance_minor = balance_minor - ${extra} WHERE id = ${adaWalletId}
      `;
      await client.$executeRaw`
        UPDATE ${namespace}.wallets SET balance_minor = balance_minor + ${extra} WHERE id = ${bodeWalletId}
      `;
    });

    // Recorded as the observed behaviour, not as the desired behaviour.
    expect(failing(checks)).toEqual([]);
  });

  it("does not see a committed transfer reversed in direction", async () => {
    const checks = await reconcileWithDamage(async (client) => {
      const transferId = await transferIdOf(client, "fixture-ada-to-bode");
      const amount = 1000n;
      await client.$executeRaw`
        UPDATE ${namespace}.transfers
           SET source_wallet_id = ${bodeWalletId}, destination_wallet_id = ${adaWalletId}
         WHERE id = ${transferId}
      `;
      await client.$executeRaw`
        UPDATE ${namespace}.ledger_entries SET wallet_id = ${bodeWalletId}
         WHERE transfer_id = ${transferId} AND entry_type = 'debit'
      `;
      await client.$executeRaw`
        UPDATE ${namespace}.ledger_entries SET wallet_id = ${adaWalletId}
         WHERE transfer_id = ${transferId} AND entry_type = 'credit'
      `;
      await client.$executeRaw`
        UPDATE ${namespace}.wallets SET balance_minor = balance_minor + ${2n * amount} WHERE id = ${adaWalletId}
      `;
      await client.$executeRaw`
        UPDATE ${namespace}.wallets SET balance_minor = balance_minor - ${2n * amount} WHERE id = ${bodeWalletId}
      `;
    });

    expect(failing(checks)).toEqual([]);
  });

  it("does not see a transfer and its entries deleted outright", async () => {
    const checks = await reconcileWithDamage(async (client) => {
      const transferId = await transferIdOf(client, "fixture-ada-to-bode");
      await client.$executeRaw`
        DELETE FROM ${namespace}.idempotency_records WHERE transfer_id = ${transferId}
      `;
      await client.$executeRaw`DELETE FROM ${namespace}.ledger_entries WHERE transfer_id = ${transferId}`;
      await client.$executeRaw`DELETE FROM ${namespace}.transfers WHERE id = ${transferId}`;
      await client.$executeRaw`
        UPDATE ${namespace}.wallets SET balance_minor = balance_minor + 1000 WHERE id = ${adaWalletId}
      `;
      await client.$executeRaw`
        UPDATE ${namespace}.wallets SET balance_minor = balance_minor - 1000 WHERE id = ${bodeWalletId}
      `;
    });

    expect(failing(checks)).toEqual([]);
  });

  it("catches a succeeded idempotency record whose stored answer is a lie", async () => {
    const lie = JSON.stringify({ transfer: { id: "1", amountMinor: "999999999", currency: "NGN" } });

    const checks = await reconcileWithDamage(async (client) => {
      const transferId = await transferIdOf(client, "fixture-ada-to-bode");
      await client.$executeRaw`
        INSERT INTO ${namespace}.idempotency_records
          (user_id, operation, idempotency_key, request_fingerprint, status,
           response_status_code, response_body, transfer_id)
        SELECT w.owner_id, 'POST /transfers', 'blind-spot-key', 'deadbeef', 'succeeded', 201,
               ${lie}::jsonb, ${transferId}
          FROM ${namespace}.wallets w WHERE w.id = ${adaWalletId}
      `;

      // Checked while the damage is still in place: the stored answer a retry would replay
      // names a figure a thousand times the transfer it points at, and the row is accepted.
      const stored = await client.$queryRaw<{ stored: string; actual: string }[]>`
        SELECT (r.response_body -> 'transfer' ->> 'amountMinor') AS stored,
               t.amount_minor::text AS actual
          FROM ${namespace}.idempotency_records r
          JOIN ${namespace}.transfers t ON t.id = r.transfer_id
         WHERE r.idempotency_key = 'blind-spot-key'
      `;
      expect(stored).toEqual([{ stored: "999999999", actual: "1000" }]);
    });

    expect(failing(checks)).toContain("stored idempotent answers match their transfers");
  });

  it("does not see a second wallet opened for a customer who already has one", async () => {
    const checks = await reconcileWithDamage(async (client) => {
      await client.$executeRaw`
        ALTER TABLE ${namespace}.wallets DROP CONSTRAINT wallets_one_per_owner_currency
      `;
      await client.$executeRaw`
        INSERT INTO ${namespace}.wallets (owner_id, currency, balance_minor, is_system)
        SELECT owner_id, currency, 0, FALSE FROM ${namespace}.wallets WHERE id = ${adaWalletId}
      `;
    });

    expect(failing(checks)).toEqual([]);
  });

  it("does not see a customer wallet relabelled as the system wallet", async () => {
    let refusal: unknown;
    await reconcileWithDamage(async (client) => {
      await client.$executeRaw`
        UPDATE ${namespace}.wallets SET is_system = TRUE WHERE id = ${adaWalletId}
      `;
    }).catch((error) => {
      refusal = error;
    });
    expect(String(refusal)).toMatch(/wallets_single_system|unique/i);

    const checks = await reconcileWithDamage(async (client) => {
      await client.$executeRaw`DROP INDEX ${namespace}.wallets_single_system`;
      const transferId = await transferIdOf(client, "fixture-ada");
      await client.$executeRaw`
        UPDATE ${namespace}.transfers SET amount_minor = 999 WHERE id = ${transferId}
      `;
      await client.$executeRaw`
        UPDATE ${namespace}.ledger_entries SET amount_minor = -999
         WHERE transfer_id = ${transferId} AND entry_type = 'debit'
      `;
      await client.$executeRaw`
        UPDATE ${namespace}.ledger_entries SET amount_minor = 999
         WHERE transfer_id = ${transferId} AND entry_type = 'credit'
      `;
      await client.$executeRaw`
        UPDATE ${namespace}.wallets SET balance_minor = balance_minor + 499001 WHERE id = ${systemWalletId}
      `;
      await client.$executeRaw`
        UPDATE ${namespace}.wallets SET is_system = TRUE, balance_minor = -1 WHERE id = ${adaWalletId}
      `;
    });

    // A customer is a kobo overdrawn and every check reports clean.
    expect(failing(checks)).toEqual([]);
  });
});

describe("the fixture survives every blind-spot case", () => {
  it("restores the data, the constraint and the index", async () => {
    const checks = await reconcileWithDamage();
    expect(failing(checks)).toEqual([]);

    const objects = await apiPrisma.$queryRaw<{ name: string }[]>`
      SELECT conname AS name FROM pg_constraint
       WHERE conname = 'wallets_one_per_owner_currency' AND connamespace = ${apiSchema}::regnamespace
      UNION ALL
      SELECT indexname AS name FROM pg_indexes
       WHERE schemaname = ${apiSchema} AND indexname = 'wallets_single_system'
    `;
    expect(objects.map((object) => object.name).sort()).toEqual([
      "wallets_one_per_owner_currency",
      "wallets_single_system",
    ]);

    // And the balances are the fixture's own again, so no case leaked a committed write.
    const ada = await apiPrisma.wallet.findUniqueOrThrow({ where: { id: adaWalletId } });
    expect(ada.balanceMinor).toBe(499000n);
  });
});
