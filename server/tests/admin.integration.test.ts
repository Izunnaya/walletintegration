import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import type { Server } from "node:http";
import { apiPrisma, prepareApiDatabase, closeApiDatabase } from "./apiDatabase.ts";
import * as restrictionLocks from "../src/models/transferLocks.ts";
import { hashPassword } from "../src/models/password.ts";

vi.mock("../src/models/db.ts", async () => {
  const { apiPrisma, apiSchema } = await import("./apiDatabase.ts");
  return { prisma: apiPrisma, databaseSchema: apiSchema };
});
vi.hoisted(() => {
  process.env.JWT_SECRET = "admin-integration-test-secret-not-for-production";
});
import app from "../src/app.ts";

let server: Server | undefined;
let baseUrl: string;

const password = "correct horse battery staple";
let adminToken: string;
let adminId: bigint;
let customerToken: string;
let customerId: bigint;

async function createUser(email: string, role: "customer" | "admin") {
  const user = await apiPrisma.user.create({
    data: { email, name: email, passwordHash: await hashPassword(password), role },
  });
  await apiPrisma.wallet.create({ data: { ownerId: user.id } });

  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { token?: string };

  return { id: user.id, token: body.token ?? "" };
}

function restrict(action: "block" | "unblock", id: bigint | string, token: string, body: unknown) {
  return fetch(`${baseUrl}/admin/users/${id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await prepareApiDatabase();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const admin = await createUser("admin@example.com", "admin");
  adminToken = admin.token;
  adminId = admin.id;

  const customer = await createUser("customer@example.com", "customer");
  customerToken = customer.token;
  customerId = customer.id;
});

afterAll(async () => {
  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
  } finally {
    await closeApiDatabase();
  }
});

describe("admin authorisation", () => {
  it.each(["demoted", "blocked"])("refuses an admin %s after the initial permission check", async (change) => {
    const actor = await createUser(`${change}-during-request@example.com`, "admin");
    let entered!: () => void;
    let release!: () => void;
    const reachedLock = new Promise<void>((resolve) => { entered = resolve; });
    const continueRequest = new Promise<void>((resolve) => { release = resolve; });
    const original = restrictionLocks.lockUsersForRestriction;
    const lock = vi.spyOn(restrictionLocks, "lockUsersForRestriction").mockImplementationOnce(async (...args) => {
      entered();
      await continueRequest;
      return original(...args);
    });
    const before = await apiPrisma.adminAuditEntry.count();
    const pending = restrict("block", customerId, actor.token, { reason: "Review account" });
    try {
      await reachedLock;
      await apiPrisma.user.update({
        where: { id: actor.id },
        data: change === "demoted" ? { role: "customer" } : { isBlocked: true },
      });
      release();
      expect((await pending).status).toBe(403);
      expect((await apiPrisma.user.findUniqueOrThrow({ where: { id: customerId } })).isBlocked).toBe(false);
      expect(await apiPrisma.adminAuditEntry.count()).toBe(before);
    } finally {
      release();
      await pending;
      lock.mockRestore();
    }
  });

  it("refuses a customer with 403, and leaves the account untouched", async () => {
    const response = await restrict("block", adminId, customerToken, { reason: "escalating" });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });

    const admin = await apiPrisma.user.findUniqueOrThrow({ where: { id: adminId } });
    expect(admin.isBlocked).toBe(false);
  });

  it("refuses an unauthenticated request with 401", async () => {
    const response = await fetch(`${baseUrl}/admin/users/${customerId}/block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "no token" }),
    });

    expect(response.status).toBe(401);
  });

  it("refuses the audit trail to a customer", async () => {
    const response = await fetch(`${baseUrl}/admin/audit`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });

    expect(response.status).toBe(403);
  });
});

