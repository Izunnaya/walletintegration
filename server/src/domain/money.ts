import { z } from "zod";

// Product limit: NGN 10 million per transfer.
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

export function amountMinorToJson(amountMinor: bigint): string {
  return amountMinor.toString();
}
