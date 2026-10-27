import type { Request, Response } from "express";

// Confirms the process is up and answering. It deliberately does not touch the database,
// so it stays true even while the database is unreachable.
const getLiveness = (req: Request, res: Response) => {
  res.json({ status: "ok" });
};

export default {
  getLiveness,
};
