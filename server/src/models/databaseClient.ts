import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

// transactionOptions is for callers that are far from the database. A batch
// $transaction([...]) does not accept maxWait per call, so the only place to raise it is
// here. The application deliberately does not raise it: a transfer that cannot get a
// connection quickly should fail fast and return 503, not queue for fifteen seconds.
export function createDatabaseClient(
  connectionString: string,
  clientOptions: { transactionOptions?: { maxWait?: number; timeout?: number } } = {},
) {
  const url = new URL(connectionString);
  const schema = url.searchParams.get("schema") ?? "public";

  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error("Database schema must use lowercase letters, digits, or underscores.");
  }

  // Configure TLS in one place; URL SSL parameters would override the adapter options.
  for (const parameter of ["sslmode", "sslcert", "sslkey", "sslrootcert", "channel_binding", "schema"]) {
    url.searchParams.delete(parameter);
  }

  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const adapter = new PrismaPg({
    connectionString: url.toString(),
    ssl: isLocal ? false : { rejectUnauthorized: true },
    enableChannelBinding: !isLocal,
    // Reuse connections across short pauses instead of reconnecting after 10 seconds.
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 10_000,
  }, { schema });

  return new PrismaClient({ adapter, ...clientOptions });
}
