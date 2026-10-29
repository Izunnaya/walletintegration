import { z } from "zod";

export const transferHistoryQuerySchema = z.strictObject({
  // A sensible default, and a ceiling so one request cannot ask for the whole table.
  limit: z.coerce.number().int().min(1).max(100).default(20),

  // A transfer id, so it is a string on the wire like every other BIGINT.
  cursor: z
    .string()
    .trim()
    .regex(/^\d+$/, "cursor must be a transfer id")
    .transform((value) => BigInt(value))
    .pipe(z.bigint().positive().max(9_223_372_036_854_775_807n))
    .optional(),
});

export type TransferHistoryQuery = z.infer<typeof transferHistoryQuerySchema>;