describe("blocking and unblocking", () => {
  it("requires a reason, and writes nothing without one", async () => {
    const before = await apiPrisma.adminAuditEntry.count();

    for (const body of [{}, { reason: "" }, { reason: "  " }, { reason: "ab" }]) {
      const response = await restrict("block", customerId, adminToken, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }

    // The audit trail exists to answer who, when and why. A rejected attempt is not a
    // restriction change, so it leaves no row.
    expect(await apiPrisma.adminAuditEntry.count()).toBe(before);
  });

  it("refuses an unknown field in the body", async () => {
    const response = await restrict("block", customerId, adminToken, {
      reason: "valid reason here",
      isBlocked: false,
    });

    expect(response.status).toBe(400);
  });

  it("blocks, and commits the audit row in the same transaction", async () => {
    const response = await restrict("block", customerId, adminToken, {
      reason: "Suspicious activity during review",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { id: customerId.toString(), isBlocked: true },
      changed: true,
    });

    const user = await apiPrisma.user.findUniqueOrThrow({ where: { id: customerId } });
    expect(user.isBlocked).toBe(true);

    // The restriction and its record arrive together: there is no state where one exists
    // without the other.
    const entry = await apiPrisma.adminAuditEntry.findFirstOrThrow({
      where: { affectedUserId: customerId, action: "block" },
      orderBy: { id: "desc" },
    });
    expect(entry.actorUserId).toBe(adminId);
    expect(entry.reason).toBe("Suspicious activity during review");
  });

  it("stops a blocked account logging in", async () => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "customer@example.com", password }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "ACCOUNT_BLOCKED" } });
  });

  it("blocking an already blocked account changes nothing and writes no audit row", async () => {
    const before = await apiPrisma.adminAuditEntry.count();

    const response = await restrict("block", customerId, adminToken, { reason: "again" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ changed: false });
    expect(await apiPrisma.adminAuditEntry.count()).toBe(before);
  });

  it("unblocks, and says that a blacklist is not lifted by it", async () => {
    const response = await restrict("unblock", customerId, adminToken, { reason: "Review cleared" });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { changed: boolean; note?: string };
    expect(body.changed).toBe(true);
    // The rule most likely to surprise an admin who has just unblocked someone and found
    // they still cannot transfer.
    expect(body.note).toMatch(/blacklist/i);

    const user = await apiPrisma.user.findUniqueOrThrow({ where: { id: customerId } });
    expect(user.isBlocked).toBe(false);
  });

  it("refuses an admin restricting themselves", async () => {
    const response = await restrict("block", adminId, adminToken, { reason: "locking myself out" });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "CANNOT_RESTRICT_SELF" } });

    const admin = await apiPrisma.user.findUniqueOrThrow({ where: { id: adminId } });
    expect(admin.isBlocked).toBe(false);
  });

  it("answers 404 for a user that does not exist, and for an id that is not one", async () => {
    for (const id of ["999999999", "abc", "-1", "0", "9223372036854775808"]) {
      const response = await restrict("block", id, adminToken, { reason: "no such user" });
      expect(response.status, id).toBe(404);
    }
  });
});

describe("GET /admin/audit", () => {
  it("denies a previously issued admin token after demotion or blocking", async () => {
    const actor = await createUser("former-admin@example.com", "admin");
    const headers = { Authorization: `Bearer ${actor.token}` };
    await apiPrisma.user.update({ where: { id: actor.id }, data: { role: "customer" } });
    expect((await fetch(`${baseUrl}/admin/audit`, { headers })).status).toBe(403);
    await apiPrisma.user.update({ where: { id: actor.id }, data: { role: "admin", isBlocked: true } });
    expect((await fetch(`${baseUrl}/admin/audit`, { headers })).status).toBe(403);
  });
  it("returns the trail with actor, affected and reason, newest first", async () => {
    const response = await fetch(`${baseUrl}/admin/audit`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: { id: string; action: string; reason: string | null; actor: { email: string }; affected: { email: string } }[];
    };

    expect(body.entries.length).toBeGreaterThanOrEqual(2);
    expect(body.entries[0]).toMatchObject({
      action: "unblock",
      reason: "Review cleared",
      actor: { email: "admin@example.com" },
      affected: { email: "customer@example.com" },
    });

    const ids = body.entries.map((entry) => BigInt(entry.id));
    const descending = [...ids].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
    expect(ids).toEqual(descending);
  });

  it("bounds admin requests and supplies Retry-After when the quota is exhausted", async () => {
    let limited: Response | undefined;
    for (let count = 0; count < 31; count++) {
      const response = await fetch(`${baseUrl}/admin/audit`, { headers: { Authorization: `Bearer ${adminToken}` } });
      if (response.status === 429) { limited = response; break; }
      expect(response.status).toBe(200);
    }
    expect(limited?.status).toBe(429);
    expect(Number(limited?.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
