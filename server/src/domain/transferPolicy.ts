import { createHash } from "node:crypto";
import { parseAmountMinor } from "./money.ts";
import type { AmountRejection } from "./money.ts";

// Pure decisions about a transfer. Data in, verdict out - no database, no clock, no
// randomness, so every case below is reachable in a test.
//
// The limit of what this file can promise: it decides whether a SUPPLIED balance is
// enough. It cannot know that the balance is still current. Only a row lock inside the
// transfer transaction can, which is why the service reads under lock and then calls this.

export type NormalisedTransferRequest = {
  sourceWalletId: number;
  destinationWalletId: number;
  currency: "NGN";
  amountMinor: bigint;
};

export type RequestRejection =
  | AmountRejection
  | "BODY_NOT_AN_OBJECT"
  | "SOURCE_WALLET_ID_INVALID"
  | "DESTINATION_WALLET_ID_INVALID"
  | "CURRENCY_UNSUPPORTED";

export type NormaliseResult =
  | { ok: true; request: NormalisedTransferRequest }
  | { ok: false; reason: RequestRejection };

function readWalletId(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return null;
  }
  return value;
}

export function normaliseTransferRequest(body: unknown): NormaliseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, reason: "BODY_NOT_AN_OBJECT" };
  }

  // Untrusted input. Every field is checked before it is used.
  const fields = body as Record<string, unknown>;

  const sourceWalletId = readWalletId(fields.sourceWalletId);
  if (sourceWalletId === null) {
    return { ok: false, reason: "SOURCE_WALLET_ID_INVALID" };
  }

  const destinationWalletId = readWalletId(fields.destinationWalletId);
  if (destinationWalletId === null) {
    return { ok: false, reason: "DESTINATION_WALLET_ID_INVALID" };
  }

  if (fields.currency !== "NGN") {
    return { ok: false, reason: "CURRENCY_UNSUPPORTED" };
  }

  const amount = parseAmountMinor(fields.amountMinor);
  if (!amount.ok) {
    return { ok: false, reason: amount.reason };
  }

  return {
    ok: true,
    request: {
      sourceWalletId,
      destinationWalletId,
      currency: "NGN",
      amountMinor: amount.amountMinor,
    },
  };
}

// The fingerprint is built from the normalised request, never from the raw JSON. Two
// requests that mean the same thing - different key order, different whitespace, a padded
// amount - must produce the same fingerprint, or a client retrying with its own
// serialisation would get a 409 for an identical intent.
export function fingerprintTransfer(request: NormalisedTransferRequest): string {
  const canonical = [
    request.sourceWalletId,
    request.destinationWalletId,
    request.currency,
    request.amountMinor.toString(),
  ].join("|");

  return createHash("sha256").update(canonical).digest("hex");
}

export type PartyState = {
  userId: number;
  isBlocked: boolean;
  isBlacklisted: boolean;
};

export type WalletState = {
  id: number;
  ownerId: number;
  currency: string;
  balanceMinor: bigint;
  isSystem: boolean;
};

export type TransferRejection =
  | "NOT_WALLET_OWNER"
  | "SAME_WALLET"
  | "SYSTEM_WALLET_NOT_TRANSFERABLE"
  | "SENDER_BLOCKED"
  | "SENDER_BLACKLISTED"
  | "RECIPIENT_BLOCKED"
  | "RECIPIENT_BLACKLISTED"
  | "CURRENCY_MISMATCH"
  | "INSUFFICIENT_FUNDS";

export type TransferPolicyInput = {
  authenticatedUserId: number;
  sender: PartyState;
  recipient: PartyState;
  sourceWallet: WalletState;
  destinationWallet: WalletState;
  amountMinor: bigint;
};

export type TransferPolicyResult =
  | { allowed: true }
  | { allowed: false; reason: TransferRejection };

export function checkTransferPolicy(input: TransferPolicyInput): TransferPolicyResult {
  // Ownership first. A caller who does not own the source wallet must learn nothing else
  // about it - not its balance, not whether its owner is blocked.
  if (input.sourceWallet.ownerId !== input.authenticatedUserId) {
    return { allowed: false, reason: "NOT_WALLET_OWNER" };
  }

  if (input.sourceWallet.id === input.destinationWallet.id) {
    return { allowed: false, reason: "SAME_WALLET" };
  }

  if (input.sourceWallet.isSystem || input.destinationWallet.isSystem) {
    return { allowed: false, reason: "SYSTEM_WALLET_NOT_TRANSFERABLE" };
  }

  // Both restrictions stop both directions, and a blacklist is not lifted by unblocking,
  // so each is checked separately rather than collapsed into one flag.
  if (input.sender.isBlocked) {
    return { allowed: false, reason: "SENDER_BLOCKED" };
  }

  if (input.sender.isBlacklisted) {
    return { allowed: false, reason: "SENDER_BLACKLISTED" };
  }

  if (input.recipient.isBlocked) {
    return { allowed: false, reason: "RECIPIENT_BLOCKED" };
  }

  if (input.recipient.isBlacklisted) {
    return { allowed: false, reason: "RECIPIENT_BLACKLISTED" };
  }

  if (
    input.sourceWallet.currency !== input.destinationWallet.currency ||
    input.sourceWallet.currency !== "NGN"
  ) {
    return { allowed: false, reason: "CURRENCY_MISMATCH" };
  }

  // The balance must have been read under SELECT ... FOR UPDATE for this to mean anything.
  if (input.sourceWallet.balanceMinor < input.amountMinor) {
    return { allowed: false, reason: "INSUFFICIENT_FUNDS" };
  }

  return { allowed: true };
}
