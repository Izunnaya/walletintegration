import { z } from "zod";
import { MAX_TRANSFER_AMOUNT_MINOR, parseAmountMinor } from "./money.ts";
import type { AmountRejection } from "./money.ts";

// The shape of a transfer request, and the only place it is turned into typed values.
//
// The schema does validation and normalisation in one pass, which is why there is no
// separate normalise function: it rejects a malformed body and, on the way through,
// converts the kobo string into an exact bigint. One definition, so the two can never
// disagree about what a valid request is.
//
// The TypeScript type is inferred from the schema rather than declared beside it, so a
// change to one cannot leave the other stale.

const amountMessages: Record<AmountRejection, string> = {
  AMOUNT_NOT_A_STRING: "amountMinor must be a string of kobo, not a number",
  AMOUNT_NOT_AN_INTEGER: "amountMinor must contain digits only",
  AMOUNT_NOT_POSITIVE: "amountMinor must be greater than zero",
  AMOUNT_ABOVE_MAXIMUM: `amountMinor must not exceed ${MAX_TRANSFER_AMOUNT_MINOR} kobo`,
};

const walletId = z
  .number()
  .int("must be a whole number")
  .positive("must be a positive integer")
  .max(Number.MAX_SAFE_INTEGER, "is out of range");

// parseAmountMinor stays the single implementation of the money rule, and the schema
// delegates to it, so a caller that is not an HTTP request - the seed, a test - converts
// an amount exactly the same way.
const amountMinor = z.unknown().transform((value, ctx) => {
  const parsed = parseAmountMinor(value);

  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: amountMessages[parsed.reason] });
    return z.NEVER;
  }

  return parsed.amountMinor;
});

// strictObject, not object: an unknown field is refused rather than silently dropped.
// A body carrying userId or role is either a client bug or an attempt to be someone else,
// and both are worth telling the caller about. The sender is always taken from the token.
export const transferRequestSchema = z.strictObject({
  sourceWalletId: walletId,
  destinationWalletId: walletId,
  currency: z.literal("NGN", { message: "currency must be NGN" }),
  amountMinor,
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
