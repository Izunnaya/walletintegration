import type { Request, Response } from "express";
import type { RegisterRequest, LoginRequest } from "../domain/authRequest.ts";
import { prisma } from "../models/db.ts";
import { hashPassword, verifyPassword } from "../models/password.ts";
import { issueToken } from "../models/authToken.ts";

const createUser = async (req: Request, res: Response<unknown, { body: RegisterRequest }>) => {
  try {
    const { email, name, password } = res.locals.body;

    // Reject blacklisted addresses before doing expensive password hashing.
    const blacklisted = await prisma.blacklistEntry.findUnique({
      where: { email },
      select: { id: true },
    });

    if (blacklisted) {
      res.status(422).json({
        error: {
          code: "EMAIL_BLACKLISTED",
          message: "This email address cannot be registered.",
          requestId: req.requestId,
        },
      });
      return;
    }

    const passwordHash = await hashPassword(password);

    // Create the customer and zero-balance wallet atomically.
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name, passwordHash, role: "customer" },
      });

      const wallet = await tx.wallet.create({
        data: { ownerId: user.id, currency: "NGN" },
      });

      return { user, wallet };
    });

    res.status(201).json({
      user: {
        id: created.user.id.toString(),
        email: created.user.email,
        name: created.user.name,
        role: created.user.role,
      },
      wallet: {
        id: created.wallet.id.toString(),
        currency: created.wallet.currency,
        // Money crosses the wire as a string of kobo. A JSON number is a double.
        balanceMinor: created.wallet.balanceMinor.toString(),
      },
    });
  } catch (error) {
    // P2002 is the unique violation. The email is the only unique column reachable here,
    // and 409 says the request was well formed but conflicts with what already exists.
    if (isUniqueViolation(error)) {
      res.status(409).json({
        error: {
          code: "EMAIL_TAKEN",
          message: "An account with this email already exists.",
          requestId: req.requestId,
        },
      });
      return;
    }

    throw error;
  }
};

const createSession = async (req: Request, res: Response<unknown, { body: LoginRequest }>) => {
  const { email, password } = res.locals.body;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, passwordHash: true, isBlocked: true },
  });

  // A dummy comparison reduces timing differences for unknown accounts.
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordMatches) {
    res.status(401).json({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "The email or password is incorrect.",
        requestId: req.requestId,
      },
    });
    return;
  }

  // A blocked user cannot obtain a token. The transfer re-checks this under lock anyway,
  // because a block committed after a token was issued must still take effect.
  if (user.isBlocked) {
    res.status(403).json({
      error: {
        code: "ACCOUNT_BLOCKED",
        message: "This account is blocked.",
        requestId: req.requestId,
      },
    });
    return;
  }

  const role = user.role === "admin" ? "admin" : "customer";

  res.status(200).json({
    token: issueToken({ userId: user.id, role }),
    user: { id: user.id.toString(), email: user.email, name: user.name, role },
  });
};

// Same bcrypt cost as real accounts; an absent user is rejected regardless of the match.
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.KnQqDLpZQH0VsOQpyfPbPCNkFLX8/Py";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export default {
  createUser,
  createSession,
};
