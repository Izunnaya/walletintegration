import "dotenv/config";

// npm run reconcile — the closing-time till count.
//
// It proves the books are internally consistent: that every balance is backed by ledger
// history, that every transfer moved equal and opposite amounts, and that no customer wallet
// is negative.
//
// What it cannot prove is that no transfer ran twice. A duplicated transfer balances
// perfectly — two transfers, four entries, every sum correct. Idempotency is what prevents
// that, and this command does not check it. Saying so matters: a passing reconciliation is
// not a statement that nothing was double-spent.
//
// Every check runs inside ONE read-only REPEATABLE READ transaction, so all of them see the
// same instant. Run separately, a transfer committing between two checks would make them
// disagree and report a discrepancy that never existed.

type Check = {
  name: string;
  detail: string;
  rows: unknown[];
};

const run = async () => {
  const { prisma } = await import("./models/db.ts");

  try {
    const checks = await prisma.$transaction(
      async (client): Promise<Check[]> => {
        const results: Check[] = [];

        // 1. Every wallet balance equals the sum of its signed ledger entries.
        results.push({
          name: "balances match the ledger",
          detail: "a balance with no entries behind it, or entries that do not add up to it",
          rows: await client.$queryRaw`
            SELECT w.id::text AS wallet_id,
                   w.balance_minor::text AS balance_minor,
                   COALESCE(SUM(l.amount_minor), 0)::text AS ledger_total
              FROM wallets w
              LEFT JOIN ledger_entries l ON l.wallet_id = w.id
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
              FROM transfers t
              LEFT JOIN ledger_entries l ON l.transfer_id = t.id
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
              FROM transfers t
              JOIN ledger_entries l ON l.transfer_id = t.id
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
              FROM ledger_entries l
              JOIN transfers t ON t.id = l.transfer_id
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
              FROM wallets
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
              FROM wallets
            HAVING SUM(balance_minor) <> 0
          `,
        });

        return results;
      },
      {
        isolationLevel: "RepeatableRead",
        maxWait: 20_000,
        timeout: 60_000,
      },
    );

    let failed = 0;

    for (const check of checks) {
      const count = check.rows.length;
      if (count === 0) {
        console.log(`  ok        ${check.name}`);
        continue;
      }

      failed += 1;
      console.log(`  FAILED    ${check.name}`);
      console.log(`            ${count} row(s): ${check.detail}`);
      for (const row of check.rows.slice(0, 5)) {
        console.log(`            ${JSON.stringify(row)}`);
      }
    }

    console.log("");

    if (failed > 0) {
      console.log(`${failed} of ${checks.length} checks failed. The books do not balance.`);
      process.exitCode = 1;
      return;
    }

    console.log(`All ${checks.length} checks passed. The books balance.`);
    console.log("This does not prove no transfer ran twice — idempotency does that, not this.");
  } finally {
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
