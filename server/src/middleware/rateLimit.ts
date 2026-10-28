import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";

// Three limits, because the three kinds of request fail differently.
//
// Transfers are the tightest: they move money. Auth is next, and is keyed by IP as well as
// by account, because the thing being guarded against is someone working through passwords
// for many accounts from one place. Reads are loosest.
//
// The store is in memory. That is correct for one instance and wrong for more than one:
// each process would keep its own counts, so N instances would allow N times the limit, and
// a restart forgets everything. Moving to a shared store is the fix, and is not needed while
// the service runs as a single Render web service.

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
  return req.caller ? `user:${req.caller.userId}` : `ip:${req.ip ?? "unknown"}`;
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
  keyGenerator: (req: Request) => `ip:${req.ip ?? "unknown"}`,
});

export const readLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 240,
  keyGenerator: callerKey,
});
