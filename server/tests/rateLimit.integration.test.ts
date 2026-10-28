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
  process.env.JWT_SECRET = "ratelimit-integration-test-secret-not-for-production";
  process.env.TRUST_PROXY_HOPS = "1";
});
import app from "../src/app.ts";

// The limiter keeps its counts in memory for the life of the process, so every test here
// uses a distinct X-Forwarded-For address as its bucket. The app sets trust proxy to 1, so
// that header is what the IP-keyed limiter reads — which is also what makes these tests
// prove the trust-proxy setting works, not just the limits.
//
// Without a distinct address per test, one test filling a bucket would make the next fail
// for reasons that have nothing to do with it.

let server: Server | undefined;
let baseUrl: string;

const password = "correct horse battery staple";
const AUTH_LIMIT = 20;
const READ_LIMIT = 240;

let token: string;

function login(ip: string, body?: unknown) {
  return fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify(body ?? {}),
  });
}

beforeAll(async () => {
  await prepareApiDatabase();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await apiPrisma.user.create({
    data: {
      email: "limited@example.com",
      name: "Limited",
      passwordHash: await hashPassword(password),
      role: "customer",
    },
  });
  await apiPrisma.wallet.create({ data: { ownerId: user.id } });

  const response = await login("10.0.0.1", { email: "limited@example.com", password });
  const body = (await response.json()) as { token: string };
  token = body.token;
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

describe("auth rate limit", () => {
  // This replaces a test that asserted ten failures from ten DIFFERENT addresses locked the
  // account out from a fresh address. That was the behaviour, and it was a denial of service:
  // anyone who knew an email address could keep its owner locked out for about ten requests a
  // minute. The tight limit is per account AND per client now, so these two tests assert the
  // guessing is still capped and the owner is not collateral.
  it("caps guessing one account from one client, and normalises the email", async () => {
    const client = "10.9.0.1";

    for (let attempt = 0; attempt < 10; attempt++) {
      // Case and surrounding whitespace vary deliberately: these must share one bucket, or
      // the limit is trivially bypassed by sending "Target@" then "target@".
      const email = attempt % 2 === 0 ? "  LOCKOUT@example.com " : "lockout@example.com";
      expect((await login(client, { email, password: "wrong password" })).status).toBe(401);
    }

    const refused = await login(client, { email: "lockout@example.com", password: "wrong password" });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);

    // The point of the fix. The same account, from somewhere else, is still reachable - so
    // the real owner can still sign in while somebody guesses at them from one address.
    expect((await login("10.9.9.9", { email: "lockout@example.com", password: "wrong password" })).status).toBe(401);

    // And a different account from the exhausted client is unaffected.
    expect((await login(client, { email: "bystander@example.com", password: "wrong password" })).status).toBe(401);
  });

  it("caps total attempts on one account across many clients", async () => {
    // The ceiling the per-client limit cannot provide: distributed guessing. Every attempt
    // costs a bcrypt hash, so this bounds the work one account can be made to do. Nine
    // attempts per address keeps each client under both its own account limit and the
    // per-IP auth limit, so the only thing that can refuse this is the ceiling.
    const statuses: number[] = [];

    for (let client = 0; client < 8 && !statuses.includes(429); client++) {
      for (let attempt = 0; attempt < 9; attempt++) {
        const response = await login(`10.20.${client}.1`, {
          email: "ceiling@example.com",
          password: "wrong password",
        });
        statuses.push(response.status);
        if (response.status === 429) break;
      }
    }

    const firstRefusal = statuses.indexOf(429);
    expect(firstRefusal, "the account ceiling never refused").toBeGreaterThan(-1);
    // Above the per-client limit, which proves the ceiling refused it and not the tight one.
    expect(firstRefusal).toBeGreaterThan(10);
  });

  it("aggregates IPv6 clients in the same /56 subnet", async () => {
    for (let attempt = 0; attempt < AUTH_LIMIT; attempt++) {
      expect((await login(`2001:db8:abcd:1200::${attempt + 1}`)).status).toBe(400);
    }
    expect((await login("2001:db8:abcd:12ff::ffff")).status).toBe(429);
    expect((await login("2001:db8:abcd:1300::1")).status).toBe(400);
  });

  it("reuses the client bucket when spoofed addresses are prepended before the trusted proxy", async () => {
    for (let attempt = 0; attempt < AUTH_LIMIT; attempt++) {
      await login(`198.51.100.${attempt + 1}, 203.0.113.81`);
    }
    expect((await login("198.51.100.222, 203.0.113.81")).status).toBe(429);
  });
  it("allows exactly the limit, then refuses with 429 and a stable error shape", async () => {
    const ip = "10.1.0.1";
    const statuses: number[] = [];

    for (let attempt = 0; attempt < AUTH_LIMIT + 3; attempt += 1) {
      const response = await login(ip);
      statuses.push(response.status);
      if (response.status === 429) {
        expect(await response.json()).toMatchObject({
          error: { code: "RATE_LIMITED" },
        });
      }
    }

    // Exactly the limit answered normally; everything after it was refused.
    expect(statuses.filter((status) => status !== 429)).toHaveLength(AUTH_LIMIT);
    expect(statuses.slice(AUTH_LIMIT)).toEqual([429, 429, 429]);
  });

  it("carries the standard RateLimit headers", async () => {
    const response = await login("10.1.0.2");

    expect(response.headers.get("ratelimit-limit")).toBe(String(AUTH_LIMIT));
    expect(response.headers.get("ratelimit-remaining")).toBe(String(AUTH_LIMIT - 1));
    expect(response.headers.get("ratelimit-reset")).not.toBeNull();
    // Deprecated headers are off, so a client reads one scheme rather than guessing.
    expect(response.headers.get("x-ratelimit-limit")).toBeNull();
  });

  it("counts a different address separately, which is what trust proxy makes possible", async () => {
    const exhausted = "10.1.0.3";
    for (let attempt = 0; attempt < AUTH_LIMIT; attempt += 1) await login(exhausted);

    expect((await login(exhausted)).status).toBe(429);

    // A different caller is unaffected. If trust proxy were off, both would share the
    // socket's address and this would be 429 too.
    expect((await login("10.1.0.4")).status).not.toBe(429);
  });

  it("counts registration against the same bucket as login", async () => {
    const ip = "10.1.0.5";
    for (let attempt = 0; attempt < AUTH_LIMIT; attempt += 1) await login(ip);

    // Both are auth endpoints and share one limiter: filling the bucket with logins must
    // also close registration, or the limit is trivially sidestepped.
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify({ email: "fresh@example.com", name: "Fresh", password }),
    });

    expect(response.status).toBe(429);
  });
});

