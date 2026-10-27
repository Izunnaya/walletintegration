import { createDatabaseClient } from "./databaseClient.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

export const prisma = createDatabaseClient(connectionString);
export const databaseSchema = new URL(connectionString).searchParams.get("schema") ?? "public";
