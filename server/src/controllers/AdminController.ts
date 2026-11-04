import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.ts";
import { prisma } from "../models/db.ts";
import { lockUsersForRestriction } from "../models/transferLocks.ts";
import type { RestrictionRequest } from "../domain/restrictionRequest.ts";
import type { AdminUserQuery } from "../domain/adminUserQuery.ts";
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

// The accounts an admin can act on, which is what makes blocking usable: the restriction
// endpoints take a user id, and before this there was nowhere to learn one.
//
// A blacklisted email is a separate record from a blocked user, and the two are not the same
// refusal: blocking is reversible here, blacklisting is not. The list says which it is so an
// admin is not offered an unblock that would leave the account just as unable to transact.
//
// passwordHash is never selected. The column is one field away in the same row, so the
// select is explicit rather than a default that a later schema change could widen.
const listUsers = async (
  _req: Request,
  res: Response<unknown, { query: AdminUserQuery }>,
) => {
  const { limit, cursor, search, status } = res.locals.query;

  // Blacklisting is keyed by email with no relation to the user row, so membership is its own
  // lookup. The spec has this table filled by the seed, which is why reading it whole is
  // reasonable; the status filter needs it before the page is chosen, not after.
  const blacklistedEmails = (
    await prisma.blacklistEntry.findMany({ select: { email: true } })
  ).map((entry) => entry.email);
  const blacklisted = new Set(blacklistedEmails);

  // An empty blacklist behaves correctly here: `in: []` matches nothing, `notIn: []` matches
  // everything, which is what each of these means when nothing is blacklisted.
  const byStatus =
    status === "blacklisted"
      ? { email: { in: blacklistedEmails } }
      : status === "blocked"
        ? { isBlocked: true, email: { notIn: blacklistedEmails } }
        : status === "active"
          ? { isBlocked: false, email: { notIn: blacklistedEmails } }
          : {};

  // The funding account is not an account anyone administers. It has no usable login, only
  // the seed moves money out of it, and its balance is negative by design because every
  // customer wallet was funded from it - so listing it both offers a Block that would break
  // transfers and sends a negative balance to a client that is right to refuse one.
  const notSystem = { wallets: { none: { isSystem: true } } };

  const matching = search
    ? {
        OR: [
          { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
          {
            wallets: {
              some: { publicId: { contains: search, mode: Prisma.QueryMode.insensitive } },
            },
          },
        ],
      }
    : {};

  // One extra row to learn whether another page exists, then dropped.
  const rows = await prisma.user.findMany({
    where: {
      AND: [
        notSystem,
        matching,
        byStatus,
        ...(cursor === undefined ? [] : [{ id: { lt: cursor } }]),
      ],
    },
    orderBy: { id: "desc" },
    take: limit + 1,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isBlocked: true,
      createdAt: true,
      wallets: {
        where: { currency: "NGN" },
        select: { publicId: true, currency: true, balanceMinor: true },
        take: 1,
      },
    },
  });

  const page = rows.slice(0, limit);

  res.status(200).json({
    users: page.map((user) => {
      const wallet = user.wallets[0];
      return {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        isBlocked: user.isBlocked,
        isBlacklisted: blacklisted.has(user.email),
        createdAt: user.createdAt.toISOString(),
        wallet: wallet
          ? {
              publicId: wallet.publicId,
              currency: wallet.currency,
              balanceMinor: wallet.balanceMinor.toString(),
            }
          : null,
      };
    }),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id.toString() ?? null) : null,
  });
};

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
  listUsers,
  listAuditEntries,
};
