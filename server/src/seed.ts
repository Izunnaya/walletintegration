import dotenv from "dotenv";

dotenv.config();

// Applies the demo data in one transaction, then prints the result.
//
// Never called on startup. npm run seed, deliberately, once. Running it again is safe and
// changes nothing, which the test in tests/seed.test.ts proves.

const runSeed = async () => {
  const { pool } = await import("./models/db.ts");
  const { applySeed, reportState } = await import("./models/seedData.ts");
  const client = await pool.connect();

  try {
    let funded: string[];

    try {
      await client.query("BEGIN");
      const seedResult = await applySeed(client);
      funded = seedResult.funded;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    try {
      await client.query("COMMIT");
    } catch (error) {
      throw new Error(
        "Seed commit was not acknowledged. The outcome may be unknown; rerun the seed to confirm without funding twice.",
        { cause: error },
      );
    }

    try {
      console.log(
        funded.length === 0
          ? "Seed already applied. No balances changed."
          : `Funded ${funded.length} wallet(s): ${funded.join(", ")}`,
      );

      await reportState(client);
    } catch (error) {
      throw new Error(
        "Seed committed, but reporting failed. The seed changes are saved; rerun the seed to print the report without funding twice.",
        { cause: error },
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
};

await runSeed().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
