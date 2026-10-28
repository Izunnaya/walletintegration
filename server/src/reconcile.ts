import "dotenv/config";

// npm run reconcile - the closing-time till count.
//
// Every check runs inside ONE read-only REPEATABLE READ transaction, so all of them see the
// same instant. Run separately, a transfer committing between two checks would make them
// disagree and report a discrepancy that never existed.
//
// What it cannot prove is that no transfer ran twice. A duplicated transfer balances
// perfectly - two transfers, four entries, every sum correct. Idempotency prevents that, and
// this command does not check it.
//
// The output stays console.log rather than going through pino, deliberately. The service
// logs JSON because a log aggregator has to filter it; this is a report an operator reads at
// a terminal, and an aligned table of balances is the readable form. Wrapping it in JSON
// would make the one audience it has worse off. The same applies to seed and admin:password.

const run = async () => {
  const { prisma, databaseSchema } = await import("./models/db.ts");
  const { runReconciliation } = await import("./models/reconciliation.ts");

  try {
    const checks = await prisma.$transaction((client) => runReconciliation(client, databaseSchema), {
      isolationLevel: "RepeatableRead",
      maxWait: 20_000,
      timeout: 60_000,
    });

    let failed = 0;

    for (const check of checks) {
      if (check.rows.length === 0) {
        console.log(`  ok        ${check.name}`);
        continue;
      }

      failed += 1;
      console.log(`  FAILED    ${check.name}`);
      console.log(`            ${check.rows.length} row(s): ${check.detail}`);
      for (const row of check.rows.slice(0, 5)) console.log(`            ${JSON.stringify(row)}`);
    }

    console.log("");

    if (failed > 0) {
      console.log(`${failed} of ${checks.length} checks failed. The books do not balance.`);
      process.exitCode = 1;
      return;
    }

    console.log(`All ${checks.length} checks passed. The books balance.`);
    console.log("This does not prove no transfer ran twice - idempotency does that, not this.");
  } finally {
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
