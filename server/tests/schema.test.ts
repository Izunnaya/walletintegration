import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../src/models/db.ts";

// These run against a real PostgreSQL. A mocked database cannot prove a constraint exists,
// so a test that mocked one would prove nothing at all.
//
// Every test runs inside a transaction that is rolled back, so the database is left exactly
// as it was found and the tests can run in any order, repeatedly.
//
// What this file establishes: the invariants hold at the database level. Even with a bug in
// the application, Postgres refuses to store the forbidden state.

afterAll(async () => {
  await pool.end();
});

async function inRolledBackTransaction(work: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await work(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

// Postgres names the constraint it refused on, so the assertion names it too. A test that
// only checked "it threw" would pass if the insert failed for an unrelated reason.
async function expectRefusedBy(
  client: PoolClient,
  constraint: string,
  sql: string,
  params: unknown[] = [],
) {
  // A failed statement poisons the transaction, so each attempt gets a savepoint.
  await client.query("SAVEPOINT attempt");

  let error: { constraint?: string; code?: string } | null = null;
  try {
    await client.query(sql, params);
  } catch (caught) {
    error = caught as { constraint?: string; code?: string };
  }

  await client.query("ROLLBACK TO SAVEPOINT attempt");

  expect(error, `expected the insert to be refused by ${constraint}`).not.toBeNull();
  expect(error?.constraint).toBe(constraint);
}

async function createUser(client: PoolClient, email: string, role = "customer") {
  const result = await client.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, 'not-a-real-hash', 'Test Person', $2)
     RETURNING id`,
    [email, role],
  );
  return result.rows[0]!.id;
}

async function createWallet(client: PoolClient, ownerId: string, balanceMinor = "0") {
  const result = await client.query<{ id: string }>(
    `INSERT INTO wallets (owner_id, balance_minor) VALUES ($1, $2) RETURNING id`,
    [ownerId, balanceMinor],
  );
  return result.rows[0]!.id;
}

describe("wallets", () => {
  it("refuses a negative balance on a customer wallet", async () => {
    await inRolledBackTransaction(async (client) => {
      const ownerId = await createUser(client, "negative@example.com");

      // Invariant 1, enforced by Postgres rather than by application code.
      await expectRefusedBy(
        client,
        "wallets_balance_non_negative",
        `INSERT INTO wallets (owner_id, balance_minor) VALUES ($1, -1)`,
        [ownerId],
      );
    });
  });

  it("allows the system wallet to go negative, which is the documented exception", async () => {
    await inRolledBackTransaction(async (client) => {
      const ownerId = await createUser(client, "system@example.com");

      const result = await client.query<{ balance_minor: string }>(
        `INSERT INTO wallets (owner_id, balance_minor, is_system)
         VALUES ($1, -500000, TRUE) RETURNING balance_minor`,
        [ownerId],
      );

      expect(result.rows[0]?.balance_minor).toBe("-500000");
    });
  });

  it("refuses a second system wallet, so the exception cannot be reached twice", async () => {
    await inRolledBackTransaction(async (client) => {
      const firstOwner = await createUser(client, "sys-one@example.com");
      const secondOwner = await createUser(client, "sys-two@example.com");

      await client.query(
        `INSERT INTO wallets (owner_id, is_system) VALUES ($1, TRUE)`,
        [firstOwner],
      );

      await expectRefusedBy(
        client,
        "wallets_single_system",
        `INSERT INTO wallets (owner_id, is_system) VALUES ($1, TRUE)`,
        [secondOwner],
      );
    });
  });

  it("refuses two wallets for the same owner and currency", async () => {
    await inRolledBackTransaction(async (client) => {
      const ownerId = await createUser(client, "twice@example.com");
      await createWallet(client, ownerId);

      await expectRefusedBy(
        client,
        "wallets_one_per_owner_currency",
        `INSERT INTO wallets (owner_id) VALUES ($1)`,
        [ownerId],
      );
    });
  });

  it("refuses a currency other than NGN", async () => {
    await inRolledBackTransaction(async (client) => {
      const ownerId = await createUser(client, "usd@example.com");

      await expectRefusedBy(
        client,
        "wallets_currency_valid",
        `INSERT INTO wallets (owner_id, currency) VALUES ($1, 'USD')`,
        [ownerId],
      );
    });
  });
});

describe("users", () => {
  it("refuses an email that is not trimmed and lowercased", async () => {
    await inRolledBackTransaction(async (client) => {
      // The normalisation rule is in the database, so users and blacklist_entries cannot
      // disagree about what an email is.
      await expectRefusedBy(
        client,
        "users_email_normalised",
        `INSERT INTO users (email, password_hash, name) VALUES (' Ada@Example.COM ', 'h', 'Ada')`,
      );
    });
  });

  it("refuses a duplicate email", async () => {
    await inRolledBackTransaction(async (client) => {
      await createUser(client, "dup@example.com");

      await expectRefusedBy(
        client,
        "users_email_key",
        `INSERT INTO users (email, password_hash, name) VALUES ('dup@example.com', 'h', 'Other')`,
      );
    });
  });

  it("refuses a role outside customer and admin", async () => {
    await inRolledBackTransaction(async (client) => {
      await expectRefusedBy(
        client,
        "users_role_valid",
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ('root@example.com', 'h', 'Root', 'superuser')`,
      );
    });
  });
});

