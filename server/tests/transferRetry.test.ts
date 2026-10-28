import { beforeEach, describe, expect, it, vi } from "vitest";
const transaction = vi.hoisted(() => vi.fn());
vi.mock("../src/models/db.ts", () => ({ prisma: { $transaction: transaction }, databaseSchema: "public" }));
import { createTransfer } from "../src/services/transferService.ts";
import { classifyTransactionError } from "../src/models/transactionErrors.ts";
import { databaseIdSchema, idempotencyKeySchema } from "../src/domain/transferRequest.ts";

beforeEach(() => { transaction.mockReset(); });
const request = { sourceWalletId: 1n, destinationWalletId: 2n, currency: "NGN" as const, amountMinor: 100n };

describe("transfer boundary validation", () => {
  it("keeps IDs beyond JavaScript's exact integer range and enforces PostgreSQL's range", () => {
    expect(databaseIdSchema.parse("9007199254740993")).toBe(9007199254740993n);
    expect(databaseIdSchema.parse("9223372036854775807")).toBe(9223372036854775807n);
    for (const id of ["9223372036854775808", "0", "-1", "1e2", 1]) {
      expect(databaseIdSchema.safeParse(id).success).toBe(false);
    }
  });
  it("bounds keys and rejects whitespace rather than changing key identity", () => {
    expect(idempotencyKeySchema.parse("transfer:123_test-1.0")).toBe("transfer:123_test-1.0");
    expect(idempotencyKeySchema.safeParse("x".repeat(128)).success).toBe(true);
    for (const key of [undefined, "", " padded ", "one,two", "x".repeat(129)]) {
      expect(idempotencyKeySchema.safeParse(key).success).toBe(false);
    }
  });
});

describe("whole-transaction retry boundary (mocked, not proof of locking)", () => {
  it("retries recognized rollback failures and returns a subsequent committed result", async () => {
    const result = { statusCode: 201, body: { transfer: { id: "1" } } };
    transaction.mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({ code: "P2010", meta: { code: "40P01" } })
      .mockResolvedValueOnce(result);
    expect(await createTransfer(1n, "key", request, "request")).toEqual(result);
    expect(transaction).toHaveBeenCalledTimes(3);
  });
  it("stops after three retries", async () => {
    transaction.mockRejectedValue({ code: "P2034" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await createTransfer(1n, "key", request, "request")).statusCode).toBe(503);
      expect(transaction).toHaveBeenCalledTimes(4);
    } finally { log.mockRestore(); }
  });
  it.each([{ code: "P1017" }, { code: "P2010", meta: { code: "55P03" } }, { code: "ECONNRESET" }])(
    "does not internally retry an uncertain outcome or lock timeout: %j", async (error) => {
      transaction.mockRejectedValue(error);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await createTransfer(1n, "key", request, "request");
        expect(result.statusCode).toBe(503);
        expect(transaction).toHaveBeenCalledTimes(1);
      } finally { log.mockRestore(); }
    },
  );
  it("preserves an unexpected application error instead of calling it a business rejection", async () => {
    const error = new Error("application bug");
    transaction.mockRejectedValue(error);
    await expect(createTransfer(1n, "key", request, "request")).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it("recognizes adapter SQLSTATEs without retrying integrity failures", () => {
    expect(classifyTransactionError({ meta: { driverAdapterError: { cause: { originalCode: "40001" } } } })).toBe("retry");
    expect(classifyTransactionError({ code: "P2002" })).toBe("unexpected");
    expect(classifyTransactionError({ code: "P2010", meta: { code: "23514" } })).toBe("unexpected");
  });
});
