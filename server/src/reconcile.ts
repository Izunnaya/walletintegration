import "dotenv/config";

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
