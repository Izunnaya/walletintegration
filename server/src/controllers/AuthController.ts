import type { Request, Response } from "express";
import { registerRequestSchema, loginRequestSchema } from "../domain/authRequest.ts";
import { prisma } from "../models/db.ts";
import { hashPassword, verifyPassword } from "../models/password.ts";
import { issueToken } from "../models/authToken.ts";

// The body has already been through validate middleware, so parsing here cannot fail. It
// is parsed rather than cast so the values are typed without a type assertion.

const createUser = async (req: Request, res: Response) => {
  try {
    const { email, name, password } = registerRequestSchema.parse(req.body);

    // Checked before the password is hashed, because hashing costs 250ms and a blacklisted
    // address does not deserve it.
    const blacklisted = await prisma.blacklistEntry.findUnique({ where: { email } });

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

    // The user and their wallet are created in one transaction, so a user can never exist
    // without a wallet. Without this, a failure between the two inserts would leave an
    // account that cannot hold money and that registration would refuse to recreate,
    // because the email is already taken.
    //
    // role is not read from the request. Public registration always creates a customer.
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

const createSession = async (req: Request, res: Response) => {
  const { email, password } = loginRequestSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email } });

  // One answer for "no such email" and "wrong password". Distinguishing them turns login
  // into a way to discover which addresses are registered.
  //
  // The password is still verified against a dummy hash when the user does not exist, so
  // both paths take the same ~250ms. Returning early would make a missing account
  // measurably faster to probe than a wrong password.
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

// A real bcrypt hash of a value nothing can supply, so comparing against it always fails
// at the same cost as comparing against a genuine one.
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.KnQqDLpZQH0VsOQpyfPbPCNkFLX8/Py";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export default {
  createUser,
  createSession,
};
