import { createHash } from "node:crypto";
import { currencySchema } from "./money.ts";
import type { TransferRequest } from "./transferRequest.ts";

export function fingerprintTransfer(request: TransferRequest): string {
  const canonical = [
    request.sourceWalletId,
    request.destinationWalletId,
    request.currency,
    request.amountMinor.toString(),
  ].join("|");

  return createHash("sha256").update(canonical).digest("hex");
}

export type PartyState = {
  userId: bigint;
  isBlocked: boolean;
  isBlacklisted: boolean;
};

export type WalletState = {
  id: bigint;
  ownerId: bigint;
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
  authenticatedUserId: bigint;
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
    input.sourceWallet.currency !== currencySchema.value
  ) {
    return { allowed: false, reason: "CURRENCY_MISMATCH" };
  }

  // The balance must have been read under SELECT ... FOR UPDATE for this to mean anything.
  if (input.sourceWallet.balanceMinor < input.amountMinor) {
    return { allowed: false, reason: "INSUFFICIENT_FUNDS" };
  }

  return { allowed: true };
}
