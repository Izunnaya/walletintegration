import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.ts";
import { prisma } from "../models/db.ts";
import { lockUsersForRestriction } from "../models/transferLocks.ts";
import type { RestrictionRequest } from "../domain/restrictionRequest.ts";
import { databaseIdSchema } from "../domain/transferRequest.ts";
import { classifyTransactionError } from "../models/transactionErrors.ts";

// Lock the actor and target, recheck permission, then save the change and audit entry together.

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

  if (affectedId === actor.userId) {
    refuse(res, req, 422, "CANNOT_RESTRICT_SELF", "An admin cannot change their own access.");
    return;
  }

  const isBlocked = action === "block";

  try {
    const changed = await prisma.$transaction(
      async (client) => {
        await client.$executeRaw`SET LOCAL lock_timeout = '5s'`;

        const users = await lockUsersForRestriction(client, [actor.userId, affectedId]);
        const currentActor = users.find((user) => user.id === actor.userId);
        if (!currentActor || currentActor.role !== "admin" || currentActor.isBlocked) {
          return { forbidden: true as const };
        }
        const locked = users.find((user) => user.id === affectedId);
        if (!locked) return null;

        // Record changes only; a repeated request leaves no extra audit entry.
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
      note:
        action === "unblock"
          ? "Unblocking does not lift a blacklist restriction."
          : undefined,
    });
  } catch (error) {
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
