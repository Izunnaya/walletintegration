import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Server } from "node:http";
import { authPrisma, authSchema, prepareAuthDatabase, closeAuthDatabase } from "./authDatabase.ts";
import { pool } from "./database.ts";
import { runReconciliation } from "../src/models/reconciliation.ts";

const fault = vi.hoisted(() => {
  process.env.JWT_SECRET = "transfer-stress-test-secret-not-for-production";
  process.env.TRUST_PROXY_HOPS = "0";
  return { walletId: null as bigint | null, afterUpdate: null as (() => Promise<void>) | null };
});

vi.mock("../src/models/db.ts", async () => {
  const { authPrisma, authSchema } = await import("./authDatabase.ts");
  const client = authPrisma.$extends({
    query: {
      wallet: {
        async update({ args, query }) {
          const result = await query(args);
          if (args.where.id === fault.walletId) {
            if (fault.afterUpdate) await fault.afterUpdate();
            else throw new Error("Injected application error mid-transfer");
          }
          return result;
        },
      },
    },
  });
  return { prisma: client, databaseSchema: authSchema };
});

import app from "../src/app.ts";
import { issueToken } from "../src/models/authToken.ts";

let server: Server | undefined;
let baseUrl: string;
let systemId: bigint;

beforeAll(async () => {
  await prepareAuthDatabase();
  const system = await authPrisma.user.create({
    data: {
      email: "system@stress.invalid",
      name: "System",
      passwordHash: "unused",
      wallets: { create: { isSystem: true } },
    },
    include: { wallets: true },
  });
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
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
    }
  } finally {
    await closeAuthDatabase();
  }
});

// Funded the way the service funds, so the fixtures themselves satisfy reconciliation: a
// transfer row from the system wallet, a signed entry each side, and both balances moved.
async function account(balance = 1000n) {
  return authPrisma.$transaction(async (client) => {
    const user = await client.user.create({
      data: {
        email: `${randomUUID()}@stress.invalid`,
        name: "Stress test",
        passwordHash: "unused",
        wallets: { create: {} },
      },
      include: { wallets: true },
    });
    const wallet = user.wallets[0];
    if (!wallet) throw new Error("Missing test wallet");
    if (balance > 0n) {
      const funding = await client.transfer.create({
        data: {
          reference: `stress-seed-${randomUUID()}`,
          sourceWalletId: systemId,
          destinationWalletId: wallet.id,
          amountMinor: balance,
        },
      });
      await client.ledgerEntry.createMany({
        data: [
          { transferId: funding.id, walletId: systemId, entryType: "debit", amountMinor: -balance },
          { transferId: funding.id, walletId: wallet.id, entryType: "credit", amountMinor: balance },
        ],
      });
      await client.wallet.update({ where: { id: systemId }, data: { balanceMinor: { decrement: balance } } });
      await client.wallet.update({ where: { id: wallet.id }, data: { balanceMinor: balance } });
    }
    return {
      userId: user.id,
      walletId: wallet.id,
      email: user.email,
      token: issueToken({ userId: user.id, role: "customer" }),
    };
  });
}

type Account = Awaited<ReturnType<typeof account>>;

function body(source: Account, destination: Account, amount = "100") {
  return {
    sourceWalletId: source.walletId.toString(),
    destinationWalletId: destination.walletId.toString(),
    amountMinor: amount,
    currency: "NGN",
  };
}

type Answer = { status: number; body: any; retryAfter: string | null };

