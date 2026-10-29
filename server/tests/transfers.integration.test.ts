import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Server } from "node:http";
import { authPrisma, authSchema, prepareAuthDatabase, closeAuthDatabase } from "./authDatabase.ts";
import { pool } from "./database.ts";

const fault = vi.hoisted(() => {
  process.env.JWT_SECRET = "transfer-integration-test-secret-not-for-production";
  return { walletId: null as bigint | null, afterDebit: null as (() => Promise<void>) | null };
});
vi.mock("../src/models/db.ts", async () => {
  const { authPrisma, authSchema } = await import("./authDatabase.ts");
  const client = authPrisma.$extends({ query: { wallet: { async update({ args, query }) {
    const result = await query(args);
    if (args.where.id === fault.walletId) {
      if (fault.afterDebit) await fault.afterDebit();
      else throw new Error("Injected application error after debit");
    }
    return result;
  } } } });
  return { prisma: client, databaseSchema: authSchema };
});
import app from "../src/app.ts";
import { issueToken } from "../src/models/authToken.ts";

let server: Server | undefined;
let baseUrl: string;
let systemId: bigint;
beforeAll(async () => {
  await prepareAuthDatabase();
  const system = await authPrisma.user.create({ data: {
    email: "system@test.invalid", name: "System", passwordHash: "unused", wallets: { create: { isSystem: true } },
  }, include: { wallets: true } });
  const wallet = system.wallets[0];
  if (!wallet) throw new Error("Missing system wallet");
  systemId = wallet.id;
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  try {
    if (server) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  } finally { await closeAuthDatabase(); }
});

async function account(balance = 1000n) {
  return authPrisma.$transaction(async (client) => {
    const user = await client.user.create({ data: {
      email: `${randomUUID()}@test.invalid`, name: "Transfer test", passwordHash: "unused",
      wallets: { create: {} },
    }, include: { wallets: true } });
    const wallet = user.wallets[0];
    if (!wallet) throw new Error("Missing test wallet");
    if (balance > 0n) {
      const funding = await client.transfer.create({ data: {
        reference: `seed-${randomUUID()}`, sourceWalletId: systemId, destinationWalletId: wallet.id, amountMinor: balance,
      } });
      await client.ledgerEntry.createMany({ data: [
        { transferId: funding.id, walletId: systemId, entryType: "debit", amountMinor: -balance },
        { transferId: funding.id, walletId: wallet.id, entryType: "credit", amountMinor: balance },
      ] });
      await client.wallet.update({ where: { id: systemId }, data: { balanceMinor: { decrement: balance } } });
      await client.wallet.update({ where: { id: wallet.id }, data: { balanceMinor: balance } });
    }
    return { userId: user.id, walletId: wallet.id, publicId: wallet.publicId, email: user.email, token: issueToken({ userId: user.id, role: "customer" }) };
  });
}
type Account = Awaited<ReturnType<typeof account>>;
function body(source: Account, destination: Account, amount = "100") {
  return { sourceWalletId: source.walletId.toString(), destinationWalletId: destination.walletId.toString(), amountMinor: amount, currency: "NGN" };
}
async function send(token: string, request: unknown, key: string | null = randomUUID()) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  if (key !== null) headers["Idempotency-Key"] = key;
  const response = await fetch(`${baseUrl}/transfers`, { method: "POST", headers, body: JSON.stringify(request) });
  return { status: response.status, body: await response.json(), requestId: response.headers.get("X-Request-Id"), retryAfter: response.headers.get("Retry-After") };
}
async function balance(owner: Account) {
  return (await authPrisma.wallet.findUniqueOrThrow({ where: { id: owner.walletId } })).balanceMinor;
}
async function assertBooksBalance() {
  const rows = await pool.query(`SELECT w.id FROM "${authSchema}".wallets w
    LEFT JOIN "${authSchema}".ledger_entries l ON l.wallet_id = w.id
    GROUP BY w.id HAVING w.balance_minor <> COALESCE(SUM(l.amount_minor), 0)`);
  expect(rows.rows).toEqual([]);
}
async function waitForBlockedQuery(blockerPid: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [blockerPid]);
    if (result.rowCount) return;
    await delay(50);
  }
  throw new Error("Expected a query waiting on the held row lock");
}

