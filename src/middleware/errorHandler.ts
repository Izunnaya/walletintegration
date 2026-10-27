// "import type" because Node runs this TypeScript directly: these are types, not real exports of express
import type { Request, Response, NextFunction } from "express";

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

// Runs when a route threw, or returned a rejected promise. Express only sends errors here because
// this function takes four arguments, so do not remove "next" even though it is rarely used.
export const respondInternalError = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // The real error goes to the logs. The client only gets the request ID, because the message and
  // stack would tell an attacker about our database, file paths and libraries.
  console.error("request_failed", { requestId: req.requestId, path: req.path, error });

  // Once a response has started sending, its status and headers are already gone, so we cannot
  // replace it with JSON. Handing the error back lets Express close the connection.
  if (res.headersSent) {
    next(error);
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
