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
    await client.query("BEGIN");
    const { funded } = await applySeed(client);
    await client.query("COMMIT");

    console.log(
      funded.length === 0
        ? "Seed already applied. No balances changed."
        : `Funded ${funded.length} wallet(s): ${funded.join(", ")}`,
    );

    await reportState(client);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

runSeed().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
