import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import type { Server } from "node:http";
import { apiPrisma, prepareApiDatabase, closeApiDatabase } from "./apiDatabase.ts";

vi.mock("../src/models/db.ts", async () => {
  const { apiPrisma, apiSchema } = await import("./apiDatabase.ts");
  return { prisma: apiPrisma, databaseSchema: apiSchema };
});
vi.hoisted(() => {
  process.env.JWT_SECRET = "cors-integration-test-secret-not-for-production";
  // Set before app.ts loads, because the allowlist is read once at import.
  process.env.CORS_ORIGINS = "https://wallet.example.com,http://localhost:3001";
});
import app from "../src/app.ts";

// These test the two things that break a browser client while curl keeps working, because
// curl sends no preflight and ignores the response-header safelist. Neither failure is
// visible from the terminal, which is why they are pinned here.

let server: Server | undefined;
let baseUrl: string;

const allowed = "https://wallet.example.com";

beforeAll(async () => {
  await prepareApiDatabase();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  expect(apiPrisma).toBeDefined();
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

describe("preflight", () => {
  it("allows Idempotency-Key, without which no transfer can be sent from a browser", async () => {
    const response = await fetch(`${baseUrl}/transfers`, {
      method: "OPTIONS",
      headers: {
        Origin: allowed,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,idempotency-key",
      },
    });

    expect(response.status).toBeLessThan(300);

    const headers = response.headers.get("access-control-allow-headers") ?? "";
    // The browser refuses the real request unless the server names every custom header it
    // intends to send. Idempotency-Key is custom, so omitting it fails every transfer from
    // the UI while curl succeeds.
    expect(headers.toLowerCase()).toContain("idempotency-key");
    expect(headers.toLowerCase()).toContain("authorization");
  });

  it("allows the methods the API actually uses", async () => {
    const response = await fetch(`${baseUrl}/transfers`, {
      method: "OPTIONS",
      headers: { Origin: allowed, "Access-Control-Request-Method": "POST" },
    });

    const methods = (response.headers.get("access-control-allow-methods") ?? "").toLowerCase();
    expect(methods).toContain("post");
    expect(methods).toContain("get");
  });

  it("is cached, so a browser does not ask again on every transfer", async () => {
    const response = await fetch(`${baseUrl}/transfers`, {
      method: "OPTIONS",
      headers: { Origin: allowed, "Access-Control-Request-Method": "POST" },
    });

    expect(Number(response.headers.get("access-control-max-age"))).toBeGreaterThan(0);
  });
});

describe("response headers a client has to read", () => {
  it("exposes X-Request-Id, without which the error contract is unreadable in a browser", async () => {
    const response = await fetch(`${baseUrl}/health/live`, { headers: { Origin: allowed } });

    const exposed = (response.headers.get("access-control-expose-headers") ?? "").toLowerCase();
    // A browser hides every response header outside a short safelist from JavaScript, so
    // response.headers.get("X-Request-Id") returns null unless the server permits it. That
    // id is what a user quotes when a transfer fails.
    expect(exposed).toContain("x-request-id");
  });

  it("exposes Retry-After and the rate limit counters", async () => {
    const response = await fetch(`${baseUrl}/health/live`, { headers: { Origin: allowed } });

    const exposed = (response.headers.get("access-control-expose-headers") ?? "").toLowerCase();
    expect(exposed).toContain("retry-after");
    expect(exposed).toContain("ratelimit-remaining");
  });
});

describe("the allowlist", () => {
  it("permits a configured origin", async () => {
    const response = await fetch(`${baseUrl}/health/live`, { headers: { Origin: allowed } });

    expect(response.headers.get("access-control-allow-origin")).toBe(allowed);
  });

  it("permits every origin named in CORS_ORIGINS, not only the first", async () => {
    const response = await fetch(`${baseUrl}/health/live`, {
      headers: { Origin: "http://localhost:3001" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3001");
  });

  it("refuses an origin that is not on the list, by omitting the header", async () => {
    const response = await fetch(`${baseUrl}/health/live`, {
      headers: { Origin: "https://evil.example.com" },
    });

    // The refusal is the absent header: the browser blocks the read. The request itself
    // still succeeds, because CORS is enforced in the browser and not by the server.
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("is not a wildcard", async () => {
    const response = await fetch(`${baseUrl}/health/live`, { headers: { Origin: allowed } });

    // A wallet API should not be callable from any page on the internet.
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("serves a request with no Origin at all, which is curl and the health checks", async () => {
    const response = await fetch(`${baseUrl}/health/live`);

    // CORS is a browser mechanism. A caller that sends no Origin has nothing to enforce.
    expect(response.status).toBe(200);
  });
});
