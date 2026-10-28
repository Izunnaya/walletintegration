import { describe, expect, it } from "vitest";
import { checkTransferPolicy, fingerprintTransfer } from "../src/domain/transferPolicy.ts";
import type {
  PartyState,
  TransferPolicyInput,
  WalletState,
} from "../src/domain/transferPolicy.ts";
import { transferRequestSchema } from "../src/domain/transferRequest.ts";
import type { TransferRequest } from "../src/domain/transferRequest.ts";

const validBody = {
  sourceWalletId: "7",
  destinationWalletId: "12",
  currency: "NGN",
  amountMinor: "150000",
};

const messagesOf = (body: unknown): string[] => {
  const result = transferRequestSchema.safeParse(body);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("transferRequestSchema", () => {
  it("accepts a valid body and hands back the amount as a bigint", () => {
    const result = transferRequestSchema.safeParse(validBody);

    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({
      sourceWalletId: 7n,
      destinationWalletId: 12n,
      currency: "NGN",
      amountMinor: 150000n,
    });
  });

  it("refuses a body that is not an object", () => {
    for (const body of [null, undefined, "x", 1, [], true]) {
      expect(transferRequestSchema.safeParse(body).success).toBe(false);
    }
  });

  it("refuses a wallet id that is not a positive whole number", () => {
    for (const id of [0, -1, 1.5, 7, "0", "-1", "1.5", "9223372036854775808", null, undefined]) {
      expect(transferRequestSchema.safeParse({ ...validBody, sourceWalletId: id }).success).toBe(
        false,
      );
    }
  });

  it("names the field that failed", () => {
    const result = transferRequestSchema.safeParse({ ...validBody, destinationWalletId: 0n });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.path).toEqual([
      "destinationWalletId",
    ]);
  });

  it("reports every failure at once rather than one at a time", () => {
    const result = transferRequestSchema.safeParse({
      sourceWalletId: 0n,
      destinationWalletId: -1,
      currency: "USD",
      amountMinor: "0",
    });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues.length).toBeGreaterThanOrEqual(4);
  });

  it("refuses any currency other than NGN", () => {
    for (const currency of ["USD", "ngn", "", null, undefined]) {
      expect(messagesOf({ ...validBody, currency })).toContain("currency must be NGN");
    }
  });

  it("refuses a numeric amount even when the value would be valid", () => {
    expect(messagesOf({ ...validBody, amountMinor: 150000 })).toContain(
      "amountMinor must be a string of kobo, not a number",
    );
  });

  it.each(["", " ", "-1", "1.5", "1e4", "+1", "0x1f", "12a"])(
    "reports invalid amount %j at its field without throwing during conversion",
    (amountMinor) => {
      const result = transferRequestSchema.safeParse({ ...validBody, amountMinor });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual([
          expect.objectContaining({
            path: ["amountMinor"],
            message: "amountMinor must contain digits only",
          }),
        ]);
      }
    },
  );

  it("normalises padded amounts without changing the input body", () => {
    const body = { ...validBody, amountMinor: " 000150000 " };
    expect(transferRequestSchema.parse(body).amountMinor).toBe(150000n);
    expect(body.amountMinor).toBe(" 000150000 ");
  });

  it("refuses an amount of zero, and one above the maximum", () => {
    expect(messagesOf({ ...validBody, amountMinor: "0" })).toContain(
      "amountMinor must be greater than zero",
    );
    expect(messagesOf({ ...validBody, amountMinor: "1000000001" })[0]).toMatch(/must not exceed/);
  });

  it("refuses an unknown field rather than silently dropping it", () => {
    // A body carrying userId is either a client bug or an attempt to send as someone else.
    // The sender always comes from the token, so this is refused, not ignored.
    expect(transferRequestSchema.safeParse({ ...validBody, userId: 999n }).success).toBe(false);
  });
});

