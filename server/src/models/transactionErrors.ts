import { z } from "zod";

// Prisma wraps PostgreSQL SQLSTATE codes differently for raw queries and model operations.
const databaseErrorSchema = z.object({
  code: z.string().optional(),
  meta: z.object({
    code: z.string().optional(),
    driverAdapterError: z.object({
      cause: z.object({ originalCode: z.string().optional(), kind: z.string().optional() }).optional(),
    }).optional(),
  }).optional(),
});

export function classifyTransactionError(error: unknown) {
  const parsed = databaseErrorSchema.safeParse(error);
  if (!parsed.success) return "unexpected";
  const { code, meta } = parsed.data;
  const sqlState = meta?.code ?? meta?.driverAdapterError?.cause?.originalCode ?? code;
  if (code === "P2034" || sqlState === "40P01" || sqlState === "40001") return "retry";
  if (["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2037"].includes(code ?? "") ||
      ["55P03", "57014", "57P01", "57P02", "57P03", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND"].includes(sqlState ?? "") ||
      sqlState?.startsWith("08") ||
      ["ConnectionClosed", "DatabaseNotReachable", "SocketTimeout"].includes(meta?.driverAdapterError?.cause?.kind ?? "")) {
    return "unavailable";
  }
  return "unexpected";
}
