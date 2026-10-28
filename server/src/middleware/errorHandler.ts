// "import type" because Node runs this TypeScript directly: these are types, not real exports of express
import type { Request, Response, NextFunction } from "express";
import { classifyTransactionError } from "../models/transactionErrors.ts";

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

// Some errors are the caller's fault and already say so. Body parsers in particular throw
// an error carrying a 4xx status and expose: true, which is Express's convention for "this
// is safe to tell the client about". Reporting malformed JSON as 500 would be wrong twice
// over: it tells the caller to retry something that will never work, and it puts a client
// mistake in the server's error logs as though we had broken.
//
// The status is honoured; the message is not. A parser message can quote the body it choked
// on, so the text comes from here.
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

// Runs when a route threw, or returned a rejected promise. Express only sends errors here
// because this function takes four arguments, so do not remove "next" even though it is
// rarely used.
export const respondInternalError = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const fault = clientFault(error);

  // A connection pool timeout, an unreachable database, a dropped socket: the request did
  // not succeed, but nothing about the service is broken and trying again may well work.
  // Answering 500 would be wrong twice over - it tells the client not to retry something
  // that would probably succeed, and it files a capacity problem as a defect.
  //
  // The transfer already draws this distinction inside its own retry loop. Everything else
  // reaching here - a login, a wallet read, a history page - had no such handling, so a
  // pool timeout under load surfaced as 500. This is the same classifier, applied once at
  // the edge, so the whole API answers transient failures the same way.
  const transient = fault === null && classifyTransactionError(error) !== "unexpected";

  if (transient) {
    console.warn("request_unavailable", {
      requestId: req.requestId,
      path: req.path,
      error,
    });
  } else if (fault) {
    console.warn("request_rejected", {
      requestId: req.requestId,
      path: req.path,
      code: fault.code,
    });
  } else {
    // The real error goes to the logs. The client only gets the request ID, because the
    // message and stack would tell an attacker about our database, file paths and libraries.
    console.error("request_failed", { requestId: req.requestId, path: req.path, error });
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
