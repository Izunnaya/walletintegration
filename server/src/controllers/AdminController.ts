import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.ts";
import { prisma } from "../models/db.ts";
import { lockUsersForRestriction } from "../models/transferLocks.ts";
import type { RestrictionRequest } from "../domain/restrictionRequest.ts";
import { databaseIdSchema } from "../domain/transferRequest.ts";
import { classifyTransactionError } from "../models/transactionErrors.ts";

// Blocking and unblocking, each committed together with its audit row.
//
// Two things make this more than an UPDATE.
//
// It takes the same user row lock, in the same order, that a transfer takes. That is what
// makes blocking and transferring serialise: whichever acquires the lock first decides. A
// block committed first causes a waiting transfer to be rejected; a transfer already holding
// the lock completes before the block applies. Either is correct. What must not happen is
// the two interleaving, which is what an unlocked UPDATE would allow.
//
// The restriction change and the audit entry are written in one transaction, so a
// restriction cannot exist without a record of who made it and why.

function refuse(res: Response, req: Request, status: number, code: string, message: string) {
  res.status(status).json({
    error: { code, message, requestId: req.requestId },
  });
}

async function applyRestriction(
  req: Request,
  res: Response<unknown, { body: RestrictionRequest }>,
  action: "block" | "unblock",
) {
  const actor = req.caller;
  if (!actor) throw new Error("verifyToken is required before applyRestriction");

  const requested = databaseIdSchema.safeParse(req.params.id);
  if (!requested.success) {
    refuse(res, req, 404, "USER_NOT_FOUND", "No such user.");
    return;
  }

  const affectedId = requested.data;

  // An admin blocking themselves would lock themselves out with no way back, since only an
  // admin can unblock. Refused rather than left as a trap.
  if (affectedId === actor.userId) {
    refuse(res, req, 422, "CANNOT_RESTRICT_SELF", "An admin cannot change their own access.");
    return;
  }

  const isBlocked = action === "block";

  try {
    const changed = await prisma.$transaction(
      async (client) => {
        await client.$executeRaw`SET LOCAL lock_timeout = '5s'`;

        // The same lock a transfer takes on this row, so the two serialise.
        const users = await lockUsersForRestriction(client, [actor.userId, affectedId]);
        const currentActor = users.find((user) => user.id === actor.userId);
        if (!currentActor || currentActor.role !== "admin" || currentActor.isBlocked) {
          return { forbidden: true as const };
        }
        const locked = users.find((user) => user.id === affectedId);
        if (!locked) return null;

        // Already in the requested state: the audit trail records attempts that changed
        // something, so this writes nothing and reports the current state.
        if (locked.isBlocked === isBlocked) {
          return { user: locked, changed: false };
        }

        const user = await client.user.update({
          where: { id: affectedId },
          data: { isBlocked, updatedAt: new Date() },
          select: { id: true, email: true, name: true, role: true, isBlocked: true },
        });

        await client.adminAuditEntry.create({
          data: {
            actorUserId: actor.userId,
            affectedUserId: affectedId,
            action,
            reason: res.locals.body.reason,
          },
        });

        return { user, changed: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5_000, timeout: 15_000 },
    );

    if (changed === null) {
      refuse(res, req, 404, "USER_NOT_FOUND", "No such user.");
      return;
    }

    if ("forbidden" in changed) {
      refuse(res, req, 403, "FORBIDDEN", "Admin access is required.");
      return;
    }

    res.status(200).json({
      user: {
        id: changed.user.id.toString(),
        email: changed.user.email,
        name: changed.user.name,
        role: changed.user.role,
        isBlocked: changed.user.isBlocked,
      },
      changed: changed.changed,
      // Said plainly, because it is the rule most likely to surprise an admin who has just
      // unblocked someone and found they still cannot transfer.
      note:
        action === "unblock"
          ? "Unblocking does not lift a blacklist restriction."
          : undefined,
    });
  } catch (error) {
    // A lock timeout means a transfer is holding this user row right now. That is the
    // serialisation working, not a failure, and the honest answer is to say so and let the
    // admin try again rather than to wait indefinitely.
    if (classifyTransactionError(error) !== "unexpected") {
      res.setHeader("Retry-After", "1");
      refuse(
        res,
        req,
        503,
        "USER_BUSY",
        "This account is temporarily unavailable. Retry the same administrative request.",
      );
      return;
    }

    throw error;
  }
}

const blockUser = (req: Request, res: Response<unknown, { body: RestrictionRequest }>) =>
  applyRestriction(req, res, "block");

const unblockUser = (req: Request, res: Response<unknown, { body: RestrictionRequest }>) =>
  applyRestriction(req, res, "unblock");

const listAuditEntries = async (req: Request, res: Response) => {
  const entries = await prisma.adminAuditEntry.findMany({
    orderBy: { id: "desc" },
    take: 50,
    select: {
      id: true,
      action: true,
      reason: true,
      createdAt: true,
      actor: { select: { id: true, email: true } },
      affectedUser: { select: { id: true, email: true } },
    },
  });

  res.status(200).json({
    entries: entries.map((entry) => ({
      id: entry.id.toString(),
      action: entry.action,
      reason: entry.reason,
      actor: { id: entry.actor.id.toString(), email: entry.actor.email },
      affected: { id: entry.affectedUser.id.toString(), email: entry.affectedUser.email },
      createdAt: entry.createdAt.toISOString(),
    })),
  });
};

export default {
  blockUser,
  unblockUser,
  listAuditEntries,
};
