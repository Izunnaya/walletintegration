import { randomUUID } from "node:crypto";
// "import type" because Node runs this TypeScript directly: these are types, not real exports of express
import type { Request, Response, NextFunction } from "express";

// This is how you add custom properties to the express request
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

// The ID is generated here, never read from the request headers. A client could otherwise send
// the same ID on every request, or put junk in it, and our logs would be useless.
export const attachRequestId = (req: Request, res: Response, next: NextFunction) => {
  const requestId = randomUUID();

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
};