describe("transfers", () => {
  it("refuses a transfer to the same wallet", async () => {
    await inRolledBackTransaction(async (client) => {
      const ownerId = await createUser(client, "same@example.com");
      const walletId = await createWallet(client, ownerId, "100000");

      await expectRefusedBy(
        client,
        "transfers_distinct_wallets",
        `INSERT INTO transfers (reference, source_wallet_id, destination_wallet_id, amount_minor)
         VALUES ('ref-same', $1, $1, 1000)`,
        [walletId],
      );
    });
  });

  it("refuses a zero or negative amount", async () => {
    await inRolledBackTransaction(async (client) => {
      const a = await createUser(client, "a@example.com");
      const b = await createUser(client, "b@example.com");
      const walletA = await createWallet(client, a, "100000");
      const walletB = await createWallet(client, b);

      for (const amount of [0, -1]) {
        await expectRefusedBy(
          client,
          "transfers_amount_positive",
          `INSERT INTO transfers (reference, source_wallet_id, destination_wallet_id, amount_minor)
           VALUES ($1, $2, $3, $4)`,
          [`ref-${amount}`, walletA, walletB, amount],
        );
      }
    });
  });

  it("refuses a duplicate reference", async () => {
    await inRolledBackTransaction(async (client) => {
      const a = await createUser(client, "ref-a@example.com");
      const b = await createUser(client, "ref-b@example.com");
      const walletA = await createWallet(client, a, "100000");
      const walletB = await createWallet(client, b);

      await client.query(
        `INSERT INTO transfers (reference, source_wallet_id, destination_wallet_id, amount_minor)
         VALUES ('ref-once', $1, $2, 1000)`,
        [walletA, walletB],
      );

      await expectRefusedBy(
        client,
        "transfers_reference_key",
        `INSERT INTO transfers (reference, source_wallet_id, destination_wallet_id, amount_minor)
         VALUES ('ref-once', $1, $2, 2000)`,
        [walletA, walletB],
      );
    });
  });
});

describe("ledger entries", () => {
  async function seedTransfer(client: PoolClient, suffix: string) {
    const a = await createUser(client, `led-a-${suffix}@example.com`);
    const b = await createUser(client, `led-b-${suffix}@example.com`);
    const walletA = await createWallet(client, a, "100000");
    const walletB = await createWallet(client, b);

    const transfer = await client.query<{ id: string }>(
      `INSERT INTO transfers (reference, source_wallet_id, destination_wallet_id, amount_minor)
       VALUES ($1, $2, $3, 1000) RETURNING id`,
      [`ref-${suffix}`, walletA, walletB],
    );

    return { transferId: transfer.rows[0]!.id, walletA, walletB };
  }

  it("refuses a third entry on a transfer", async () => {
    await inRolledBackTransaction(async (client) => {
      const { transferId, walletA, walletB } = await seedTransfer(client, "third");

      await client.query(
        `INSERT INTO ledger_entries (transfer_id, wallet_id, entry_type, amount_minor)
         VALUES ($1, $2, 'debit', -1000), ($1, $3, 'credit', 1000)`,
        [transferId, walletA, walletB],
      );

      // One debit slot and one credit slot per transfer, enforced by a unique index.
      await expectRefusedBy(
        client,
        "ledger_one_per_transfer_type",
        `INSERT INTO ledger_entries (transfer_id, wallet_id, entry_type, amount_minor)
         VALUES ($1, $2, 'debit', -1000)`,
        [transferId, walletA],
      );
    });
  });

  it("refuses a debit stored as a positive amount", async () => {
    await inRolledBackTransaction(async (client) => {
      const { transferId, walletA } = await seedTransfer(client, "sign-debit");

      // Debits are negative and credits positive, which is what makes a balance the plain
      // SUM of its entries and "the pair sums to zero" structural.
      await expectRefusedBy(
        client,
        "ledger_sign_matches_type",
        `INSERT INTO ledger_entries (transfer_id, wallet_id, entry_type, amount_minor)
         VALUES ($1, $2, 'debit', 1000)`,
        [transferId, walletA],
      );
    });
  });

  it("refuses a credit stored as a negative amount", async () => {
    await inRolledBackTransaction(async (client) => {
      const { transferId, walletB } = await seedTransfer(client, "sign-credit");

      await expectRefusedBy(
        client,
        "ledger_sign_matches_type",
        `INSERT INTO ledger_entries (transfer_id, wallet_id, entry_type, amount_minor)
         VALUES ($1, $2, 'credit', -1000)`,
        [transferId, walletB],
      );
    });
  });

  it("refuses an entry type that is neither debit nor credit", async () => {
    await inRolledBackTransaction(async (client) => {
      const { transferId, walletA } = await seedTransfer(client, "bad-type");

      await expectRefusedBy(
        client,
        "ledger_entry_type_valid",
        `INSERT INTO ledger_entries (transfer_id, wallet_id, entry_type, amount_minor)
         VALUES ($1, $2, 'adjustment', -1000)`,
        [transferId, walletA],
      );
    });
  });

  it("makes a balanced pair sum to zero", async () => {
    await inRolledBackTransaction(async (client) => {
      const { transferId, walletA, walletB } = await seedTransfer(client, "sums");

      await client.query(
        `INSERT INTO ledger_entries (transfer_id, wallet_id, entry_type, amount_minor)
         VALUES ($1, $2, 'debit', -1000), ($1, $3, 'credit', 1000)`,
        [transferId, walletA, walletB],
      );

      const total = await client.query<{ sum: string | null }>(
        `SELECT SUM(amount_minor)::text AS sum FROM ledger_entries WHERE transfer_id = $1`,
        [transferId],
      );

      expect(total.rows[0]?.sum).toBe("0");
    });
  });
});

