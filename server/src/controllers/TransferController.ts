import type { Request, Response } from "express";
import type { TransferRequest } from "../domain/transferRequest.ts";
import { createTransfer } from "../services/transferService.ts";
import { logger } from "../logger.ts";

const sendTransfer = async (req: Request, res: Response<unknown, { body: TransferRequest; idempotencyKey: string }>) => {
  if (!req.caller) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "A bearer token is required.", requestId: req.requestId } });
    return;
  }
  if (!req.requestId) throw new Error("Request ID middleware is required");
  const result = await createTransfer(req.caller.userId, res.locals.idempotencyKey, res.locals.body, req.requestId);
  if (result.statusCode === 503) res.setHeader("Retry-After", "1");
  // userId as a string because BigInt has no JSON representation: JSON.stringify throws on
  // it, which would turn a log line into a crash inside the response path.
  logger.info(
    { requestId: req.requestId, userId: req.caller.userId.toString(), statusCode: result.statusCode },
    "transfer_response",
  );
  res.status(result.statusCode).json(result.body);
};

export default { sendTransfer };
