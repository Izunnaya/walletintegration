import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { once } from "node:events";
import { Writable } from "node:stream";
import type { Server } from "node:http";
import express from "express";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { loggerOptions, httpLoggerOptions } from "../src/logger.ts";
import { attachRequestId } from "../src/middleware/requestId.ts";

// These tests run the real options objects - the same redact paths, serializers, genReqId
// and customLogLevel the service uses - against a logger that writes into an array instead
// of stdout. Rebuilding the options would test a copy; importing them tests the thing.
//
// No database is involved, so this file is fast and runs with the unit tests.

const lines: string[] = [];

const sink = new Writable({
  write(chunk, _encoding, callback) {
    for (const line of String(chunk).split("\n")) if (line.trim()) lines.push(line);
    callback();
  },
});

const testLogger = pino({ ...loggerOptions, level: "info" }, sink);

const app = express();
// The same setting the real app uses, because req.ip depends on it and this file asserts
// on req.ip.
app.set("trust proxy", 1);
app.use(attachRequestId);
app.use(pinoHttp({ ...httpLoggerOptions, logger: testLogger }));
app.get("/ok", (_req, res) => void res.json({ status: "ok" }));
app.get("/bad", (_req, res) => void res.status(400).json({ error: "no" }));
app.get("/boom", (_req, res) => void res.status(500).json({ error: "ours" }));
app.get("/health/ready", (_req, res) => void res.json({ status: "ready" }));

let server: Server | undefined;
let baseUrl: string;

type Line = Record<string, unknown> & {
  msg?: string;
  level?: string;
  req?: { id?: string; ip?: string; forwardedFor?: string };
};

// pino-http writes when the response finishes, which is after fetch has already resolved.
async function waitForLine(match: (line: Line) => boolean): Promise<Line | undefined> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = lines.map((line) => JSON.parse(line) as Line).find(match);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return undefined;
}

beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

describe("every line is structured", () => {
  it("writes one JSON object per request, not free text", async () => {
    const response = await fetch(`${baseUrl}/ok`);
    const requestId = response.headers.get("x-request-id") ?? "";

    const line = await waitForLine((entry) => entry.req?.id === requestId);

    // The whole point of the spec asking for structured logs: a log search can filter on
    // these fields. Free text cannot be filtered, only grepped.
    expect(line).toBeDefined();
    expect(line?.msg).toBe("request_completed");
    expect(line?.level).toBe("info");
    expect(line).toMatchObject({
      req: { method: "GET", url: "/ok" },
      res: { statusCode: 200 },
    });
    expect(typeof line?.responseTime).toBe("number");
  });

  it("carries the same request ID the caller was given in X-Request-Id", async () => {
    const response = await fetch(`${baseUrl}/ok`);
    const requestId = response.headers.get("x-request-id") ?? "";

    expect(requestId).not.toBe("");

    // This is the link that makes the error contract usable. A user reports a failure by
    // quoting the ID from the response; that ID has to be the one in the log. Letting
    // pino-http generate its own would produce two unrelated IDs and look fine in tests.
    const line = await waitForLine((entry) => entry.req?.id === requestId);
    expect(line).toBeDefined();
  });

  it("renders the level as a word rather than pino's number", async () => {
    await fetch(`${baseUrl}/ok`);
    const line = await waitForLine((entry) => entry.level === "info");

    expect(line).toBeDefined();
  });
});

describe("the rate limiter is auditable from the log", () => {
  it("records both req.ip and the raw X-Forwarded-For, so a wrong hop count is visible", async () => {
    // The limiter keys on req.ip. req.ip depends on the "trust proxy" hop count matching the
    // platform, and when it does not, Express reports the proxy and every caller shares one
    // bucket while the response counters still look plausible. These two fields side by side
    // are the only way to see that from a log: when they disagree about who the caller is,
    // the hop count is wrong. This app sets trust proxy to 1, so with one forwarded entry
    // req.ip is the caller.
    const response = await fetch(`${baseUrl}/ok`, {
      headers: { "X-Forwarded-For": "203.0.113.9" },
    });
    const requestId = response.headers.get("x-request-id") ?? "";

    const line = await waitForLine((entry) => entry.req?.id === requestId);

    // With trust proxy 1 and a single forwarded entry, req.ip is the caller. Add a second
    // entry - which is what a platform proxy does - and req.ip becomes that proxy instead.
    // That is the bug this pair of fields exists to expose.
    expect(line?.req).toMatchObject({ forwardedFor: "203.0.113.9", ip: "203.0.113.9" });
    expect(typeof (line?.req as { remoteAddress?: unknown })?.remoteAddress).toBe("string");
  });
});

describe("severity follows whose fault it is", () => {
  it("logs a 4xx as a warning, because it is the caller's mistake", async () => {
    const response = await fetch(`${baseUrl}/bad`);
    const requestId = response.headers.get("x-request-id") ?? "";

    const line = await waitForLine((entry) => entry.req?.id === requestId);
    expect(line?.level).toBe("warn");
  });

  it("logs a 5xx as an error, because it is ours", async () => {
    const response = await fetch(`${baseUrl}/boom`);
    const requestId = response.headers.get("x-request-id") ?? "";

    const line = await waitForLine((entry) => entry.req?.id === requestId);
    expect(line?.level).toBe("error");
  });
});

describe("credentials never reach the log", () => {
  it("does not write the Authorization header, which is a usable bearer token", async () => {
    const response = await fetch(`${baseUrl}/ok`, {
      headers: { Authorization: "Bearer super-secret-token-value" },
    });
    const requestId = response.headers.get("x-request-id") ?? "";

    const line = await waitForLine((entry) => entry.req?.id === requestId);
    expect(line).toBeDefined();

    // A token in a log aggregator is readable by far more people than can read the database,
    // and stays valid until it expires. pino-http logs the full header set by default, so
    // this is a thing we turned off rather than a thing we never turned on.
    expect(JSON.stringify(line)).not.toContain("super-secret-token-value");
  });

  it("redacts an Authorization header even if the serializer is ever widened", async () => {
    // Two independent defences. The serializer keeps headers out; redact censors the value
    // if someone later adds them back. Tested separately so removing one is a visible break.
    testLogger.info({ req: { headers: { authorization: "Bearer another-secret" } } }, "direct");

    const line = await waitForLine((entry) => entry.msg === "direct");

    expect(JSON.stringify(line)).not.toContain("another-secret");
    expect(JSON.stringify(line)).toContain("[redacted]");
  });
});

describe("noise", () => {
  it("does not log the health check Render calls every few seconds", async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    const requestId = response.headers.get("x-request-id") ?? "";

    expect(response.status).toBe(200);

    // Give it the same chance to appear as any other line, then require that it did not.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const logged = lines.map((line) => JSON.parse(line) as Line).some((entry) => entry.req?.id === requestId);
    expect(logged).toBe(false);
  });
});

describe("errors", () => {
  it("serialises an Error into message and stack rather than an empty object", async () => {
    // JSON.stringify(new Error("x")) is "{}" - message and stack are not enumerable. An
    // error logged under any key but err would be written as {} and tell a reader nothing.
    testLogger.error({ requestId: "test-id", err: new Error("the database went away") }, "request_failed");

    const line = await waitForLine((entry) => entry.msg === "request_failed");

    expect(line).toMatchObject({
      requestId: "test-id",
      err: { type: "Error", message: "the database went away" },
    });
    expect(typeof (line?.err as { stack?: unknown })?.stack).toBe("string");
  });
});
