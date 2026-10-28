import { z } from "zod";
import { amountMinorSchema, currencySchema } from "./money.ts";

// IDs use strings on the wire so BIGINT values never pass through a double.
export const databaseIdSchema = z.string().trim().regex(/^\d+$/, "must contain digits only")
  .transform((value) => BigInt(value))
  .pipe(z.bigint().positive().max(9_223_372_036_854_775_807n));

export const publicWalletIdSchema = z.string().trim().regex(/^wlt_[0-9a-f]{32}$/, "must be a valid wallet ID");
export const walletIdentifierSchema = z.union([publicWalletIdSchema, databaseIdSchema]);

export const idempotencyKeySchema = z.string().regex(
  /^[A-Za-z0-9._:-]{1,128}$/,
  "Idempotency-Key must be 1-128 letters, digits, dots, underscores, colons or hyphens",
);

// Reject unknown fields, including attempts to supply the authenticated user's identity.
export const transferRequestSchema = z.strictObject({
  sourceWalletId: walletIdentifierSchema,
  destinationWalletId: walletIdentifierSchema,
  currency: currencySchema,
  amountMinor: amountMinorSchema,
});

export type TransferRequest = z.infer<typeof transferRequestSchema>;

// Field-level failures, flattened for the error response. Reported together rather than
// one at a time so a caller fixes one request instead of six.
export type FieldFailure = {
  field: string | null;
  message: string;
};

export function describeIssues(error: z.ZodError): FieldFailure[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : null,
    message: issue.message,
  }));
}
