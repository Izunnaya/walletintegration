import { z } from "zod";
import { amountMinorSchema, currencySchema } from "./money.ts";

const walletId = z
  .number()
  .int("must be a whole number")
  .positive("must be a positive integer")
  .max(Number.MAX_SAFE_INTEGER, "is out of range");

// Reject unknown fields, including attempts to supply the authenticated user's identity.
export const transferRequestSchema = z.strictObject({
  sourceWalletId: walletId,
  destinationWalletId: walletId,
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