describe("read rate limit", () => {
  it("is far looser than the auth limit, so ordinary browsing is unaffected", async () => {
    const ip = "10.2.0.1";
    const statuses: number[] = [];

    // Comfortably past the auth limit, nowhere near the read limit.
    for (let attempt = 0; attempt < AUTH_LIMIT + 10; attempt += 1) {
      const response = await fetch(`${baseUrl}/wallets/me`, {
        headers: { Authorization: `Bearer ${token}`, "X-Forwarded-For": ip },
      });
      statuses.push(response.status);
    }

    expect(statuses.every((status) => status === 200)).toBe(true);
    expect(READ_LIMIT).toBeGreaterThan(AUTH_LIMIT);
  });

  it("keys an authenticated read by account, not by address", async () => {
    // Same token, two addresses: the counts follow the account, so the remaining count
    // keeps falling rather than resetting per address.
    const first = await fetch(`${baseUrl}/wallets/me`, {
      headers: { Authorization: `Bearer ${token}`, "X-Forwarded-For": "10.3.0.1" },
    });
    const second = await fetch(`${baseUrl}/wallets/me`, {
      headers: { Authorization: `Bearer ${token}`, "X-Forwarded-For": "10.3.0.2" },
    });

    const firstRemaining = Number(first.headers.get("ratelimit-remaining"));
    const secondRemaining = Number(second.headers.get("ratelimit-remaining"));

    expect(secondRemaining).toBe(firstRemaining - 1);
  });
});

describe("health checks", () => {
  it("are not rate limited, so a monitor cannot lock itself out", async () => {
    const ip = "10.4.0.1";
    const statuses: number[] = [];

    for (let attempt = 0; attempt < AUTH_LIMIT + 5; attempt += 1) {
      const response = await fetch(`${baseUrl}/health/live`, {
        headers: { "X-Forwarded-For": ip },
      });
      statuses.push(response.status);
    }

    // Render polls the health check continuously. A limit here would take the service down
    // for failing its own check.
    expect(statuses.every((status) => status === 200)).toBe(true);
  });
});
