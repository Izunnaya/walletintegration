// The shapes the UI works in.
//
// These deliberately use the wallet API's vocabulary rather than the names the design export
// invented: amountMinor rather than amount, lowercase "sent" and "received" rather than
// "Sent" and "Received", status values that match the server's. Nothing in this phase talks
// to the server yet, so the names cost nothing now - and when the api/ hooks start fetching,
// the responses drop straight in instead of every screen needing a rename.
//
// Money is a string of minor units (kobo), never a number. A JSON number is an IEEE double,
// so a balance large enough stops being exact; the server sends strings for the same reason.

export type WalletStatus = "active" | "blocked" | "blacklisted";

export type WalletUser = {
  id: string;
  name: string;
  email: string;
  status: WalletStatus;
  balanceMinor: string;
};

export type TransferDirection = "sent" | "received";

export type Transfer = {
  id: string;
  reference: string;
  counterpartyName: string;
  counterpartyWallet: string;
  amountMinor: string;
  direction: TransferDirection;
  status: "completed";
  createdAt: string;
  note?: string;
};

export type SendTransferRequest = {
  recipientWalletId: string;
  amountMinor: string;
  idempotencyKey: string;
  note?: string;
};

// The error codes the UI reacts to differently. The server answers with a code and a request
// ID; these are the ones that change what the user is told to do next.
export type TransferErrorCode =
  | "VALIDATION_FAILED"
  | "WALLET_NOT_FOUND"
  | "INSUFFICIENT_FUNDS"
  | "SENDER_RESTRICTED"
  | "RECIPIENT_RESTRICTED"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "RATE_LIMITED"
  | "UNAUTHENTICATED"
  | "TRANSFER_UNAVAILABLE";

// Thrown by the api layer so a screen can branch on the code instead of matching message
// text. requestId is what a user quotes when reporting a failure, so it is carried through.
export class ApiError extends Error {
  readonly code: TransferErrorCode;
  readonly status: number;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;

  constructor(options: {
    code: TransferErrorCode;
    status: number;
    message: string;
    requestId?: string;
    retryAfterSeconds?: number;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
