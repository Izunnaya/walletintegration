import "dotenv/config";

const runSeed = async () => {
  const { prisma, databaseSchema } = await import("./models/db.ts");
  const { applySeed, reportState } = await import("./models/seedData.ts");

  try {
    let funded: string[];
    try {
      const result = await prisma.$transaction(
        (transaction) => applySeed(transaction),
        { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 30000 },
      );
      funded = result.funded;
    } catch (error) {
      throw new Error(
        "Seed transaction did not complete successfully. If commit acknowledgement was lost, the outcome may be unknown. Rerun the repeatable seed to confirm without funding twice.",
        { cause: error },
      );
    }

    try {
      console.log(funded.length === 0
        ? "Seed already applied. No balances changed."
        : `Funded ${funded.length} wallet(s): ${funded.join(", ")}`);
      await reportState(prisma, databaseSchema);
    } catch (error) {
      throw new Error(
        "Seed committed, but reporting failed. The seed changes are saved; rerun the seed to print the report without funding twice.",
        { cause: error },
      );
    }
  } finally {
    await prisma.$disconnect();
  }
};

await runSeed().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