describe("fingerprintTransfer", () => {
  const request = (): TransferRequest => ({
    sourceWalletId: 7n,
    destinationWalletId: 12n,
    currency: "NGN",
    amountMinor: 150000n,
  });

  it("is stable for the same intent", () => {
    expect(fingerprintTransfer(request())).toBe(fingerprintTransfer(request()));
  });

  it("ignores how the client formatted the request", () => {
    // Different key order and a padded amount: the same intent, so the same fingerprint.
    const parsed = transferRequestSchema.safeParse({
      amountMinor: "  150000 ",
      currency: "NGN",
      destinationWalletId: "12",
      sourceWalletId: "7",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success ? fingerprintTransfer(parsed.data) : "").toBe(
      fingerprintTransfer(request()),
    );
  });

  it("changes when the amount changes", () => {
    expect(fingerprintTransfer({ ...request(), amountMinor: 150001n })).not.toBe(
      fingerprintTransfer(request()),
    );
  });

  it("changes when the direction is reversed", () => {
    expect(
      fingerprintTransfer({ ...request(), sourceWalletId: 12n, destinationWalletId: 7n }),
    ).not.toBe(fingerprintTransfer(request()));
  });

  it("cannot be confused by field values that run together", () => {
    // Without a separator, (1, 23) and (12, 3) would hash to the same value.
    expect(
      fingerprintTransfer({ ...request(), sourceWalletId: 1n, destinationWalletId: 23n }),
    ).not.toBe(fingerprintTransfer({ ...request(), sourceWalletId: 12n, destinationWalletId: 3n }));
  });
});

describe("checkTransferPolicy", () => {
  const party = (over: Partial<PartyState> = {}): PartyState => ({
    userId: 1n,
    isBlocked: false,
    isBlacklisted: false,
    ...over,
  });

  const wallet = (over: Partial<WalletState> = {}): WalletState => ({
    id: 7n,
    ownerId: 1n,
    currency: "NGN",
    balanceMinor: 200000n,
    isSystem: false,
    ...over,
  });

  const input = (over: Partial<TransferPolicyInput> = {}): TransferPolicyInput => ({
    authenticatedUserId: 1n,
    sender: party({ userId: 1n }),
    recipient: party({ userId: 2n }),
    sourceWallet: wallet({ id: 7n, ownerId: 1n }),
    destinationWallet: wallet({ id: 12n, ownerId: 2n, balanceMinor: 0n }),
    amountMinor: 150000n,
    ...over,
  });

  it("allows a transfer that breaks no rule", () => {
    expect(checkTransferPolicy(input())).toEqual({ allowed: true });
  });

  it("refuses a wallet the caller does not own", () => {
    expect(checkTransferPolicy(input({ authenticatedUserId: 99n }))).toEqual({
      allowed: false,
      reason: "NOT_WALLET_OWNER",
    });
  });

  it("checks ownership before anything else, so a stranger learns nothing", () => {
    // Not the owner, and also insufficient funds, and also blocked. Ownership must win,
    // or the rejection reason would leak the state of a wallet the caller cannot see.
    const result = checkTransferPolicy(
      input({
        authenticatedUserId: 99n,
        sender: party({ userId: 1n, isBlocked: true }),
        sourceWallet: wallet({ id: 7n, ownerId: 1n, balanceMinor: 0n }),
      }),
    );

    expect(result).toEqual({ allowed: false, reason: "NOT_WALLET_OWNER" });
  });

  it("refuses a transfer to the same wallet", () => {
    expect(
      checkTransferPolicy(input({ destinationWallet: wallet({ id: 7n, ownerId: 1n }) })),
    ).toEqual({ allowed: false, reason: "SAME_WALLET" });
  });

  it("refuses the system wallet on either side", () => {
    expect(
      checkTransferPolicy(input({ sourceWallet: wallet({ id: 7n, ownerId: 1n, isSystem: true }) })),
    ).toEqual({ allowed: false, reason: "SYSTEM_WALLET_NOT_TRANSFERABLE" });

    expect(
      checkTransferPolicy(
        input({ destinationWallet: wallet({ id: 12n, ownerId: 2n, isSystem: true }) }),
      ),
    ).toEqual({ allowed: false, reason: "SYSTEM_WALLET_NOT_TRANSFERABLE" });
  });

  it("refuses a blocked or blacklisted sender", () => {
    expect(checkTransferPolicy(input({ sender: party({ isBlocked: true }) }))).toEqual({
      allowed: false,
      reason: "SENDER_BLOCKED",
    });

    expect(checkTransferPolicy(input({ sender: party({ isBlacklisted: true }) }))).toEqual({
      allowed: false,
      reason: "SENDER_BLACKLISTED",
    });
  });

  it("refuses a blocked or blacklisted recipient, so a restriction stops both directions", () => {
    expect(
      checkTransferPolicy(input({ recipient: party({ userId: 2n, isBlocked: true }) })),
    ).toEqual({ allowed: false, reason: "RECIPIENT_BLOCKED" });

    expect(
      checkTransferPolicy(input({ recipient: party({ userId: 2n, isBlacklisted: true }) })),
    ).toEqual({ allowed: false, reason: "RECIPIENT_BLACKLISTED" });
  });

  it("refuses a currency mismatch", () => {
    expect(
      checkTransferPolicy(
        input({ destinationWallet: wallet({ id: 12n, ownerId: 2n, currency: "USD" }) }),
      ),
    ).toEqual({ allowed: false, reason: "CURRENCY_MISMATCH" });
  });

  it("refuses an amount above the balance", () => {
    expect(
      checkTransferPolicy(
        input({ sourceWallet: wallet({ id: 7n, ownerId: 1n, balanceMinor: 149999n }) }),
      ),
    ).toEqual({ allowed: false, reason: "INSUFFICIENT_FUNDS" });
  });

  it("allows spending the balance down to exactly zero", () => {
    expect(
      checkTransferPolicy(
        input({ sourceWallet: wallet({ id: 7n, ownerId: 1n, balanceMinor: 150000n }) }),
      ),
    ).toEqual({ allowed: true });
  });
});
