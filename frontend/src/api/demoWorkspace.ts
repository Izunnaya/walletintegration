import { ApiError } from "./types";
import type { SendTransferRequest, Transfer, WalletUser } from "./types";

// The stand-in server, and the only file in this project that holds fake data.
//
// The UI is being restructured before it is wired to the real API, so something has to
// answer the api/ hooks in the meantime. Putting it here, behind the same async functions a
// fetch will go through, means the next phase replaces this one file and the hooks that call
// it - and no screen, form or component changes at all. That is the whole reason it exists
// rather than the screens holding useState for the data, which is what the export did.
//
// It also keeps the behaviours worth demonstrating: an idempotency key that makes a retry
// safe, an outcome that cannot be confirmed, and the refusals the server really sends.

const LATENCY_MS = 700;

let users: WalletUser[] = [
  { id: "wlt_8f2a9b3c4d5e", name: "Alex Morgan", email: "alex@studio.co", status: "active", balanceMinor: "1245000" },
  { id: "wlt_6e4d2c8b1a9f", name: "Olivia Rhye", email: "olivia@acme.co", status: "active", balanceMinor: "480000" },
  { id: "wlt_9c3b5a7d2e1f", name: "Phoenix Baker", email: "phoenix@studio.co", status: "active", balanceMinor: "210000" },
  { id: "wlt_2b7c8d4e5f6a", name: "Lana Steiner", email: "lana@example.com", status: "blocked", balanceMinor: "85000" },
  { id: "wlt_5a1b9c3d7e2f", name: "Demi Wilkinson", email: "demi@example.com", status: "blacklisted", balanceMinor: "0" },
];

let transfers: Transfer[] = [
  { id: "tx_001", reference: "tx_001", counterpartyName: "Olivia Rhye", counterpartyWallet: "wlt_6e4d2c8b1a9f", amountMinor: "250000", direction: "received", status: "completed", createdAt: "2026-10-26T10:42:00Z" },
  { id: "tx_002", reference: "tx_002", counterpartyName: "Phoenix Baker", counterpartyWallet: "wlt_9c3b5a7d2e1f", amountMinor: "15000", direction: "sent", status: "completed", createdAt: "2026-10-26T09:18:00Z" },
  { id: "tx_003", reference: "tx_003", counterpartyName: "Olivia Rhye", counterpartyWallet: "wlt_6e4d2c8b1a9f", amountMinor: "80000", direction: "received", status: "completed", createdAt: "2026-10-25T16:30:00Z" },
  { id: "tx_004", reference: "tx_004", counterpartyName: "Phoenix Baker", counterpartyWallet: "wlt_9c3b5a7d2e1f", amountMinor: "32000", direction: "sent", status: "completed", createdAt: "2026-10-25T14:12:00Z" },
  { id: "tx_006", reference: "tx_006", counterpartyName: "Olivia Rhye", counterpartyWallet: "wlt_6e4d2c8b1a9f", amountMinor: "120000", direction: "received", status: "completed", createdAt: "2026-10-23T10:00:00Z" },
  { id: "tx_007", reference: "tx_007", counterpartyName: "Phoenix Baker", counterpartyWallet: "wlt_9c3b5a7d2e1f", amountMinor: "50000", direction: "sent", status: "completed", createdAt: "2026-10-22T13:00:00Z" },
  { id: "tx_008", reference: "tx_008", counterpartyName: "Olivia Rhye", counterpartyWallet: "wlt_6e4d2c8b1a9f", amountMinor: "45000", direction: "received", status: "completed", createdAt: "2026-10-21T10:00:00Z" },
];

// Which failure the next transfer should produce. The real API decides this for itself; until
// then a reviewer needs some way to reach the error states, and a selector is at least honest
// about being one.
export type DemoOutcome = "success" | "unknown" | "conflict" | "rateLimited" | "sessionExpired";

let outcome: DemoOutcome = "success";

export const setDemoOutcome = (next: DemoOutcome) => {
  outcome = next;
};

export const getDemoOutcome = () => outcome;

// Keyed by idempotency key, exactly as the server keys its own table. A repeat of a key that
// already succeeded returns the first result instead of moving money twice, which is the
// property the whole retry story rests on - so the stand-in honours it too.
const completed = new Map<string, Transfer>();
const seenUnknown = new Set<string>();

const wait = () => new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

export const signedInWalletId = () => users[0]!.id;

export async function fetchMyWallet(): Promise<WalletUser> {
  await wait();
  return users[0]!;
}

export async function fetchTransfers(): Promise<Transfer[]> {
  await wait();
  return transfers;
}

export async function fetchTransfer(id: string): Promise<Transfer> {
  await wait();
  const found = transfers.find((transfer) => transfer.id === id);
  if (!found) {
    throw new ApiError({ code: "WALLET_NOT_FOUND", status: 404, message: "That transfer does not exist." });
  }
  return found;
}

