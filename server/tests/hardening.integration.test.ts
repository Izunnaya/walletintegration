import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import type { Server } from "node:http";
import { apiPrisma, prepareApiDatabase, closeApiDatabase } from "./apiDatabase.ts";
import { hashPassword } from "../src/models/password.ts";

vi.mock("../src/models/db.ts", async () => {
  const { apiPrisma, apiSchema } = await import("./apiDatabase.ts");
  return { prisma: apiPrisma, databaseSchema: apiSchema };
});
vi.hoisted(() => {
  process.env.JWT_SECRET = "hardening-integration-test-secret-not-for-production";
  process.env.TRUST_PROXY_HOPS = "0";
});
import app from "../src/app.ts";

let server: Server | undefined;
let baseUrl: string;

const password = "correct horse battery staple";
const ADMIN_LIMIT = 30;

type Actor = { id: bigint; walletId: bigint; token: string };

async function createActor(email: string, role: "customer" | "admin"): Promise<Actor> {
  const user = await apiPrisma.user.create({
    data: { email, name: email, passwordHash: await hashPassword(password), role },
  });
  const wallet = await apiPrisma.wallet.create({ data: { ownerId: user.id } });
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error(`Could not sign in ${email}: ${JSON.stringify(body)}`);
  return { id: user.id, walletId: wallet.id, token: body.token };
}

let admin: Actor;
let holder: Actor;
let stranger: Actor;
let systemWalletId: bigint;

beforeAll(async () => {
  await prepareApiDatabase();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const system = await apiPrisma.user.create({
    data: { email: "system@hardening.invalid", name: "System", passwordHash: "unused" },
  });
  const systemWallet = await apiPrisma.wallet.create({ data: { ownerId: system.id, isSystem: true } });
  systemWalletId = systemWallet.id;

  admin = await createActor("admin@hardening.invalid", "admin");
  holder = await createActor("holder@hardening.invalid", "customer");
  stranger = await createActor("stranger@hardening.invalid", "customer");

  // One real transfer, so there is a record that belongs to the holder and not the stranger.
  const transfer = await apiPrisma.transfer.create({
    data: {
      reference: "hardening-funding",
      sourceWalletId: systemWalletId,
      destinationWalletId: holder.walletId,
      amountMinor: 5000n,
    },
  });
  await apiPrisma.ledgerEntry.createMany({
    data: [
      { transferId: transfer.id, walletId: systemWalletId, entryType: "debit", amountMinor: -5000n },
      { transferId: transfer.id, walletId: holder.walletId, entryType: "credit", amountMinor: 5000n },
    ],
  });
  await apiPrisma.wallet.update({ where: { id: systemWalletId }, data: { balanceMinor: { decrement: 5000n } } });
  await apiPrisma.wallet.update({ where: { id: holder.walletId }, data: { balanceMinor: 5000n } });
});

afterAll(async () => {
  try {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
    }
  } finally {
    await closeApiDatabase();
  }
});

function get(path: string, token?: string, extra: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
  });
}