async function send(token: string, request: unknown, key: string): Promise<Answer> {
  const response = await fetch(`${baseUrl}/transfers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": key },
    body: JSON.stringify(request),
  });
  return { status: response.status, body: await response.json(), retryAfter: response.headers.get("Retry-After") };
}

async function settle(token: string, request: unknown, key: string): Promise<Answer> {
  let answer = await send(token, request, key);
  for (let attempt = 0; answer.status === 503 && attempt < 10; attempt++) {
    expect(answer.body.error.code).toBe("TRANSFER_UNAVAILABLE");
    expect(answer.retryAfter).toBe("1");
    await delay(400 * (attempt + 1));
    answer = await send(token, request, key);
  }
  expect(answer.status, `key ${key} never settled: ${JSON.stringify(answer.body)}`).not.toBe(503);
  expect(answer.status, `key ${key} was rate limited before it could settle`).not.toBe(429);
  return answer;
}

async function balanceOf(owner: Account) {
  return (await authPrisma.wallet.findUniqueOrThrow({ where: { id: owner.walletId } })).balanceMinor;
}

// The whole reconciliation, not a single comparison. A storm that left the balances right and
// the ledger wrong would pass a balance check and fail this.
async function assertBooksAreSound() {
  const checks = await authPrisma.$transaction(async (client) => runReconciliation(client, authSchema));
  expect(checks).toHaveLength(7);
  expect(checks.filter((check) => check.rows.length > 0).map((check) => ({ name: check.name, rows: check.rows }))).toEqual([]);
}

async function deadlockCount() {
  const rows = await pool.query<{ deadlocks: string }>(
    "SELECT deadlocks::text FROM pg_stat_database WHERE datname = current_database()",
  );
  return BigInt(rows.rows[0]?.deadlocks ?? "0");
}

describe("the money path under load", () => {
  it("twenty-five simultaneous sends on one Idempotency-Key move the money exactly once", async () => {
    const source = await account(5000n);
    const destination = await account(0n);
    const key = randomUUID();

    const answers = await Promise.all(
      Array.from({ length: 25 }, () => settle(source.token, body(source, destination), key)),
    );

    // One answer, twenty-five times. Not merely twenty-five successes: the same transfer id
    // and the same reference, because two transfers would also be twenty-five successes.
    const first = answers[0];
    expect(first?.status).toBe(201);
    for (const answer of answers) {
      expect(answer.status).toBe(201);
      expect(answer.body).toEqual(first?.body);
    }

    expect(await authPrisma.transfer.count({ where: { sourceWalletId: source.walletId } })).toBe(1);
    expect(await authPrisma.idempotencyRecord.count({ where: { userId: source.userId } })).toBe(1);

    const entries = await authPrisma.ledgerEntry.findMany({
      where: { transferId: BigInt(first?.body.transfer.id) },
      orderBy: { entryType: "asc" },
    });
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.amountMinor)).toEqual([100n, -100n]);
    expect(entries.reduce((sum, entry) => sum + entry.amountMinor, 0n)).toBe(0n);

    // Exact kobo as bigint, and exact kobo as the string the API puts on the wire.
    expect(await balanceOf(source)).toBe(4900n);
    expect(await balanceOf(destination)).toBe(100n);
    expect(first?.body.transfer.amountMinor).toBe("100");

    await assertBooksAreSound();
  });

  it("one shared key mixed with fifteen distinct keys spends the balance to exactly zero", async () => {
    const source = await account(1000n);
    const destination = await account(0n);
    const sharedKey = randomUUID();
    const distinctKeys = Array.from({ length: 15 }, () => randomUUID());
    const request = body(source, destination, "100");

    const shared = Array.from({ length: 15 }, () => ({ key: sharedKey, shared: true }));
    const distinct = distinctKeys.map((key) => ({ key, shared: false }));
    // Interleaved so the duplicates are not all queued ahead of the distinct keys.
    const plan = shared.flatMap((item, index) => [item, distinct[index]!]);

    const answers = await Promise.all(
      plan.map(async (item) => ({ ...item, answer: await settle(source.token, request, item.key) })),
    );

    for (const { answer } of answers) {
      expect([201, 422]).toContain(answer.status);
      if (answer.status === 422) expect(answer.body.error.code).toBe("INSUFFICIENT_FUNDS");
    }

    // Every reply under the shared key is the same reply, whichever way it went.
    const sharedAnswers = answers.filter((item) => item.shared).map((item) => item.answer);
    for (const answer of sharedAnswers) expect(answer.body).toEqual(sharedAnswers[0]?.body);

    const succeeded = new Set(answers.filter((item) => item.answer.status === 201).map((item) => item.key));
    expect(succeeded.size).toBe(10);

    // Ten transfers of a hundred against a thousand: the balance lands on zero, never below.
    expect(await balanceOf(source)).toBe(0n);
    expect(await balanceOf(destination)).toBe(1000n);
    expect(await authPrisma.transfer.count({ where: { sourceWalletId: source.walletId } })).toBe(10);

    const debits = await authPrisma.ledgerEntry.findMany({
      where: { walletId: source.walletId, entryType: "debit" },
    });
    expect(debits).toHaveLength(10);
    expect(debits.reduce((sum, entry) => sum + entry.amountMinor, 0n)).toBe(-1000n);

    // One claim per key: the fifteen duplicates wrote one row between them.
    expect(await authPrisma.idempotencyRecord.count({ where: { userId: source.userId } })).toBe(16);

    await assertBooksAreSound();
  });

  it("sixteen opposing transfers between two wallets never deadlock", async () => {
    const first = await account(1000n);
    const second = await account(1000n);
    const before = await deadlockCount();

    const answers = await Promise.all([
      ...Array.from({ length: 8 }, () => settle(first.token, body(first, second, "100"), randomUUID())),
      ...Array.from({ length: 8 }, () => settle(second.token, body(second, first, "100"), randomUUID())),
    ]);

    expect(await deadlockCount()).toBe(before);
    for (const answer of answers) {
      expect([201, 422]).toContain(answer.status);
      if (answer.status === 422) expect(answer.body.error.code).toBe("INSUFFICIENT_FUNDS");
    }

    // Money crossing in both directions between the same two wallets conserves the pair,
    // whatever order the individual transfers landed in.
    const firstBalance = await balanceOf(first);
    const secondBalance = await balanceOf(second);
    expect(firstBalance + secondBalance).toBe(2000n);
    expect(firstBalance).toBeGreaterThanOrEqual(0n);
    expect(secondBalance).toBeGreaterThanOrEqual(0n);

    await assertBooksAreSound();
  });

  it("every ordered pair of four wallets sent at once never deadlocks", async () => {
    const holders = await Promise.all(Array.from({ length: 4 }, () => account(1000n)));
    const pairs = holders.flatMap((from) => holders.filter((to) => to !== from).map((to) => ({ from, to })));
    expect(pairs).toHaveLength(12);
    const before = await deadlockCount();

    const answers = await Promise.all(
      [...pairs, ...pairs].map(({ from, to }) => settle(from.token, body(from, to, "100"), randomUUID())),
    );

    expect(await deadlockCount()).toBe(before);
    for (const answer of answers) {
      expect([201, 422]).toContain(answer.status);
    }

    const balances = await Promise.all(holders.map((holder) => balanceOf(holder)));
    for (const amount of balances) expect(amount).toBeGreaterThanOrEqual(0n);
    // Twenty-four transfers of a hundred, all between these four wallets, so the four
    // together still hold what they started with.
    expect(balances.reduce((sum, amount) => sum + amount, 0n)).toBe(4000n);

    await assertBooksAreSound();
  });

  it("a failure after both balances have moved writes nothing, not even the key", async () => {
    const source = await account();
    const destination = await account(0n);
    const key = randomUUID();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    fault.walletId = destination.walletId;
    try {
      const answer = await send(source.token, body(source, destination), key);
      expect(answer.status).toBe(500);
    } finally {
      fault.walletId = null;
      log.mockRestore();
    }

    expect(await balanceOf(source)).toBe(1000n);
    expect(await balanceOf(destination)).toBe(0n);
    expect(await authPrisma.transfer.count({ where: { sourceWalletId: source.walletId } })).toBe(0);
    expect(await authPrisma.ledgerEntry.count({ where: { walletId: destination.walletId } })).toBe(0);
    expect(await authPrisma.ledgerEntry.count({ where: { walletId: source.walletId, entryType: "debit" } })).toBe(0);
    // The claim is written first and rolled back with the rest. Searched by key across every
    // user, so a claim filed under the wrong identity would still be found.
    expect(await authPrisma.idempotencyRecord.count({ where: { idempotencyKey: key } })).toBe(0);

    // The key is free, so the caller's retry is a first attempt and not a replay of a failure.
    expect((await settle(source.token, body(source, destination), key)).status).toBe(201);
    expect(await balanceOf(source)).toBe(900n);

    await assertBooksAreSound();
  });

  it("a failing sender does not disturb twelve concurrent senders paying the same wallet", async () => {
    const destination = await account(0n);
    const senders = await Promise.all(Array.from({ length: 12 }, () => account(500n)));
    const doomed = await account(500n);
    const doomedKey = randomUUID();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    fault.walletId = doomed.walletId;
    let doomedAnswer: Answer;
    try {
      // The doomed request keeps its own key through any backpressure, so the answer under
      // test is the injected failure and not a queue timeout that happened to come first.
      const doomedSend = (async () => {
        let answer = await send(doomed.token, body(doomed, destination, "100"), doomedKey);
        for (let attempt = 0; answer.status === 503 && attempt < 12; attempt++) {
          await delay(150 * (attempt + 1));
          answer = await send(doomed.token, body(doomed, destination, "100"), doomedKey);
        }
        return answer;
      })();
      const results = await Promise.all([
        ...senders.map((sender) => settle(sender.token, body(sender, destination, "100"), randomUUID())),
        doomedSend,
      ]);
      doomedAnswer = results[results.length - 1]!;
      for (const answer of results.slice(0, 12)) expect(answer.status).toBe(201);
    } finally {
      fault.walletId = null;
      log.mockRestore();
    }

    expect(doomedAnswer.status).toBe(500);
    expect(await balanceOf(doomed)).toBe(500n);
    expect(await authPrisma.idempotencyRecord.count({ where: { idempotencyKey: doomedKey } })).toBe(0);
    expect(await balanceOf(destination)).toBe(1200n);

    const credits = await authPrisma.ledgerEntry.findMany({
      where: { walletId: destination.walletId, entryType: "credit" },
    });
    expect(credits).toHaveLength(12);
    expect(credits.reduce((sum, entry) => sum + entry.amountMinor, 0n)).toBe(1200n);

    await assertBooksAreSound();
  });

  it("a key replayed with different details under load refuses every variant and moves nothing", async () => {
    const source = await account(1000n);
    const destination = await account(0n);
    const other = await account(0n);
    const key = randomUUID();

    expect((await settle(source.token, body(source, destination, "250"), key)).status).toBe(201);
    const after = await balanceOf(source);
    expect(after).toBe(750n);

    const variants = [
      body(source, destination, "251"),
      body(source, destination, "249"),
      body(source, other, "250"),
      body(source, destination, "2500"),
    ];
    const conflicts = await Promise.all(
      variants.flatMap((variant) => [
        settle(source.token, variant, key),
        settle(source.token, variant, key),
      ]),
    );
    for (const answer of conflicts) {
      expect(answer.status).toBe(409);
      expect(answer.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    }

    // A refused replay is not a stored outcome: the original key still answers the original
    // transfer, and a 409 never overwrote it.
    const replay = await settle(source.token, body(source, destination, "250"), key);
    expect(replay.status).toBe(201);
    expect(await balanceOf(source)).toBe(750n);
    expect(await balanceOf(other)).toBe(0n);
    expect(await authPrisma.transfer.count({ where: { sourceWalletId: source.walletId } })).toBe(1);
    expect(await authPrisma.idempotencyRecord.count({ where: { userId: source.userId } })).toBe(1);

    await assertBooksAreSound();
  });

  it("a kobo at a time leaves no rounding behind", async () => {
    // Nothing here is divisible or convertible, so a float anywhere in the path - parsing,
    // serialising, summing - shows up immediately as an off-by-one in kobo.
    const source = await account(12n);
    const destination = await account(0n);

    // Sequential, so each one is a full round trip to a hosted database. Twelve is what fits
    // inside the file's ninety second per-test budget.
    for (let sent = 1n; sent <= 12n; sent++) {
      const answer = await settle(source.token, body(source, destination, "1"), randomUUID());
      expect(answer.status).toBe(201);
      expect(answer.body.transfer.amountMinor).toBe("1");
    }

    expect(await balanceOf(source)).toBe(0n);
    expect(await balanceOf(destination)).toBe(12n);
    const refused = await settle(source.token, body(source, destination, "1"), randomUUID());
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("INSUFFICIENT_FUNDS");

    await assertBooksAreSound();
  });
});
