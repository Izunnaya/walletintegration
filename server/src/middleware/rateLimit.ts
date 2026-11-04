import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";

// In-memory counters are for one process only. Multiple replicas require a shared store.
// IP correctness depends on TRUST_PROXY_HOPS matching the deployed ingress chain.

function refuseWith(message: string) {
  return (req: Request, res: Response) => {
    res.status(429).json({
      error: { code: "RATE_LIMITED", message, requestId: req.requestId },
    });
  };
}

const refusal = refuseWith("Too many requests. Slow down and try again.");

// Keyed by account once authenticated, falling back to IP. Without the fallback an
// unauthenticated flood would share one bucket and lock everyone out together.
function callerKey(req: Request): string {
  return req.caller ? `user:${req.caller.userId}` : `ip:${ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown")}`;
}

const shared = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: refusal,
};

// 503 retries keep the same transfer key and do not consume this quota.
export const transferLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 60,
  keyGenerator: callerKey,
  skipFailedRequests: true,
  requestWasSuccessful: (_req: Request, res: Response) => res.statusCode !== 503,
  // The generic wording would be wrong here. A caller refused mid-retry has to know the key
  // is still the right one to use, or they start a new transfer and lose the guarantee.
  handler: refuseWith(
    "Too many transfers. Wait for Retry-After, then retry with the same Idempotency-Key.",
  ),
});

export const authLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 20,
  // Always by IP. Keying a login attempt by account would let someone try one password
  // against a thousand accounts without ever filling a bucket.
  keyGenerator: (req: Request) => `ip:${ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown")}`,
});

export const readLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 240,
  keyGenerator: callerKey,
});

function accountKey(res: Response): string {
  const email: unknown = res.locals.body?.email;
  if (typeof email !== "string") throw new Error("Validate login before applying the account limit");
  return createHash("sha256").update(email).digest("hex");
}

function clientIp(req: Request): string {
  return ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown");
}

// Limit attempts per account and client; use a separate account-wide ceiling.
export const loginAccountLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 10,
  keyGenerator: (req: Request, res: Response) => `${accountKey(res)}:${clientIp(req)}`,
});

// Cap distributed login attempts against one account.
export const loginAccountCeiling = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 60,
  keyGenerator: (_req: Request, res: Response) => accountKey(res),
});

export const adminLimiter = rateLimit({
  ...shared, windowMs: 60_000, limit: 30, keyGenerator: callerKey,
});
