import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { describeIssues, transferRequestSchema, idempotencyKeySchema } from "../domain/transferRequest.ts";
import { loginRequestSchema, registerRequestSchema } from "../domain/authRequest.ts";

// Where a malformed request is refused, before any financial work starts.
//
// Business rules are deliberately not checked here. Whether a wallet can afford a transfer
// is decided under a row lock inside the transaction, because a balance read outside one
// is already stale by the time it is used.

const validateBody = (schema: ZodType) => (req: Request, res: Response, next: NextFunction) => {
  const result = schema.safeParse(req.body);

  if (result.success) {
    res.locals.body = result.data;
    next();
    return;
  }

  // status().json() once. sendStatus() would send the body itself, and a .json() on top
  // of it throws.
  res.status(400).json({
    error: {
      code: "VALIDATION_FAILED",
      message: "The request body is invalid.",
      requestId: req.requestId,
      details: describeIssues(result.error),
    },
  });
};

// One exported validator per request type, so a route file reads as a list of what it
// requires: authenticate, authorise, validate, controller.
export const validateTransferRequest = validateBody(transferRequestSchema);

export const validateRegisterRequest = validateBody(registerRequestSchema);
export const validateLoginRequest = validateBody(loginRequestSchema);

export const validateIdempotencyKey = (req: Request, res: Response, next: NextFunction) => {
  const parsed = idempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
  if (!parsed.success) {
    res.status(400).json({ error: { code: "INVALID_IDEMPOTENCY_KEY", message: "A valid Idempotency-Key header is required.", requestId: req.requestId } });
    return;
  }
  res.locals.idempotencyKey = parsed.data;
  next();
};
