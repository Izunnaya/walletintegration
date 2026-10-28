import { Prisma } from "../generated/prisma/client.ts";

// The reconciliation checks themselves. They take a transaction client and never open one,
// so the caller owns the boundary - the command wraps them in a read-only REPEATABLE READ
// transaction, and the tests point them at a schema of their own.
//
// Each check returns the rows that are WRONG. An empty array is a pass, which means a check
// that cannot find anything is indistinguishable from a check that is broken - so the tests
// inject each kind of damage and confirm it is seen.

export type Check = {
  name: string;
  detail: string;
  rows: unknown[];
};

// The schema is passed in rather than read from configuration, because these are raw queries
// and a raw query resolves an unqualified table name through search_path. Prisma's model
// operations are schema-scoped and raw ones are not, so without qualifying every table this
// reads whichever schema the connection happens to point at - which on a deployment with a
// non-default schema means reconciling the wrong database and reporting it clean.
export async function runReconciliation(
  client: Prisma.TransactionClient,
  schema: string,
): Promise<Check[]> {
  // An identifier cannot be a query parameter. This is configuration, never request input.
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid database schema");
  const namespace = Prisma.raw(`"${schema}"`);

        const results: Check[] = [];

        // 1. Every wallet balance equals the sum of its signed ledger entries.
        results.push({
          name: "balances match the ledger",
          detail: "a balance with no entries behind it, or entries that do not add up to it",
          rows: await client.$queryRaw`
            SELECT w.id::text AS wallet_id,
                   w.balance_minor::text AS balance_minor,
                   COALESCE(SUM(l.amount_minor), 0)::text AS ledger_total
              FROM ${namespace}.wallets w
              LEFT JOIN ${namespace}.ledger_entries l ON l.wallet_id = w.id
             GROUP BY w.id, w.balance_minor
            HAVING w.balance_minor <> COALESCE(SUM(l.amount_minor), 0)
          `,
        });

        // 2. Every transfer has exactly one debit and exactly one credit.
        results.push({
          name: "every transfer has one debit and one credit",
          detail: "a transfer with a missing, extra or duplicated entry",
          rows: await client.$queryRaw`
            SELECT t.id::text AS transfer_id,
                   COUNT(l.id)::text AS entries,
                   COUNT(*) FILTER (WHERE l.entry_type = 'debit')::text AS debits,
                   COUNT(*) FILTER (WHERE l.entry_type = 'credit')::text AS credits
              FROM ${namespace}.transfers t
              LEFT JOIN ${namespace}.ledger_entries l ON l.transfer_id = t.id
             GROUP BY t.id
            HAVING COUNT(l.id) <> 2
                OR COUNT(*) FILTER (WHERE l.entry_type = 'debit') <> 1
                OR COUNT(*) FILTER (WHERE l.entry_type = 'credit') <> 1
          `,
        });

        // 3. Each pair sums to zero, and its amounts match the transfer's own amount.
        results.push({
          name: "each pair sums to zero and matches its transfer",
          detail: "a transfer whose entries do not cancel, or disagree with its amount",
          rows: await client.$queryRaw`
            SELECT t.id::text AS transfer_id,
                   t.amount_minor::text AS transfer_amount,
                   SUM(l.amount_minor)::text AS entry_sum
              FROM ${namespace}.transfers t
              JOIN ${namespace}.ledger_entries l ON l.transfer_id = t.id
             GROUP BY t.id, t.amount_minor
            HAVING SUM(l.amount_minor) <> 0
                OR MAX(ABS(l.amount_minor)) <> t.amount_minor
                OR MIN(ABS(l.amount_minor)) <> t.amount_minor
          `,
        });

        // 4. Entries sit on the wallets and currency their transfer names.
        results.push({
          name: "entries match their transfer's wallets and currency",
          detail: "an entry attributed to a wallet the transfer never touched",
          rows: await client.$queryRaw`
            SELECT l.id::text AS entry_id, l.transfer_id::text AS transfer_id
              FROM ${namespace}.ledger_entries l
              JOIN ${namespace}.transfers t ON t.id = l.transfer_id
             WHERE l.currency <> t.currency
                OR (l.entry_type = 'debit' AND l.wallet_id <> t.source_wallet_id)
                OR (l.entry_type = 'credit' AND l.wallet_id <> t.destination_wallet_id)
          `,
        });

        // 5. No customer wallet is negative. The database already refuses this through
        //    wallets_balance_non_negative; checking anyway costs nothing and would catch a
        //    constraint that had been dropped.
        results.push({
          name: "no customer wallet is negative",
          detail: "a customer balance below zero",
          rows: await client.$queryRaw`
            SELECT id::text AS wallet_id, balance_minor::text AS balance_minor
              FROM ${namespace}.wallets
             WHERE is_system = FALSE AND balance_minor < 0
          `,
        });

        // 6. The money in the system still sums to zero: what the customers hold is exactly
        //    what the system wallet is down. Nothing was created outside a transfer.
        results.push({
          name: "the system balances to zero overall",
          detail: "money that exists without having been moved from the funding wallet",
          rows: await client.$queryRaw`
            SELECT SUM(balance_minor)::text AS total
              FROM ${namespace}.wallets
            HAVING SUM(balance_minor) <> 0
          `,
        });

        return results;
}
