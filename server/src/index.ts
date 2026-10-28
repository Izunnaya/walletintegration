import "dotenv/config";
import app from "./app.ts";
import { prisma } from "./models/db.ts";
import { logger } from "./logger.ts";

const PORT = process.env.PORT || 3000;

try {
  // Establish a usable connection before accepting the first user's request.
  const started = performance.now();
  await prisma.$queryRaw`SELECT 1`;
  logger.info({ durationMs: Math.round(performance.now() - started) }, "database_ready");
  app.listen(PORT, () => {
    logger.info({ port: Number(PORT) }, "server_listening");
  });
} catch {
  logger.error("startup_failed: the database is not reachable");
  await prisma.$disconnect();
  process.exitCode = 1;
}
