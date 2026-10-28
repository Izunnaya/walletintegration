import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool } from "./database.ts";

afterAll(async () => { await pool.end(); });

it("backfills unique public IDs without changing existing wallet IDs or balances", async () => {
  const client = await pool.connect();
  const schema = `wallet_migration_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query((await readFile(new URL("../prisma/migrations/0_init/migration.sql", import.meta.url), "utf8")).replace(/^(?:BEGIN|COMMIT);\s*$/gm, ""));
    const users = await client.query("INSERT INTO users(email, name, password_hash) VALUES ('one@test.invalid','One','unused'), ('two@test.invalid','Two','unused') RETURNING id");
    for (const user of users.rows) await client.query("INSERT INTO wallets(owner_id) VALUES ($1)", [user.id]);
    const before = await client.query("SELECT id, owner_id, balance_minor FROM wallets ORDER BY id");
    const migration = (await readFile(new URL("../prisma/migrations/202610280001_public_wallet_ids/migration.sql", import.meta.url), "utf8")).replace(/^(?:BEGIN|COMMIT);\s*$/gm, "");
    await client.query(migration);
    expect((await client.query("SELECT id, owner_id, balance_minor FROM wallets ORDER BY id")).rows).toEqual(before.rows);
    await client.query(migration); // A deployment can safely adopt an already-applied additive change.
    const wallets = (await client.query("SELECT public_id FROM wallets")).rows;
    expect(new Set(wallets.map(wallet => wallet.public_id)).size).toBe(2);
    for (const wallet of wallets) expect(wallet.public_id).toMatch(/^wlt_[0-9a-f]{32}$/);
    await client.query("SAVEPOINT duplicate_id");
    await expect(client.query("UPDATE wallets SET public_id = $1", [wallets[0].public_id])).rejects.toMatchObject({ code: "23505" });
    await client.query("ROLLBACK TO SAVEPOINT duplicate_id");
    const ids = (await client.query("SELECT public_id FROM wallets ORDER BY id")).rows;
    await client.query("UPDATE wallets SET updated_at = now()");
    expect((await client.query("SELECT public_id FROM wallets ORDER BY id")).rows).toEqual(ids);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});
