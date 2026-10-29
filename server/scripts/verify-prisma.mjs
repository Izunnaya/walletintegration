import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import assert from "node:assert/strict";

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for isolated verification.");
const url = new URL(connectionString);
url.hostname = url.hostname.replace("-pooler", "");
for (const parameter of ["schema", "sslmode", "sslcert", "sslkey", "sslrootcert", "channel_binding", "options"]) {
  url.searchParams.delete(parameter);
}
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
const pool = new Pool({
  connectionString: url.toString(),
  ssl: isLocal ? false : { rejectUnauthorized: true },
  connectionTimeoutMillis: 10000,
});
const schema = `wallet_test_${randomUUID().replaceAll("-", "")}`;
const testUrl = new URL(url);
testUrl.searchParams.set("schema", schema);
testUrl.searchParams.set("options", `-c search_path=${schema}`);

function run(script, args, environment) {
  const result = spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Verification step failed: ${args.join(" ")}`);
}

let created = false;
try {
  // The generated identifier contains only a fixed prefix and UUID hex digits.
  await pool.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  const migrationEnvironment = {
    DATABASE_URL: testUrl.toString(),
    TEST_DATABASE_URL: testUrl.toString(),
    SEED_ADMIN_PASSWORD: randomUUID(),
  };
  run("node_modules/prisma/build/index.js", ["migrate", "deploy"], migrationEnvironment);
  run("node_modules/prisma/build/index.js", ["migrate", "deploy"], migrationEnvironment);
  run("node_modules/vitest/vitest.mjs", ["run", "--no-file-parallelism"], {
    ...migrationEnvironment,
  });

  // Exercise the compiled seed and its schema-qualified report before adopting old data.
  run("dist/seed.js", [], migrationEnvironment);
  const before = await pool.query(`SELECT id::text, balance_minor::text FROM "${schema}".wallets ORDER BY id`);
  run("node_modules/prisma/build/index.js", ["db", "seed"], migrationEnvironment);
  const repeated = await pool.query(`SELECT id::text, balance_minor::text FROM "${schema}".wallets ORDER BY id`);
  assert.deepEqual(repeated.rows, before.rows);

  // Simulate an existing pre-Prisma database, only inside this disposable schema.
  await pool.query(`DROP TABLE "${schema}"._prisma_migrations`);
  await pool.query(`CREATE TABLE "${schema}".schema_migrations (filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())`);
  run("node_modules/prisma/build/index.js", ["migrate", "resolve", "--applied", "0_init"], migrationEnvironment);
  run("node_modules/prisma/build/index.js", ["migrate", "deploy"], migrationEnvironment);
  const adopted = await pool.query(`SELECT id::text, balance_minor::text FROM "${schema}".wallets ORDER BY id`);
  assert.deepEqual(adopted.rows, before.rows);
  console.log("Repeated seeding and adoption of existing balances passed.");
  console.log("Prisma verification passed in the isolated schema.");
} finally {
  if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await pool.end();
}
