import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../src/generated/prisma/client.ts";
import { apiPrisma, apiSchema, prepareApiDatabase, closeApiDatabase, fundWallet } from "./apiDatabase.ts";
import { runReconciliation } from "../src/models/reconciliation.ts";
import type { Check } from "../src/models/reconciliation.ts";

// reconciliation.test.ts hands each check the damage it exists for and watches it
// find it. This file asks the other half of the question: what damage gets through?
//
// That matters because these checks are the only evidence that the ledger is sound, and
// what they do not look at is not looked at by anything. Every case below is damage a
// reviewer would call fraud, applied with ordinary SQL, which reconciliation reports clean.
// None of these are bugs in the checks as written - they are the shape of the gap, recorded
// so the gap is a known one rather than an assumed absence.
//
// Same contract as the other reconciliation tests: damage goes in inside a transaction that
// is always rolled back, every table is qualified explicitly because a raw query resolves an
// unqualified name through search_path, and the fixture is rebuilt by the rollback.

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
  // Re-proved on this file's own fixture before anything is claimed about what the checks
  // miss. A check that only worked on the fixture in reconciliation.test.ts would show up
  // here, and a blind spot asserted against broken checks would mean nothing.
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

describe("damage the reconciliation does not see", () => {
  it("does not see a committed transfer rewritten to a different amount", async () => {
    // CONTRIBUTING says financial rows are never updated or deleted, and a correction is a
    // new compensating entry. Nothing in the database enforces that: there is no trigger, no
    // revoked UPDATE privilege and no append-only evidence such as a hash chain. So an
    // UPDATE that moves a transfer, both of its entries and both balances together leaves a
    // perfectly self-consistent ledger that says something different from what happened.
    //
    // This is the most important gap here. Reconciliation proves internal consistency; it
    // cannot prove that the history was not rewritten, because a rewrite that keeps every
    // identities true is indistinguishable from the truth.
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
    // The same rewrite in its nastiest form: the money is taken from the party who received
    // it and given to the party who sent it, by swapping the transfer's two wallet ids, the
    // two entries' wallet ids, and both balances. Every identity holds afterwards.
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
    // Deleting a transfer with its pair and unwinding both balances also keeps every
    // identities. The money goes back where it came from and the record that it ever moved
    // is gone - which is exactly the audit trail the ledger exists to be.
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
    // This one WAS a blind spot and is now check 7. It is kept here, flipped, because the
    // damage is the reason the check exists and this is the only place that applies it.
    //
    // The stored response body is what a retry replays byte for byte, so it is part of the
    // financial record: a caller who retries after a lost response is told this and will
    // reconcile their own books against it. Every other check passes while it is wrong,
    // because the ledger itself is perfectly consistent - the money moved correctly and
    // only the receipt lies.
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
    // wallets_one_per_owner_currency stops a second NGN wallet, so this needs the constraint
    // dropped inside the rolled-back transaction - the same technique reconciliation.test.ts
    // uses for the non-negative balance. The point is the same: if the constraint were ever
    // removed, nothing downstream would notice. A duplicate wallet splits a customer's money
    // across two balances, and GET /wallets/me returns one of them.
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
    // Check 5 exempts system wallets from the non-negative rule, and so does
    // wallets_balance_non_negative. Flipping the flag on a customer wallet would therefore
    // hide an overdraft from both - except that wallets_single_system, a partial unique
    // index, allows only one. That index is load-bearing for check 5 and nothing says so, so
    // this asserts first that the index is what refuses the relabelling.
    let refusal: unknown;
    await reconcileWithDamage(async (client) => {
      await client.$executeRaw`
        UPDATE ${namespace}.wallets SET is_system = TRUE WHERE id = ${adaWalletId}
      `;
    }).catch((error) => {
      refusal = error;
    });
    expect(String(refusal)).toMatch(/wallets_single_system|unique/i);

    // With the index gone, the overdraft is invisible: the constraint permits it because the
    // wallet claims to be a system wallet, and check 5 skips it for the same reason. The
    // funding transfer is rewritten alongside it so the other five checks have nothing to
    // say, which is what makes this a blind spot rather than a noisy failure.
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
