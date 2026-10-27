import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkTransferPolicy,
  fingerprintTransfer,
  normaliseTransferRequest,
} from "../src/domain/transferPolicy.ts";
import type {
  NormalisedTransferRequest,
  PartyState,
  TransferPolicyInput,
  WalletState,
} from "../src/domain/transferPolicy.ts";

const validBody = {
  sourceWalletId: 7,
  destinationWalletId: 12,
  currency: "NGN",
  amountMinor: "150000",
};

describe("normaliseTransferRequest", () => {
  it("returns a typed request with the amount as a bigint", () => {
    const result = normaliseTransferRequest(validBody);

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.request, {
      sourceWalletId: 7,
      destinationWalletId: 12,
      currency: "NGN",
      amountMinor: 150000n,
    });
  });

  it("refuses a body that is not an object", () => {
    for (const body of [null, undefined, "x", 1, [], true]) {
      assert.deepEqual(normaliseTransferRequest(body), {
        ok: false,
        reason: "BODY_NOT_AN_OBJECT",
      });
    }
  });

  it("refuses a wallet id that is not a positive safe integer", () => {
    for (const id of [0, -1, 1.5, "7", null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
      assert.deepEqual(normaliseTransferRequest({ ...validBody, sourceWalletId: id }), {
        ok: false,
        reason: "SOURCE_WALLET_ID_INVALID",
      });
    }
  });

  it("refuses any currency other than NGN", () => {
    for (const currency of ["USD", "ngn", "", null, undefined]) {
      assert.deepEqual(normaliseTransferRequest({ ...validBody, currency }), {
        ok: false,
        reason: "CURRENCY_UNSUPPORTED",
      });
    }
  });

  it("passes the amount rejection through unchanged", () => {
    assert.deepEqual(normaliseTransferRequest({ ...validBody, amountMinor: "0" }), {
      ok: false,
      reason: "AMOUNT_NOT_POSITIVE",
    });
    assert.deepEqual(normaliseTransferRequest({ ...validBody, amountMinor: 150000 }), {
      ok: false,
      reason: "AMOUNT_NOT_A_STRING",
    });
  });

  it("ignores fields it was not asked for", () => {
    const result = normaliseTransferRequest({ ...validBody, userId: 999, role: "admin" });

    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.ok ? result.request : {}).sort(), [
      "amountMinor",
      "currency",
      "destinationWalletId",
      "sourceWalletId",
    ]);
  });
});

describe("fingerprintTransfer", () => {
  const request = (): NormalisedTransferRequest => ({
    sourceWalletId: 7,
    destinationWalletId: 12,
    currency: "NGN",
    amountMinor: 150000n,
  });

  it("is stable for the same intent", () => {
    assert.equal(fingerprintTransfer(request()), fingerprintTransfer(request()));
  });

  it("ignores how the client formatted the request", () => {
    // Different key order and a padded amount: the same intent, so the same fingerprint.
    const reordered = normaliseTransferRequest({
      amountMinor: "  150000 ",
      currency: "NGN",
      destinationWalletId: 12,
      sourceWalletId: 7,
    });

    assert.equal(reordered.ok, true);
    assert.equal(
      reordered.ok ? fingerprintTransfer(reordered.request) : "",
      fingerprintTransfer(request()),
    );
  });

  it("changes when the amount changes", () => {
    assert.notEqual(
      fingerprintTransfer({ ...request(), amountMinor: 150001n }),
      fingerprintTransfer(request()),
    );
  });

  it("changes when the direction is reversed", () => {
    assert.notEqual(
      fingerprintTransfer({ ...request(), sourceWalletId: 12, destinationWalletId: 7 }),
      fingerprintTransfer(request()),
    );
  });

  it("cannot be confused by field values that run together", () => {
    // Without a separator, (1, 23) and (12, 3) would hash to the same value.
    assert.notEqual(
      fingerprintTransfer({ ...request(), sourceWalletId: 1, destinationWalletId: 23 }),
      fingerprintTransfer({ ...request(), sourceWalletId: 12, destinationWalletId: 3 }),
    );
  });
});

