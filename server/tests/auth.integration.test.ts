import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import type { Server } from "node:http";
import { authPrisma, prepareAuthDatabase, closeAuthDatabase, failWalletCreation } from "./authDatabase.ts";

// Replace only the database connection: queries and transactions use real PostgreSQL.
vi.mock("../src/models/db.ts", async () => {
  const { authPrisma } = await import("./authDatabase.ts");
  return { prisma: authPrisma };
});
vi.hoisted(() => { process.env.JWT_SECRET = "auth-integration-test-secret-not-for-production"; });
import app from "../src/app.ts";

let server: Server | undefined;
let baseUrl: string;
const password = "correct horse battery staple";

beforeAll(async () => {
  await prepareAuthDatabase();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  try {
    if (server) await new Promise<void>((resolve, reject) => {
      server?.close((error) => error ? reject(error) : resolve());
    });
  } finally {
    await closeAuthDatabase();
  }
});

function post(path: string, body: unknown) {
  return fetch(`${baseUrl}/auth/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("auth HTTP flows with PostgreSQL", () => {
  it("normalizes registration, creates one empty customer wallet and logs in", async () => {
    const response = await post("register", { email: "  NEW@Example.COM  ", name: " New User ", password });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      user: { email: "new@example.com", name: "New User", role: "customer" },
      wallet: { currency: "NGN", balanceMinor: "0" },
    });
    const user = await authPrisma.user.findUniqueOrThrow({ where: { email: "new@example.com" }, include: { wallets: true } });
    expect(user.wallets).toHaveLength(1);
    expect(user.passwordHash).not.toBe(password);
    const login = await post("login", { email: " NEW@EXAMPLE.COM ", password });
    expect(login.status).toBe(200);
    const session = await login.json();
    const wallet = await fetch(`${baseUrl}/wallets/me`, { headers: { Authorization: `Bearer ${session.token}` } });
    expect(wallet.status).toBe(200);
    expect(await wallet.json()).toMatchObject({ id: user.wallets[0]?.id.toString(), balanceMinor: "0" });
  });

  it("rejects normalized blacklist matches and privileged fields without creating users", async () => {
    await authPrisma.blacklistEntry.create({ data: { email: "denied@example.com", reason: "test" } });
    const blocked = await post("register", { email: " DENIED@Example.COM ", name: "Denied", password });
    expect(blocked.status).toBe(422);
    expect(await blocked.json()).toMatchObject({ error: { code: "EMAIL_BLACKLISTED", requestId: expect.any(String) } });
    const privileged = await post("register", { email: "privileged@example.com", name: "Test", password, role: "admin" });
    expect(privileged.status).toBe(400);
    expect(await authPrisma.user.count({ where: { email: { in: ["denied@example.com", "privileged@example.com"] } } })).toBe(0);
  });

  it("returns 409 for a duplicate normalized email without creating another wallet", async () => {
    const body = { email: "duplicate@example.com", name: "Duplicate", password };
    expect((await post("register", body)).status).toBe(201);
    const duplicate = await post("register", { ...body, email: " DUPLICATE@EXAMPLE.COM " });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: { code: "EMAIL_TAKEN" } });
    expect(await authPrisma.wallet.count({ where: { owner: { email: body.email } } })).toBe(1);
  });

  it("rejects wrong passwords, unknown accounts and blocked accounts without issuing tokens", async () => {
    const email = "blocked@example.com";
    expect((await post("register", { email, name: "Blocked", password })).status).toBe(201);
    for (const credentials of [{ email, password: "wrong" }, { email: "absent@example.com", password }]) {
      const response = await post("login", credentials);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_CREDENTIALS");
      expect(body.token).toBeUndefined();
    }
    await authPrisma.user.update({ where: { email }, data: { isBlocked: true } });
    const response = await post("login", { email, password });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("ACCOUNT_BLOCKED");
    expect(body.token).toBeUndefined();
  });

  it("rolls back the user when PostgreSQL rejects wallet creation", async () => {
    await failWalletCreation(true);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await post("register", { email: "rollback@example.com", name: "Rollback", password });
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
      expect(await authPrisma.user.count({ where: { email: "rollback@example.com" } })).toBe(0);
      expect(await authPrisma.wallet.count({ where: { owner: { email: "rollback@example.com" } } })).toBe(0);
    } finally {
      log.mockRestore();
      await failWalletCreation(false);
    }
  });
});
