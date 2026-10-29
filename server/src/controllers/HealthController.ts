import type { Request, Response } from "express";
import { prisma } from "../models/db.ts";
import { logger } from "../logger.ts";

// Confirms the process is up and answering. It deliberately does not touch the database,
// so it stays true even while the database is unreachable.
const getLiveness = (req: Request, res: Response) => {
  res.json({ status: "ok" });
};

const getReadiness = async (req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ready" });
  } catch (error) {
    // The real error goes to the log with the request ID; the caller gets none of it.
    logger.error({ requestId: req.requestId, err: error }, "readiness_failed");

    res.status(503).json({
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "The database is not reachable.",
        requestId: req.requestId,
      },
    });
  }
};

export default {
  getLiveness,
  getReadiness,
};
