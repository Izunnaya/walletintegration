// "import type" because Node runs this TypeScript directly: these are types, not real exports of express
import type { Request, Response, NextFunction } from "express";
import { classifyTransactionError } from "../models/transactionErrors.ts";
import { logger } from "../logger.ts";

// Runs when no route matched the request
export const respondNotFound = (req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Route not found.",
      requestId: req.requestId,
    },
  });
};

type ClientFault = { status: number; code: string; message: string };

function clientFault(error: unknown): ClientFault | null {
  if (typeof error !== "object" || error === null) return null;

  const candidate = error as { status?: unknown; statusCode?: unknown; expose?: unknown; type?: unknown };
  const status = typeof candidate.status === "number" ? candidate.status : candidate.statusCode;

  if (typeof status !== "number" || status < 400 || status > 499) return null;
  if (candidate.expose !== true) return null;

  if (candidate.type === "entity.parse.failed") {
    return { status: 400, code: "MALFORMED_JSON", message: "The request body is not valid JSON." };
  }

  if (candidate.type === "entity.too.large") {
    return { status: 413, code: "BODY_TOO_LARGE", message: "The request body is too large." };
  }

  return { status, code: "BAD_REQUEST", message: "The request could not be processed." };
}

export const respondInternalError = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const fault = clientFault(error);

  const transient = fault === null && classifyTransactionError(error) !== "unexpected";

  if (transient) {
    logger.warn({ requestId: req.requestId, path: req.path, err: error }, "request_unavailable");
  } else if (fault) {
    logger.warn({ requestId: req.requestId, path: req.path, code: fault.code }, "request_rejected");
  } else {
    // The real error goes to the logs. The client only gets the request ID, because the
    // message and stack would tell an attacker about our database, file paths and libraries.
    logger.error({ requestId: req.requestId, path: req.path, err: error }, "request_failed");
  }

  // Once a response has started sending, its status and headers are already gone, so we cannot
  // replace it with JSON. Handing the error back lets Express close the connection.
  if (res.headersSent) {
    next(error);
    return;
  }

  if (fault) {
    res.status(fault.status).json({
      error: { code: fault.code, message: fault.message, requestId: req.requestId },
    });
    return;
  }

  if (transient) {
    res.setHeader("Retry-After", "1");
    res.status(503).json({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "The service is briefly unavailable. Try again.",
        requestId: req.requestId,
      },
    });
    return;
  }

  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      requestId: req.requestId,
    },
  });
};
