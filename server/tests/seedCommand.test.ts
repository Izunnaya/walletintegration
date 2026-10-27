import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  transaction: vi.fn(),
  disconnect: vi.fn(),
  applySeed: vi.fn(),
  reportState: vi.fn(),
}));

vi.mock("dotenv/config", () => ({}));
vi.mock("../src/models/db.ts", () => ({
  databaseSchema: "public",
  prisma: { $transaction: dependencies.transaction, $disconnect: dependencies.disconnect },
}));
vi.mock("../src/models/seedData.ts", () => ({
  applySeed: dependencies.applySeed,
  reportState: dependencies.reportState,
}));

describe("Prisma seed command", () => {
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    dependencies.disconnect.mockResolvedValue(undefined);
    dependencies.transaction.mockImplementation(async (work: (transaction: object) => Promise<unknown>) => work({}));
    dependencies.applySeed.mockResolvedValue({ funded: ["ada@example.com"] });
    dependencies.reportState.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  });

  it("waits for the transaction to finish before reporting", async () => {
    let transactionCompleted = false;
    dependencies.transaction.mockImplementation(async (work: (transaction: object) => Promise<unknown>) => {
      const result = await work({});
      transactionCompleted = true;
      return result;
    });
    dependencies.reportState.mockImplementation(async () => {
      expect(transactionCompleted).toBe(true);
    });

    await import("../src/seed.ts");

    expect(dependencies.applySeed).toHaveBeenCalledOnce();
    expect(dependencies.reportState).toHaveBeenCalledOnce();
    expect(dependencies.disconnect).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("skips reporting when a seed write fails", async () => {
    dependencies.applySeed.mockRejectedValue(new Error("seed write failed"));

    await import("../src/seed.ts");

    expect(dependencies.reportState).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Seed transaction did not complete successfully."));
    expect(dependencies.disconnect).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it("reports printing failure as committed without retrying the transaction", async () => {
    dependencies.reportState.mockRejectedValue(new Error("report query failed"));

    await import("../src/seed.ts");

    expect(dependencies.transaction).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Seed committed, but reporting failed."));
    expect(dependencies.disconnect).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it("does not claim rollback or success when transaction acknowledgement is lost", async () => {
    dependencies.transaction.mockRejectedValue(new Error("connection lost"));

    await import("../src/seed.ts");

    expect(dependencies.reportState).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("the outcome may be unknown"));
    expect(dependencies.disconnect).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });
});
