import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

export function createDatabaseClient(connectionString: string) {
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
  }, { schema });

  return new PrismaClient({ adapter });
}
