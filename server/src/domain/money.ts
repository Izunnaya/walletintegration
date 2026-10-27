import { z } from "zod";

// NGN 10,000,000 per transfer; this is a product limit, not the BIGINT storage limit.
export const MAX_TRANSFER_AMOUNT_MINOR = 1_000_000_000n;

export const currencySchema = z.literal("NGN", { error: "currency must be NGN" });

// Validate digits before conversion; never coerce money through a JavaScript number.
export const amountMinorSchema = z
  .string({ error: "amountMinor must be a string of kobo, not a number" })
  .trim()
  .regex(/^\d+$/, { error: "amountMinor must contain digits only" })
  .transform((text) => BigInt(text))
  .pipe(
    z.bigint()
      .positive({ error: "amountMinor must be greater than zero" })
      .max(MAX_TRANSFER_AMOUNT_MINOR, {
        error: `amountMinor must not exceed ${MAX_TRANSFER_AMOUNT_MINOR} kobo`,
      }),
  );

export type AmountRejection =
  | "AMOUNT_NOT_A_STRING"
  | "AMOUNT_NOT_AN_INTEGER"
  | "AMOUNT_NOT_POSITIVE"
  | "AMOUNT_ABOVE_MAXIMUM";

export type AmountParseResult =
  | { ok: true; amountMinor: bigint }
  | { ok: false; reason: AmountRejection };

export function parseAmountMinor(input: unknown): AmountParseResult {
  const result = amountMinorSchema.safeParse(input);

  if (result.success) {
    return { ok: true, amountMinor: result.data };
  }

  switch (result.error.issues[0]?.code) {
    case "invalid_type":
      return { ok: false, reason: "AMOUNT_NOT_A_STRING" };
    case "invalid_format":
      return { ok: false, reason: "AMOUNT_NOT_AN_INTEGER" };
    case "too_small":
      return { ok: false, reason: "AMOUNT_NOT_POSITIVE" };
    case "too_big":
      return { ok: false, reason: "AMOUNT_ABOVE_MAXIMUM" };
    default:
      throw result.error;
  }
}

export function amountMinorToJson(amountMinor: bigint): string {
  return amountMinor.toString();
}
