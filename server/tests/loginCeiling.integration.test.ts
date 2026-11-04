import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import type { Server } from "node:http";
import { prepareApiDatabase, closeApiDatabase } from "./apiDatabase.ts";

vi.mock("../src/models/db.ts", async () => {
  const { apiPrisma, apiSchema } = await import("./apiDatabase.ts");
  return { prisma: apiPrisma, databaseSchema: apiSchema };
});
vi.hoisted(() => {
  process.env.JWT_SECRET = "login-ceiling-test-secret-not-for-production";
  process.env.TRUST_PROXY_HOPS = "1";
});
import app from "../src/app.ts";

const CEILING = 60;
const PER_CLIENT = 10;

let server: Server | undefined;
let baseUrl: string;

beforeAll(async () => {
  await prepareApiDatabase();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
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

function login(clientIp: string, email: string) {
  return fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": clientIp },
    body: JSON.stringify({ email, password: "wrong password" }),
  });
}

describe("the per-account login ceiling", () => {
  it("caps total attempts on one account across many clients", async () => {
    const statuses: number[] = [];

    for (let client = 0; client < 8 && !statuses.includes(429); client += 1) {
      for (let attempt = 0; attempt < 9; attempt += 1) {
        const response = await login(`10.40.${client}.1`, "ceiling@example.com");
        statuses.push(response.status);
        if (response.status === 429) break;
      }
    }

    const firstRefusal = statuses.indexOf(429);
    expect(firstRefusal, "the account ceiling never refused").toBeGreaterThan(-1);

    // Above the per-client limit, which is what proves the ceiling refused this and not the
    // tighter per-account-and-client limit.
    expect(firstRefusal).toBeGreaterThan(PER_CLIENT);
    expect(firstRefusal).toBeGreaterThanOrEqual(CEILING);
  });

  it("does not spend another account's allowance", async () => {
    // A fresh address and a different account, after the ceiling above has been exhausted.
    const response = await login("10.41.0.1", "untouched@example.com");
    expect(response.status).toBe(401);
  });
});
