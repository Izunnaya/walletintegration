import type { Request, Response } from "express";
import { prisma } from "../models/db.ts";
import type { TransferHistoryQuery } from "../domain/transferHistoryQuery.ts";

// Transfers the caller is a party to. Never anyone else's.
//
// The wallets are resolved from the token's user id, and the filter is built from those
// wallet ids rather than from anything in the request, so there is no id to tamper with.

type TransferRow = {
  sourceWallet: { publicId: string };
  destinationWallet: { publicId: string };
  id: bigint;
  reference: string;
  sourceWalletId: bigint;
  destinationWalletId: bigint;
  amountMinor: bigint;
  currency: string;
  createdAt: Date;
};

function present(transfer: TransferRow, ownWalletIds: bigint[]) {
  const sent = ownWalletIds.some((id) => id === transfer.sourceWalletId);

  return {
    id: transfer.id.toString(),
    reference: transfer.reference,
    // Ids and money are strings on the wire: both are BIGINT, and a JSON number is a double.
    sourceWalletId: transfer.sourceWalletId.toString(),
    destinationWalletId: transfer.destinationWalletId.toString(),
    sourceWalletPublicId: transfer.sourceWallet.publicId,
    destinationWalletPublicId: transfer.destinationWallet.publicId,
    amountMinor: transfer.amountMinor.toString(),
    currency: transfer.currency,
    // Which way the money went for this caller. A transfer between two wallets they own
    // reports as sent, which is what the source wallet makes it.
    direction: sent ? "sent" : "received",
    createdAt: transfer.createdAt.toISOString(),
  };
}

async function ownWalletIds(userId: bigint) {
  const wallets = await prisma.wallet.findMany({
    where: { ownerId: userId },
    select: { id: true },
  });

  return wallets.map((wallet) => wallet.id);
}

const listTransfers = async (
  req: Request,
  res: Response<unknown, { query: TransferHistoryQuery }>,
) => {
  const caller = req.caller;
  if (!caller) throw new Error("verifyToken is required before listTransfers");

  const walletIds = await ownWalletIds(caller.userId);

  if (walletIds.length === 0) {
    res.status(200).json({ transfers: [], nextCursor: null });
    return;
  }

  const { limit, cursor } = res.locals.query;
  const involvesCaller = {
    OR: [
      { sourceWalletId: { in: walletIds } },
      { destinationWalletId: { in: walletIds } },
    ],
  };

  // Keyset pagination on the primary key, not OFFSET. Transfers are only ever inserted, so
  // id descending is a stable order: a page cannot shift or repeat a row because something
  // was written while the caller was reading. OFFSET would do exactly that.
  //
  // One extra row is fetched to learn whether another page exists, then dropped.
  const rows = await prisma.transfer.findMany({
    where: cursor === undefined ? involvesCaller : { AND: [involvesCaller, { id: { lt: cursor } }] },
    orderBy: { id: "desc" },
    take: limit + 1,
    select: {
      id: true,
      reference: true,
      sourceWallet: { select: { publicId: true } },
      destinationWallet: { select: { publicId: true } },
      sourceWalletId: true,
      destinationWalletId: true,
      amountMinor: true,
      currency: true,
      createdAt: true,
    },
  });

  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? page[page.length - 1]?.id.toString() ?? null : null;

  res.status(200).json({
    transfers: page.map((transfer) => present(transfer, walletIds)),
    nextCursor,
  });
};

const getTransfer = async (req: Request, res: Response) => {
  const caller = req.caller;
  if (!caller) throw new Error("verifyToken is required before getTransfer");

  // Express types a route parameter as string | string[], so the shape is checked before the
  // value is. Anything that is not a plain run of digits is answered 404 rather than 400,
  // because a caller guessing at ids should learn nothing from the difference.
  const requested = req.params.id;
  if (typeof requested !== "string" || !/^\d+$/.test(requested)) {
    res.status(404).json({
      error: {
        code: "TRANSFER_NOT_FOUND",
        message: "No such transfer.",
        requestId: req.requestId,
      },
    });
    return;
  }

  const walletIds = await ownWalletIds(caller.userId);

  const transfer = await prisma.transfer.findFirst({
    where: {
      id: BigInt(requested),
      OR: [
        { sourceWalletId: { in: walletIds } },
        { destinationWalletId: { in: walletIds } },
      ],
    },
    select: {
      id: true,
      reference: true,
      sourceWallet: { select: { publicId: true } },
      destinationWallet: { select: { publicId: true } },
      sourceWalletId: true,
      destinationWalletId: true,
      amountMinor: true,
      currency: true,
      createdAt: true,
    },
  });

  // 404, not 403, when the transfer exists but belongs to someone else. A 403 would confirm
  // the id is real, which is a way of enumerating other people's transfers. The ownership
  // filter is part of the query rather than a check afterwards, so there is no path where a
  // row is fetched and then forgotten to be checked.
  if (!transfer) {
    res.status(404).json({
      error: {
        code: "TRANSFER_NOT_FOUND",
        message: "No such transfer.",
        requestId: req.requestId,
      },
    });
    return;
  }

  res.status(200).json({ transfer: present(transfer, walletIds) });
};

export default {
  listTransfers,
  getTransfer,
};
