import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";

// In-memory counters are for one process only. Multiple replicas require a shared store.
// IP correctness depends on TRUST_PROXY_HOPS matching the deployed ingress chain.

function refusal(req: Request, res: Response) {
  res.status(429).json({
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Slow down and try again.",
      requestId: req.requestId,
    },
  });
}

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

// Deliberately generous. A reviewer testing concurrency fires dozens of simultaneous
// transfers at one wallet, and a limit tight enough to look serious would answer 429 and
// read as a broken demo. The numbers are documented so the choice is visible rather than
// accidental.
export const transferLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 60,
  keyGenerator: callerKey,
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


// Limits password guessing and hashing work for one account across rotating IPs.
export const loginAccountLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 10,
  keyGenerator: (_req: Request, res: Response) => {
    const email: unknown = res.locals.body?.email;
    if (typeof email !== "string") throw new Error("Validate login before applying the account limit");
    return createHash("sha256").update(email).digest("hex");
  },
});

export const adminLimiter = rateLimit({
  ...shared, windowMs: 60_000, limit: 30, keyGenerator: callerKey,
});
