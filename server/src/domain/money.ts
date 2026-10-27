// Money is a whole number of kobo. 150000 means NGN 1,500.
//
// Nothing in this file converts through a JavaScript number. A double is exact only up to
// 2^53, which is well inside what BIGINT can hold, and past it the loss is silent - the
// wrong figure, with no error. bigint is exact at every size Postgres can store.

// NGN 10,000,000 per transfer. A product limit rather than a technical one: BIGINT could
// hold far more, but a wallet with no deposits has no business moving more than this, and
// an absurd amount is more likely a bug or an attack than an intention.
export const MAX_TRANSFER_AMOUNT_MINOR = 1_000_000_000n;

export type AmountRejection =
  | "AMOUNT_NOT_A_STRING"
  | "AMOUNT_NOT_AN_INTEGER"
  | "AMOUNT_NOT_POSITIVE"
  | "AMOUNT_ABOVE_MAXIMUM";

export type AmountParseResult =
  | { ok: true; amountMinor: bigint }
  | { ok: false; reason: AmountRejection };

// Accepts a positive integer string of kobo. A number is refused outright, even a valid
// one: accepting it would mean a caller could send 0.1 or 1e21 and have us guess.
export function parseAmountMinor(input: unknown): AmountParseResult {
  if (typeof input !== "string") {
    return { ok: false, reason: "AMOUNT_NOT_A_STRING" };
  }

  const text = input.trim();

  // Digits only. This is what rejects "-1", "1.5", "1e4", "+1", "0x1f", "" and " ".
  if (!/^\d+$/.test(text)) {
    return { ok: false, reason: "AMOUNT_NOT_AN_INTEGER" };
  }

  const amountMinor = BigInt(text);

  if (amountMinor <= 0n) {
    return { ok: false, reason: "AMOUNT_NOT_POSITIVE" };
  }

  if (amountMinor > MAX_TRANSFER_AMOUNT_MINOR) {
    return { ok: false, reason: "AMOUNT_ABOVE_MAXIMUM" };
  }

  return { ok: true, amountMinor };
}

// The single place money becomes JSON. A JSON number is a double, so an amount crosses
// the wire as a string or it crosses it wrong.
export function amountMinorToJson(amountMinor: bigint): string {
  return amountMinor.toString();
}
