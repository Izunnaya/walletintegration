import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import type { Server } from "node:http";

vi.hoisted(() => {
  process.env.JWT_SECRET = "security-test-secret-never-for-production";
  process.env.TRUST_PROXY_HOPS = "0";
});
// No database call should be needed for security headers, parsing or invalid credentials.
vi.mock("../src/models/db.ts", () => ({ prisma: {}, databaseSchema: "public" }));
import app from "../src/app.ts";
let server: Server;
let base: string;
beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

describe("HTTP security boundary", () => {
  it("sends standard security headers and prevents storing authenticated responses", async () => {
    const response = await fetch(`${base}/wallets/me`);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-powered-by")).toBeNull();
    expect(response.headers.get("strict-transport-security")).toContain("max-age=");
  });
  it("rejects malformed and oversized JSON with a request ID", async () => {
    for (const [body, status, code] of [["{bad", 400, "MALFORMED_JSON"], [JSON.stringify({ name: "x".repeat(17_000) }), 413, "BODY_TOO_LARGE"]] as const) {
      const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code, requestId: response.headers.get("x-request-id") } });
    }
  });
  it("ignores forged forwarded headers when accessed directly", async () => {
    expect(app.get("trust proxy")).toBe(0);
    // No trusted proxy exists here; all 21 requests must share the actual socket IP.
    const statuses = [];
    for (let attempt = 0; attempt < 21; attempt++) {
      const response = await fetch(`${base}/auth/login`, { method: "POST", headers: {
        "Content-Type": "application/json", "X-Forwarded-For": `198.51.100.${attempt + 1}`,
      }, body: "{}" });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 20)).toEqual(Array(20).fill(400));
    expect(statuses[20]).toBe(429);
  });
  it("assigns a request ID to browser preflight responses", async () => {
    const response = await fetch(`${base}/transfers`, { method: "OPTIONS", headers: {
      Origin: "http://localhost:3000", "Access-Control-Request-Method": "POST",
    } });
    expect(response.status).toBe(204);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});
