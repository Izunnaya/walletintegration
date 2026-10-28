import type { NextFunction, Request, Response } from "express";
import { readToken } from "../models/authToken.ts";
import type { AuthenticatedCaller } from "../models/authToken.ts";
import { prisma } from "../models/db.ts";

// This is how you add custom properties to the express request.
declare global {
  namespace Express {
    interface Request {
      caller?: AuthenticatedCaller;
    }
  }
}

function refuse(res: Response, req: Request, status: number, code: string, message: string) {
  res.status(status).json({
    error: { code, message, requestId: req.requestId },
  });
}

// verifyToken: who are you. Reads the bearer token and puts the caller on the request.
//
// It answers identity and nothing else. It does not decide whether the caller owns a
// wallet: a token minted an hour ago cannot know who owns a wallet now, so ownership is
// re-read from the locked row inside the transfer transaction.
export const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    refuse(res, req, 401, "UNAUTHENTICATED", "A bearer token is required.");
    return;
  }

  const result = readToken(header.slice("Bearer ".length).trim());

  if (!result.ok) {
    // Expired is worth distinguishing: the client should refresh rather than treat its
    // credentials as wrong. Every other failure is one message, because saying which part
    // of a token failed tells whoever is probing how close they are.
    const expired = result.reason === "EXPIRED";
    refuse(
      res,
      req,
      401,
      expired ? "TOKEN_EXPIRED" : "UNAUTHENTICATED",
      expired ? "The token has expired." : "The token is not valid.",
    );
    return;
  }

  req.caller = result.caller;
  next();
};

// requireRole: are you allowed. Always registered after verifyToken.
export const requireRole =
  (role: "customer" | "admin") => async (req: Request, res: Response, next: NextFunction) => {
    if (!req.caller) {
      refuse(res, req, 401, "UNAUTHENTICATED", "A bearer token is required.");
      return;
    }

    // Privileged actions use current permissions: a signed token can outlive a block or demotion.
    const user = await prisma.user.findUnique({
      where: { id: req.caller.userId }, select: { role: true, isBlocked: true },
    });
    if (!user || user.role !== role) {
      // 403, not 404: the route exists and the caller is known, they simply may not use it.
      // The 404-instead-of-403 rule applies to records, where confirming an id exists is
      // itself a leak. A route is not a record.
      refuse(res, req, 403, "FORBIDDEN", "This action requires a different role.");
      return;
    }

    if (user.isBlocked) {
      refuse(res, req, 403, "ACCOUNT_BLOCKED", "This account is blocked.");
      return;
    }

    next();
  };
