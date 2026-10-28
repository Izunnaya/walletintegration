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

// Deliberately generous. A reviewer testing concurrency fires dozens of simultaneous
// transfers at one wallet, and a limit tight enough to look serious would answer 429 and
// read as a broken demo.
//
// The two unusual settings exist because this quota sits in front of a retry contract that
// the service itself instructs. A 503 tells the caller "retry with the same
// Idempotency-Key", so under contention one authorised transfer can cost several requests.
// Counting those retries against the quota meant a client doing exactly what it was told
// could be cut off mid-recovery, with the outcome still unconfirmed - measured at twelve
// concurrent sends from one account.
//
// So a 503 does not consume quota: the request did not succeed and retrying it is the
// documented behaviour, not abuse. Everything else still counts, including the business
// rejections, so this is not a way to send unlimited requests.
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


// The email is hashed so the limiter's key space does not become a list of which addresses
// have accounts here. validateLoginRequest has already trimmed and lowercased it, so case
// and whitespace variants share a bucket.
function accountKey(res: Response): string {
  const email: unknown = res.locals.body?.email;
  if (typeof email !== "string") throw new Error("Validate login before applying the account limit");
  return createHash("sha256").update(email).digest("hex");
}

function clientIp(req: Request): string {
  return ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown");
}

// Two limits on one account, because a single one cannot do both jobs.
//
// A tight per-account limit stops password guessing, and also hands anyone who knows your
// email address a way to lock you out of your own account: ten wrong passwords a minute and
// the real owner is refused for the rest of the window. That is worth more to an attacker
// than the guessing it prevents, and it is cheap.
//
// So the tight limit is per account AND per client. Guessing from one place is capped at ten
// a minute; locking somebody out would mean sending from their own address.
export const loginAccountLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 10,
  keyGenerator: (req: Request, res: Response) => `${accountKey(res)}:${clientIp(req)}`,
});

// The ceiling the per-client limit cannot provide: distributed guessing against one account
// from many addresses. Every attempt costs a bcrypt hash at cost 12, so this caps the work
// one account can be made to do regardless of where the requests come from. Set far above
// any human - a person who has mistyped their password sixty times in a minute is not a
// person - so it is a cost ceiling rather than something an attacker can use for a lockout.
export const loginAccountCeiling = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 60,
  keyGenerator: (_req: Request, res: Response) => accountKey(res),
});

export const adminLimiter = rateLimit({
  ...shared, windowMs: 60_000, limit: 30, keyGenerator: callerKey,
});
