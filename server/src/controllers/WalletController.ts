import type { Request, Response } from "express";
import { prisma } from "../models/db.ts";

// The caller's own wallet. There is no endpoint for anyone else's: the wallet is found from
// the token's user id, never from a parameter, so there is no id to tamper with.
const getMyWallet = async (req: Request, res: Response) => {
  const caller = req.caller;

  if (!caller) {
    res.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "A bearer token is required.",
        requestId: req.requestId,
      },
    });
    return;
  }

  const wallet = await prisma.wallet.findFirst({
    where: { ownerId: caller.userId, currency: "NGN" },
  });

  if (!wallet) {
    res.status(404).json({
      error: {
        code: "WALLET_NOT_FOUND",
        message: "No wallet exists for this account.",
        requestId: req.requestId,
      },
    });
    return;
  }

  res.status(200).json({
    id: wallet.id.toString(),
    currency: wallet.currency,
    balanceMinor: wallet.balanceMinor.toString(),
  });
};

export default {
  getMyWallet,
};