export async function fetchUsers(): Promise<WalletUser[]> {
  await wait();
  return users;
}

export async function sendTransfer(request: SendTransferRequest): Promise<Transfer> {
  await wait();

  const requestId = `demo-${request.idempotencyKey}`;
  const sender = users[0]!;

  if (outcome === "sessionExpired") {
    throw new ApiError({ code: "UNAUTHENTICATED", status: 401, message: "Your session has expired.", requestId });
  }
  if (outcome === "rateLimited") {
    throw new ApiError({ code: "RATE_LIMITED", status: 429, message: "Too many requests.", requestId, retryAfterSeconds: 10 });
  }
  if (outcome === "conflict") {
    throw new ApiError({
      code: "IDEMPOTENCY_KEY_CONFLICT",
      status: 409,
      message: "This request conflicts with an earlier one. Start a new transfer.",
      requestId,
    });
  }

  // The interesting one. The first attempt refuses to say whether it worked; retrying with
  // the same key resolves it. Nothing is written on the way through, so the retry is the
  // only thing that can commit.
  if (outcome === "unknown" && !seenUnknown.has(request.idempotencyKey)) {
    seenUnknown.add(request.idempotencyKey);
    throw new ApiError({
      code: "TRANSFER_UNAVAILABLE",
      status: 503,
      message: "We could not confirm this transfer. Retry with the same key.",
      requestId,
    });
  }

  const replayed = completed.get(request.idempotencyKey);
  if (replayed) return replayed;

  const recipient = users.find((user) => user.id === request.recipientWalletId);
  if (!recipient) {
    throw new ApiError({ code: "WALLET_NOT_FOUND", status: 404, message: "Wallet not found. Check the wallet ID and try again.", requestId });
  }
  if (sender.status !== "active") {
    throw new ApiError({ code: "SENDER_RESTRICTED", status: 403, message: "Your account is restricted. You cannot send transfers.", requestId });
  }
  if (recipient.status !== "active") {
    throw new ApiError({ code: "RECIPIENT_RESTRICTED", status: 403, message: "Recipient restricted. This wallet cannot receive transfers.", requestId });
  }
  if (BigInt(request.amountMinor) > BigInt(sender.balanceMinor)) {
    throw new ApiError({ code: "INSUFFICIENT_FUNDS", status: 422, message: "Insufficient funds. Enter an amount within your available balance.", requestId });
  }

  const transfer: Transfer = {
    id: `tx_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
    reference: request.idempotencyKey,
    counterpartyName: recipient.name,
    counterpartyWallet: recipient.id,
    amountMinor: request.amountMinor,
    direction: "sent",
    status: "completed",
    createdAt: new Date().toISOString(),
    ...(request.note ? { note: request.note } : {}),
  };

  const amount = BigInt(request.amountMinor);
  users = users.map((user) =>
    user.id === sender.id
      ? { ...user, balanceMinor: (BigInt(user.balanceMinor) - amount).toString() }
      : user.id === recipient.id
        ? { ...user, balanceMinor: (BigInt(user.balanceMinor) + amount).toString() }
        : user,
  );
  transfers = [transfer, ...transfers];
  completed.set(request.idempotencyKey, transfer);

  return transfer;
}

export async function setRestriction(walletId: string, blocked: boolean, reason: string): Promise<WalletUser> {
  await wait();
  const user = users.find((candidate) => candidate.id === walletId);
  if (!user) {
    throw new ApiError({ code: "WALLET_NOT_FOUND", status: 404, message: "That wallet does not exist." });
  }
  // A blacklist is a registration-time refusal, not something an admin lifts here.
  if (user.status === "blacklisted") {
    throw new ApiError({ code: "VALIDATION_FAILED", status: 422, message: "Blacklist restrictions cannot be lifted from here." });
  }
  if (!reason.trim()) {
    throw new ApiError({ code: "VALIDATION_FAILED", status: 422, message: "A reason is required for the audit record." });
  }
  const updated: WalletUser = { ...user, status: blocked ? "blocked" : "active" };
  users = users.map((candidate) => (candidate.id === walletId ? updated : candidate));
  return updated;
}

export async function createAccount(input: { name: string; email: string }): Promise<WalletUser> {
  await wait();
  const email = input.email.trim().toLowerCase();
  if (users.some((user) => user.email === email && user.status === "blacklisted")) {
    throw new ApiError({ code: "VALIDATION_FAILED", status: 422, message: "This email cannot be registered." });
  }
  if (users.some((user) => user.email === email)) {
    throw new ApiError({ code: "VALIDATION_FAILED", status: 409, message: "Email already registered." });
  }
  const user: WalletUser = {
    id: `wlt_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
    name: input.name.trim(),
    email,
    status: "active",
    balanceMinor: "0",
  };
  users = [...users, user];
  return user;
}
