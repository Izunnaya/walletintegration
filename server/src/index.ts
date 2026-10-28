import "dotenv/config";
import app from "./app.ts";
import { prisma } from "./models/db.ts";
import { logger } from "./logger.ts";
import { trustedProxyHops } from "./proxyConfig.ts";

const PORT = process.env.PORT || 3000;

if (process.env.RENDER === "true" && trustedProxyHops === 0) {
  logger.warn("proxy_trust_unconfigured: IP rate limits use the socket peer; configure TRUST_PROXY_HOPS from the ingress logs");
}

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
