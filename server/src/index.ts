import "dotenv/config";
import app from "./app.ts";
import { prisma } from "./models/db.ts";

const PORT = process.env.PORT || 3000;

try {
  // Establish a usable connection before accepting the first user's request.
  const started = performance.now();
  await prisma.$queryRaw`SELECT 1`;
  console.log("database_ready", { durationMs: Math.round(performance.now() - started) });
  app.listen(PORT, () => {
    console.log(`Server started on localhost:${PORT}`);
  });
} catch {
  console.error("Server startup failed: the database is not reachable.");
  await prisma.$disconnect();
  process.exitCode = 1;
}
