import type { NextFunction, Request, Response } from "express";
import { readToken } from "../models/authToken.ts";
import type { AuthenticatedCaller } from "../models/authToken.ts";
import { prisma } from "../models/db.ts";

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

// Verify identity here; check wallet ownership inside the transfer transaction.
export const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    refuse(res, req, 401, "UNAUTHENTICATED", "A bearer token is required.");
    return;
  }

  const result = readToken(header.slice("Bearer ".length).trim());

  if (!result.ok) {
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
      refuse(res, req, 403, "FORBIDDEN", "This action requires a different role.");
      return;
    }

    if (user.isBlocked) {
      refuse(res, req, 403, "ACCOUNT_BLOCKED", "This account is blocked.");
      return;
    }

    next();
  };