describe("checkTransferPolicy", () => {
  const party = (over: Partial<PartyState> = {}): PartyState => ({
    userId: 1,
    isBlocked: false,
    isBlacklisted: false,
    ...over,
  });

  const wallet = (over: Partial<WalletState> = {}): WalletState => ({
    id: 7,
    ownerId: 1,
    currency: "NGN",
    balanceMinor: 200000n,
    isSystem: false,
    ...over,
  });

  const input = (over: Partial<TransferPolicyInput> = {}): TransferPolicyInput => ({
    authenticatedUserId: 1,
    sender: party({ userId: 1 }),
    recipient: party({ userId: 2 }),
    sourceWallet: wallet({ id: 7, ownerId: 1 }),
    destinationWallet: wallet({ id: 12, ownerId: 2, balanceMinor: 0n }),
    amountMinor: 150000n,
    ...over,
  });

  it("allows a transfer that breaks no rule", () => {
    assert.deepEqual(checkTransferPolicy(input()), { allowed: true });
  });

  it("refuses a wallet the caller does not own", () => {
    assert.deepEqual(checkTransferPolicy(input({ authenticatedUserId: 99 })), {
      allowed: false,
      reason: "NOT_WALLET_OWNER",
    });
  });

  it("checks ownership before anything else, so a stranger learns nothing", () => {
    // Not the owner, and also insufficient funds, and also blocked. Ownership must win,
    // or the rejection reason would leak the state of a wallet the caller cannot see.
    const result = checkTransferPolicy(
      input({
        authenticatedUserId: 99,
        sender: party({ userId: 1, isBlocked: true }),
        sourceWallet: wallet({ id: 7, ownerId: 1, balanceMinor: 0n }),
      }),
    );

    assert.deepEqual(result, { allowed: false, reason: "NOT_WALLET_OWNER" });
  });

  it("refuses a transfer to the same wallet", () => {
    assert.deepEqual(
      checkTransferPolicy(input({ destinationWallet: wallet({ id: 7, ownerId: 1 }) })),
      { allowed: false, reason: "SAME_WALLET" },
    );
  });

  it("refuses the system wallet on either side", () => {
    assert.deepEqual(
      checkTransferPolicy(input({ sourceWallet: wallet({ id: 7, ownerId: 1, isSystem: true }) })),
      { allowed: false, reason: "SYSTEM_WALLET_NOT_TRANSFERABLE" },
    );
    assert.deepEqual(
      checkTransferPolicy(
        input({ destinationWallet: wallet({ id: 12, ownerId: 2, isSystem: true }) }),
      ),
      { allowed: false, reason: "SYSTEM_WALLET_NOT_TRANSFERABLE" },
    );
  });

  it("refuses a blocked or blacklisted sender", () => {
    assert.deepEqual(checkTransferPolicy(input({ sender: party({ isBlocked: true }) })), {
      allowed: false,
      reason: "SENDER_BLOCKED",
    });
    assert.deepEqual(checkTransferPolicy(input({ sender: party({ isBlacklisted: true }) })), {
      allowed: false,
      reason: "SENDER_BLACKLISTED",
    });
  });

  it("refuses a blocked or blacklisted recipient, so a restriction stops both directions", () => {
    assert.deepEqual(
      checkTransferPolicy(input({ recipient: party({ userId: 2, isBlocked: true }) })),
      { allowed: false, reason: "RECIPIENT_BLOCKED" },
    );
    assert.deepEqual(
      checkTransferPolicy(input({ recipient: party({ userId: 2, isBlacklisted: true }) })),
      { allowed: false, reason: "RECIPIENT_BLACKLISTED" },
    );
  });

  it("refuses a currency mismatch", () => {
    assert.deepEqual(
      checkTransferPolicy(
        input({ destinationWallet: wallet({ id: 12, ownerId: 2, currency: "USD" }) }),
      ),
      { allowed: false, reason: "CURRENCY_MISMATCH" },
    );
  });

  it("refuses an amount above the balance", () => {
    assert.deepEqual(
      checkTransferPolicy(
        input({ sourceWallet: wallet({ id: 7, ownerId: 1, balanceMinor: 149999n }) }),
      ),
      { allowed: false, reason: "INSUFFICIENT_FUNDS" },
    );
  });

  it("allows spending the balance down to exactly zero", () => {
    assert.deepEqual(
      checkTransferPolicy(
        input({ sourceWallet: wallet({ id: 7, ownerId: 1, balanceMinor: 150000n }) }),
      ),
      { allowed: true },
    );
  });
});