describe("atomic, idempotent transfers over HTTP", () => {
  it("saves and replays a rejection when neither public wallet exists", async () => {
    const owner = await account();
    const key = randomUUID();
    const request = {
      sourceWalletId: `wlt_${"0".repeat(32)}`,
      destinationWalletId: `wlt_${"f".repeat(32)}`,
      amountMinor: "100", currency: "NGN",
    };
    const first = await send(owner.token, request, key);
    const replay = await send(owner.token, request, key);
    expect(first.status).toBe(404);
    expect(first.body.error.code).toBe("WALLET_NOT_FOUND");
    expect(replay.status).toBe(404);
    expect(replay.body).toEqual(first.body);
    expect(await balance(owner)).toBe(1000n);
    expect(await authPrisma.transfer.count({ where: { sourceWalletId: owner.walletId } })).toBe(0);
    await assertBooksBalance();
  });

  it("public IDs resolve to existing wallets and share idempotency with numeric IDs", async () => {
    const source = await account(); const destination = await account(0n); const key = randomUUID();
    expect(source.publicId).toMatch(/^wlt_[0-9a-f]{32}$/);
    const numeric = await send(source.token, body(source, destination), key);
    expect(numeric.status).toBe(201);
    const request = { ...body(source, destination), sourceWalletId: source.publicId, destinationWalletId: destination.publicId };
    const replay = await send(source.token, request, key);
    expect(replay.body).toEqual(numeric.body);
    expect(replay.body.transfer).toMatchObject({ sourceWalletPublicId: source.publicId, destinationWalletPublicId: destination.publicId });
    expect(await balance(source)).toBe(900n);
    expect(await balance(destination)).toBe(100n);
    const history = await fetch(`${baseUrl}/transfers`, { headers: { Authorization: `Bearer ${source.token}` } });
    expect((await history.json()).transfers[0]).toMatchObject({ sourceWalletPublicId: source.publicId, destinationWalletPublicId: destination.publicId });
    const detail = await fetch(`${baseUrl}/transfers/${numeric.body.transfer.id}`, { headers: { Authorization: `Bearer ${source.token}` } });
    expect((await detail.json()).transfer.sourceWalletPublicId).toBe(source.publicId);
    expect((await send(destination.token, request)).status).toBe(403);
    expect((await send(source.token, { ...request, destinationWalletId: `wlt_${"0".repeat(32)}` })).status).toBe(404);
    expect((await send(source.token, { ...request, destinationWalletId: "wlt_invalid" })).status).toBe(400);
    await assertBooksBalance();
  });

  it("moves money once, writes an equal ledger pair and replays a lost response", async () => {
    const source = await account(); const destination = await account(0n); const key = randomUUID();
    const first = await send(source.token, body(source, destination), key);
    expect(first.status).toBe(201);
    expect(first.body.transfer).toMatchObject({ sourceWalletId: source.walletId.toString(), amountMinor: "100", currency: "NGN" });
    const replay = await send(source.token, { ...body(source, destination), amountMinor: " 000100 " }, key);
    expect(replay.status).toBe(201); expect(replay.body).toEqual(first.body);
    expect(await balance(source)).toBe(900n); expect(await balance(destination)).toBe(100n);
    const entries = await authPrisma.ledgerEntry.findMany({ where: { transferId: BigInt(first.body.transfer.id) } });
    expect(entries).toHaveLength(2);
    expect(entries.reduce((sum, entry) => sum + entry.amountMinor, 0n)).toBe(0n);
    const conflict = await send(source.token, body(source, destination, "101"), key);
    expect(conflict.status).toBe(409);
    await assertBooksBalance();
  });

  it("rejects malformed IDs, missing/invalid keys and unauthenticated requests before claiming keys", async () => {
    const source = await account(); const destination = await account();
    expect((await send("invalid", body(source, destination))).status).toBe(401);
    for (const key of [null, "has spaces", "x".repeat(129)]) {
      expect((await send(source.token, body(source, destination), key)).status).toBe(400);
    }
    expect((await send(source.token, { ...body(source, destination), sourceWalletId: 1 })).status).toBe(400);
    expect((await send(source.token, { ...body(source, destination), userId: "1" })).status).toBe(400);
    expect(await authPrisma.idempotencyRecord.count({ where: { userId: source.userId } })).toBe(0);
  });

  it("twenty concurrent duplicate keys create exactly one transfer and one ledger pair", async () => {
    const source = await account(); const destination = await account(0n); const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        send(
          source.token,
          index % 2
            ? { ...body(source, destination), sourceWalletId: source.publicId, destinationWalletId: destination.publicId }
            : body(source, destination),
          key,
        ),
      ),
    );
    for (let response of responses) {
      if (response.status === 503) response = await send(source.token, body(source, destination), key);
      expect(response.status).toBe(201);
      expect(response.body).toEqual(responses.find((item) => item.status === 201)?.body);
    }
    const records = await authPrisma.idempotencyRecord.findMany({ where: { userId: source.userId } });
    expect(records).toHaveLength(1);
    expect(await authPrisma.transfer.count({ where: { sourceWalletId: source.walletId } })).toBe(1);
    expect(await authPrisma.ledgerEntry.count({ where: { walletId: source.walletId, entryType: "debit" } })).toBe(1);
    expect(await balance(source)).toBe(900n);
    await assertBooksBalance();
  });

  it("twelve concurrent overspending requests only allow the affordable transfer", async () => {
    const source = await account(); const destination = await account(0n);
    const attempts = await Promise.all(Array.from({ length: 12 }, async () => {
      const key = randomUUID();
      return { key, response: await send(source.token, body(source, destination, "800"), key) };
    }));
    // 503 is backpressure, not a rejection. Resolve uncertain attempts with their original key.
    for (const attempt of attempts) {
      if (attempt.response.status === 503) {
        attempt.response = await send(source.token, body(source, destination, "800"), attempt.key);
      }
    }
    expect(attempts.filter(({ response }) => response.status === 201)).toHaveLength(1);
    expect(attempts.filter(({ response }) => response.status === 422)).toHaveLength(11);
    expect(await balance(source)).toBe(200n); expect(await balance(destination)).toBe(800n);
    await assertBooksBalance();
  });

  it("opposite-direction transfers and identical keys for different users remain independent", async () => {
    const first = await account(); const second = await account(); const key = randomUUID();
    const responses = await Promise.all([send(first.token, body(first, second), key), send(second.token, body(second, first), key)]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(await balance(first)).toBe(1000n); expect(await balance(second)).toBe(1000n);
    expect(await authPrisma.idempotencyRecord.count({ where: { idempotencyKey: key } })).toBe(2);
    await assertBooksBalance();
  });

  it("stores a business rejection, even if funds change before replay", async () => {
    const source = await account(0n); const destination = await account(); const key = randomUUID();
    const first = await send(source.token, body(source, destination), key);
    expect(first.status).toBe(422); expect(first.body.error.code).toBe("INSUFFICIENT_FUNDS");
    expect((await send(destination.token, body(destination, source, "500"))).status).toBe(201);
    const replay = await send(source.token, body(source, destination), key);
    expect(replay.status).toBe(422); expect(replay.body).toEqual(first.body);
    expect(replay.requestId).not.toBe(first.requestId);
    expect((await send(source.token, body(source, destination))).status).toBe(201);
    await assertBooksBalance();
  });

  it("rejects foreign, missing, identical and system wallets without financial writes", async () => {
    const source = await account(); const destination = await account();
    expect((await send(destination.token, body(source, destination))).status).toBe(403);
    expect((await send(source.token, body(source, source))).body.error.code).toBe("SAME_WALLET");
    expect((await send(source.token, { ...body(source, destination), destinationWalletId: "9223372036854775807" })).status).toBe(404);
    expect((await send(source.token, { ...body(source, destination), destinationWalletId: systemId.toString() })).body.error.code).toBe("SYSTEM_WALLET_NOT_TRANSFERABLE");
    expect(await authPrisma.transfer.count({ where: { sourceWalletId: source.walletId } })).toBe(0);
    expect(await balance(source)).toBe(1000n);
  });

  it.each(["sender-blocked", "recipient-blocked", "sender-blacklisted", "recipient-blacklisted"])("rejects %s", async (restriction) => {
    const source = await account(); const destination = await account();
    const affected = restriction.startsWith("sender") ? source : destination;
    if (restriction.endsWith("blacklisted")) {
      await authPrisma.blacklistEntry.create({ data: { email: affected.email, reason: "test" } });
    } else await authPrisma.user.update({ where: { id: affected.userId }, data: { isBlocked: true } });
    const response = await send(source.token, body(source, destination));
    expect(response.status).toBe(422); expect(response.body.error.code).toBe(restriction.replace("-", "_").toUpperCase());
    expect(await balance(source)).toBe(1000n); expect(await balance(destination)).toBe(1000n);
  });

  it("rolls back on an application error after the debit, then permits a same-key retry", async () => {
    const source = await account(); const destination = await account(0n); const key = randomUUID();
    fault.walletId = source.walletId;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await send(source.token, body(source, destination), key)).status).toBe(500);
    } finally { fault.walletId = null; log.mockRestore(); }
    expect(await balance(source)).toBe(1000n); expect(await balance(destination)).toBe(0n);
    expect(await authPrisma.transfer.count({ where: { sourceWalletId: source.walletId } })).toBe(0);
    expect(await authPrisma.ledgerEntry.count({ where: { walletId: source.walletId, entryType: "debit" } })).toBe(0);
    expect(await authPrisma.idempotencyRecord.count({ where: { userId: source.userId } })).toBe(0);
    expect((await send(source.token, body(source, destination), key)).status).toBe(201);
    await assertBooksBalance();
  });

  it("a block committed while the transfer waits on the user lock wins", async () => {
    const source = await account(); const destination = await account(); const locker = await pool.connect();
    let pending: ReturnType<typeof send> | undefined;
    try {
      await locker.query("BEGIN");
      await locker.query(`UPDATE "${authSchema}".users SET is_blocked = true WHERE id = $1`, [source.userId.toString()]);
      const pid = await locker.query("SELECT pg_backend_pid() AS pid");
      pending = send(source.token, body(source, destination));
      await waitForBlockedQuery(pid.rows[0].pid);
      await locker.query("COMMIT");
      const response = await pending;
      expect(response.status).toBe(422); expect(response.body.error.code).toBe("SENDER_BLOCKED");
      expect(await balance(source)).toBe(1000n);
    } finally { await locker.query("ROLLBACK"); locker.release(); await pending; }
  });

  it("a lock timeout returns retry guidance and leaves no claimed key", async () => {
    const source = await account(); const destination = await account(); const key = randomUUID();
    const locker = await pool.connect();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await locker.query("BEGIN");
      await locker.query(`SELECT id FROM "${authSchema}".users WHERE id = $1 FOR NO KEY UPDATE`, [source.userId.toString()]);
      const response = await send(source.token, body(source, destination), key);
      expect(response.status).toBe(503); expect(response.retryAfter).toBe("1");
      expect(response.body.error.message).toContain("same Idempotency-Key");
    } finally { await locker.query("ROLLBACK"); locker.release(); log.mockRestore(); }
    expect(await authPrisma.idempotencyRecord.count({ where: { userId: source.userId } })).toBe(0);
    expect((await send(source.token, body(source, destination), key)).status).toBe(201);
  });

  it("a transfer holding the user lock completes before a later block", async () => {
    const source = await account(); const destination = await account(0n);
    let reachedDebit: () => void = () => {};
    const debited = new Promise<void>((resolve) => { reachedDebit = resolve; });
    let releaseTransfer: () => void = () => {};
    const released = new Promise<void>((resolve) => { releaseTransfer = resolve; });
    fault.walletId = source.walletId;
    fault.afterDebit = async () => { reachedDebit(); await released; };
    const locker = await pool.connect();
    const pending = send(source.token, body(source, destination));
    let block: Promise<unknown> | undefined;
    try {
      // Race the response too, so an unexpected failure cannot leave this test waiting forever.
      await Promise.race([debited, pending.then(() => { throw new Error("Transfer ended before debit barrier"); })]);
      const pid = await locker.query("SELECT pg_backend_pid() AS pid");
      block = locker.query(`UPDATE "${authSchema}".users SET is_blocked = true WHERE id = $1`, [source.userId.toString()]);
      for (let attempt = 0; ; attempt++) {
        const wait = await pool.query("SELECT cardinality(pg_blocking_pids($1)) AS count", [pid.rows[0].pid]);
        if (wait.rows[0].count > 0) break;
        if (attempt === 50) throw new Error("Block did not wait for the transfer lock");
        await delay(50);
      }
      releaseTransfer();
      expect((await pending).status).toBe(201);
      await block;
      expect(await balance(source)).toBe(900n);
      expect((await authPrisma.user.findUniqueOrThrow({ where: { id: source.userId } })).isBlocked).toBe(true);
      await assertBooksBalance();
    } finally {
      releaseTransfer(); fault.walletId = null; fault.afterDebit = null;
      await pending; await block; locker.release();
    }
  });

  it("a duplicate waiting on a failed transaction can claim the rolled-back key", async () => {
    const source = await account(); const destination = await account(0n); const key = randomUUID();
    let reachedDebit: () => void = () => {};
    const debited = new Promise<void>((resolve) => { reachedDebit = resolve; });
    let releaseTransfer: () => void = () => {};
    const released = new Promise<void>((resolve) => { releaseTransfer = resolve; });
    fault.walletId = source.walletId;
    fault.afterDebit = async () => {
      reachedDebit(); await released;
      fault.walletId = null; fault.afterDebit = null;
      throw new Error("Injected first claimant rollback");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = send(source.token, body(source, destination), key);
    let second: ReturnType<typeof send> | undefined;
    try {
      await Promise.race([debited, first.then(() => { throw new Error("Transfer ended before debit barrier"); })]);
      second = send(source.token, body(source, destination), key);
      // Observe the duplicate waiting on the unique-key insertion before releasing the first.
      for (let attempt = 0; ; attempt++) {
        const wait = await pool.query("SELECT 1 FROM pg_stat_activity WHERE query LIKE '%INSERT INTO%idempotency_records%' AND cardinality(pg_blocking_pids(pid)) > 0");
        if (wait.rowCount) break;
        if (attempt === 50) throw new Error("Duplicate did not wait on the idempotency key");
        await delay(50);
      }
      releaseTransfer();
      expect((await first).status).toBe(500);
      expect((await second).status).toBe(201);
      expect(await balance(source)).toBe(900n);
      expect(await authPrisma.transfer.count({ where: { sourceWalletId: source.walletId } })).toBe(1);
      await assertBooksBalance();
    } finally {
      releaseTransfer(); await first; await second;
      fault.walletId = null; fault.afterDebit = null; log.mockRestore();
    }
  });
});