describe("idempotency records", () => {
  it("refuses the same key twice for one user and operation", async () => {
    await inRolledBackTransaction(async (client) => {
      const userId = await createUser(client, "idem@example.com");
      const a = await createUser(client, "idem-a@example.com");
      const walletA = await createWallet(client, a, "100000");
      const b = await createUser(client, "idem-b@example.com");
      const walletB = await createWallet(client, b);

      const transfer = await client.query<{ id: string }>(
        `INSERT INTO transfers (reference, source_wallet_id, destination_wallet_id, amount_minor)
         VALUES ('ref-idem', $1, $2, 1000) RETURNING id`,
        [walletA, walletB],
      );

      await client.query(
        `INSERT INTO idempotency_records
           (user_id, operation, idempotency_key, request_fingerprint, status,
            response_status_code, response_body, transfer_id)
         VALUES ($1, 'transfer', 'key-1', 'fp', 'succeeded', 201, '{}'::jsonb, $2)`,
        [userId, transfer.rows[0]!.id],
      );

      // This index is what makes two concurrent duplicates safe: the second insert waits
      // on it until the first transaction settles.
      await expectRefusedBy(
        client,
        "idempotency_unique_per_user_operation",
        `INSERT INTO idempotency_records
           (user_id, operation, idempotency_key, request_fingerprint, status,
            response_status_code, response_body)
         VALUES ($1, 'transfer', 'key-1', 'fp', 'rejected', 422, '{}'::jsonb)`,
        [userId],
      );
    });
  });

  it("refuses a success with no transfer attached", async () => {
    await inRolledBackTransaction(async (client) => {
      const userId = await createUser(client, "idem-nos@example.com");

      await expectRefusedBy(
        client,
        "idempotency_transfer_matches_status",
        `INSERT INTO idempotency_records
           (user_id, operation, idempotency_key, request_fingerprint, status,
            response_status_code, response_body)
         VALUES ($1, 'transfer', 'key-2', 'fp', 'succeeded', 201, '{}'::jsonb)`,
        [userId],
      );
    });
  });

  it("refuses a rejection that points at a transfer, because it moved no money", async () => {
    await inRolledBackTransaction(async (client) => {
      const userId = await createUser(client, "idem-rej@example.com");
      const a = await createUser(client, "idem-rej-a@example.com");
      const walletA = await createWallet(client, a, "100000");
      const b = await createUser(client, "idem-rej-b@example.com");
      const walletB = await createWallet(client, b);

      const transfer = await client.query<{ id: string }>(
        `INSERT INTO transfers (reference, source_wallet_id, destination_wallet_id, amount_minor)
         VALUES ('ref-rej', $1, $2, 1000) RETURNING id`,
        [walletA, walletB],
      );

      await expectRefusedBy(
        client,
        "idempotency_transfer_matches_status",
        `INSERT INTO idempotency_records
           (user_id, operation, idempotency_key, request_fingerprint, status,
            response_status_code, response_body, transfer_id)
         VALUES ($1, 'transfer', 'key-3', 'fp', 'rejected', 422, '{}'::jsonb, $2)`,
        [userId, transfer.rows[0]!.id],
      );
    });
  });
});

describe("blacklist entries", () => {
  it("refuses an email that is not normalised", async () => {
    await inRolledBackTransaction(async (client) => {
      await expectRefusedBy(
        client,
        "blacklist_email_normalised",
        `INSERT INTO blacklist_entries (email, reason) VALUES ('Fraud@Example.COM', 'test')`,
      );
    });
  });
});

describe("admin audit entries", () => {
  it("refuses an action other than block or unblock", async () => {
    await inRolledBackTransaction(async (client) => {
      const actor = await createUser(client, "admin@example.com", "admin");
      const affected = await createUser(client, "affected@example.com");

      await expectRefusedBy(
        client,
        "audit_action_valid",
        `INSERT INTO admin_audit_entries (actor_user_id, affected_user_id, action)
         VALUES ($1, $2, 'delete')`,
        [actor, affected],
      );
    });
  });
});