describe("the admin quota is spent before the authorisation query", () => {
  it("refuses a customer flooding /admin at the quota, not at the role check", async () => {
    const flooder = await createActor("flooder@hardening.invalid", "customer");
    const statuses: number[] = [];
    let limited: Response | undefined;

    for (let attempt = 0; attempt < ADMIN_LIMIT + 3; attempt++) {
      const response = await get("/admin/audit", flooder.token);
      statuses.push(response.status);
      if (response.status === 429 && !limited) limited = response;
      else await response.body?.cancel();
    }

    expect(statuses.slice(0, ADMIN_LIMIT)).toEqual(Array(ADMIN_LIMIT).fill(403));
    expect(statuses.slice(ADMIN_LIMIT)).toEqual([429, 429, 429]);
    expect(Number(limited?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited?.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("does not let one account's exhausted quota touch another's", async () => {
    const noisy = await createActor("noisy@hardening.invalid", "customer");
    const quiet = await createActor("quiet@hardening.invalid", "customer");

    for (let attempt = 0; attempt < ADMIN_LIMIT; attempt++) {
      await (await get("/admin/audit", noisy.token)).body?.cancel();
    }
    expect((await get("/admin/audit", noisy.token)).status).toBe(429);

    // Same address, same route, different account: the bucket is the caller, not the socket.
    expect((await get("/admin/audit", quiet.token)).status).toBe(403);
  });

  it("counts an unauthenticated caller before any quota, so no token spends nobody's bucket", async () => {
    // verifyToken runs first, so a request with no token never reaches the limiter. Thirty-
    // five of them in a row all answer 401, and the admin's own quota is untouched after.
    for (let attempt = 0; attempt < ADMIN_LIMIT + 5; attempt++) {
      const response = await get("/admin/audit");
      expect(response.status).toBe(401);
      await response.body?.cancel();
    }
    expect((await get("/admin/audit", admin.token)).status).toBe(200);
  });
});

describe("requireRole reads the current role and block state, not the token's", () => {
  it("follows a demotion and a promotion back on one unchanged token", async () => {
    const actor = await createActor("rotating@hardening.invalid", "admin");
    expect((await get("/admin/audit", actor.token)).status).toBe(200);

    await apiPrisma.user.update({ where: { id: actor.id }, data: { role: "customer" } });
    expect((await get("/admin/audit", actor.token)).status).toBe(403);

    await apiPrisma.user.update({ where: { id: actor.id }, data: { role: "admin" } });
    expect((await get("/admin/audit", actor.token)).status).toBe(200);

    await apiPrisma.user.update({ where: { id: actor.id }, data: { isBlocked: true } });
    const blocked = await get("/admin/audit", actor.token);
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: { code: "ACCOUNT_BLOCKED" } });

    await apiPrisma.user.update({ where: { id: actor.id }, data: { isBlocked: false } });
    expect((await get("/admin/audit", actor.token)).status).toBe(200);
  });

  it("distinguishes a wrong role from a blocked one, so an admin can tell which to fix", async () => {
    const demoted = await createActor("demoted@hardening.invalid", "customer");
    const refusal = await get("/admin/audit", demoted.token);
    expect(refusal.status).toBe(403);
    expect(await refusal.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });
});

describe("no response that carries money may be stored", () => {
  it("sets Cache-Control no-store on the authenticated reads, the refusals and the errors", async () => {
    const responses = {
      wallet: await get("/wallets/me", holder.token),
      history: await get("/transfers", holder.token),
      unauthenticated: await get("/wallets/me"),
      forbidden: await get("/admin/audit", holder.token),
      missing: await get("/transfers/999999999", holder.token),
      unknownRoute: await get("/nothing-here", holder.token),
      health: await get("/health/live"),
    };

    for (const [name, response] of Object.entries(responses)) {
      expect(response.headers.get("cache-control"), name).toBe("no-store");
      // A Pragma or Expires that disagreed would let an old proxy cache what no-store
      // refuses; absent is correct, contradicting is not.
      expect(response.headers.get("expires"), name).toBeNull();
      await response.body?.cancel();
    }

    // The two that matter most: a balance and a transfer list were really returned, so the
    // header above was on a response with money in it rather than on an error.
    expect(responses.wallet.status).toBe(200);
    expect(responses.history.status).toBe(200);
  });
});

describe("the 16 KB body limit guards the money route too", () => {
  it("refuses an oversized transfer before a key is claimed", async () => {
    const key = "oversized-body-key";
    const response = await fetch(`${baseUrl}/transfers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${holder.token}`,
        "Idempotency-Key": key,
      },
      body: JSON.stringify({
        sourceWalletId: holder.walletId.toString(),
        destinationWalletId: stranger.walletId.toString(),
        amountMinor: "100",
        currency: "NGN",
        padding: "x".repeat(17_000),
      }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "BODY_TOO_LARGE", requestId: response.headers.get("x-request-id") },
    });
    expect(await apiPrisma.idempotencyRecord.count({ where: { idempotencyKey: key } })).toBe(0);
    expect(await apiPrisma.transfer.count({ where: { sourceWalletId: holder.walletId } })).toBe(0);

    // The balance is untouched, which is the only statement that matters.
    const wallet = await apiPrisma.wallet.findUniqueOrThrow({ where: { id: holder.walletId } });
    expect(wallet.balanceMinor).toBe(5000n);
  });

  it("accepts a body just under the limit, so the limit is a limit and not a wall", async () => {
    // An unknown field, so this is a 400 from validation rather than a transfer: it proves
    // the parser read the body rather than refusing it on size.
    const response = await fetch(`${baseUrl}/transfers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${holder.token}`,
        "Idempotency-Key": "under-the-limit-key",
      },
      body: JSON.stringify({
        sourceWalletId: holder.walletId.toString(),
        destinationWalletId: stranger.walletId.toString(),
        amountMinor: "100",
        currency: "NGN",
        padding: "x".repeat(15_000),
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    expect(await apiPrisma.idempotencyRecord.count({ where: { idempotencyKey: "under-the-limit-key" } })).toBe(0);
  });
});

describe("someone else's record is refused in the same bytes as one that never existed", () => {
  it("answers GET /transfers/:id identically for a foreign, a missing and a malformed id", async () => {
    const list = await get("/transfers?limit=1", holder.token);
    const { transfers } = (await list.json()) as { transfers: { id: string }[] };
    const real = transfers[0]?.id;
    expect(real).toBeDefined();

    // The stranger can read their own history, so this is an authorisation refusal and not
    // an authentication one.
    expect((await get("/transfers", stranger.token)).status).toBe(200);

    const cases = {
      foreign: await get(`/transfers/${real}`, stranger.token),
      missing: await get("/transfers/999999999", stranger.token),
      malformed: await get("/transfers/not-an-id", stranger.token),
      outOfRange: await get("/transfers/9223372036854775808", stranger.token),
      zero: await get("/transfers/0", stranger.token),
    };

    const bodies: Record<string, unknown> = {};
    for (const [name, response] of Object.entries(cases)) {
      expect(response.status, name).toBe(404);
      const body = (await response.json()) as { error: Record<string, unknown> };
      // The request ID is per-request by design and is the one field allowed to differ.
      expect(typeof body.error.requestId, name).toBe("string");
      delete body.error.requestId;
      bodies[name] = body;
    }

    // Status, code and message all identical. A different message for a real id the caller
    // may not see would confirm the id exists, which is what the 404 is for.
    const reference = bodies.missing;
    expect(reference).toEqual({ error: { code: "TRANSFER_NOT_FOUND", message: "No such transfer." } });
    for (const [name, body] of Object.entries(bodies)) {
      expect(body, name).toEqual(reference);
    }
  });

  it("answers an admin restriction identically for a foreign, a missing and a malformed id", async () => {
    const cases = {
      missing: await fetch(`${baseUrl}/admin/users/999999999/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ reason: "no such user" }),
      }),
      malformed: await fetch(`${baseUrl}/admin/users/not-an-id/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ reason: "no such user" }),
      }),
      outOfRange: await fetch(`${baseUrl}/admin/users/9223372036854775808/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ reason: "no such user" }),
      }),
    };

    const bodies: Record<string, unknown> = {};
    for (const [name, response] of Object.entries(cases)) {
      // 404 and not 500: an id past the range of a BIGINT is answered, not thrown.
      expect(response.status, name).toBe(404);
      const body = (await response.json()) as { error: Record<string, unknown> };
      delete body.error.requestId;
      bodies[name] = body;
    }

    expect(bodies.missing).toEqual({ error: { code: "USER_NOT_FOUND", message: "No such user." } });
    for (const [name, body] of Object.entries(bodies)) {
      expect(body, name).toEqual(bodies.missing);
    }

    // Nothing was written on the way to any of those refusals.
    expect(await apiPrisma.adminAuditEntry.count()).toBe(0);
  });
});
