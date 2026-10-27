import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seedDependencies = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
  applySeed: vi.fn(),
  reportState: vi.fn(),
}));

vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
vi.mock("../src/models/db.ts", () => ({
  pool: { connect: seedDependencies.connect, end: seedDependencies.end },
}));
vi.mock("../src/models/seedData.ts", () => ({
  applySeed: seedDependencies.applySeed,
  reportState: seedDependencies.reportState,
}));

describe("seed command failure handling", () => {
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    seedDependencies.connect.mockResolvedValue({
      query: seedDependencies.query,
      release: seedDependencies.release,
    });
    seedDependencies.query.mockResolvedValue({ rows: [] });
    seedDependencies.end.mockResolvedValue(undefined);
    seedDependencies.applySeed.mockResolvedValue({ funded: ["ada@example.com"] });
    seedDependencies.reportState.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  });

  it("commits before reporting and releases the database resources", async () => {
    seedDependencies.reportState.mockImplementation(async () => {
      expect(seedDependencies.query.mock.calls).toEqual([["BEGIN"], ["COMMIT"]]);
    });

    await import("../src/seed.ts");

    expect(seedDependencies.reportState).toHaveBeenCalledOnce();
    expect(seedDependencies.release).toHaveBeenCalledOnce();
    expect(seedDependencies.end).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("rolls back an application failure and does not print a report", async () => {
    seedDependencies.applySeed.mockRejectedValue(new Error("seed write failed"));

    await import("../src/seed.ts");

    expect(seedDependencies.query.mock.calls).toEqual([["BEGIN"], ["ROLLBACK"]]);
    expect(seedDependencies.reportState).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("seed write failed");
    expect(seedDependencies.release).toHaveBeenCalledOnce();
    expect(seedDependencies.end).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it("reports a printing failure as committed without attempting rollback", async () => {
    seedDependencies.reportState.mockRejectedValue(new Error("report query failed"));

    await import("../src/seed.ts");

    expect(seedDependencies.query.mock.calls).toEqual([["BEGIN"], ["COMMIT"]]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Seed committed, but reporting failed."));
    expect(seedDependencies.release).toHaveBeenCalledOnce();
    expect(seedDependencies.end).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it("does not claim rollback or success when commit is not acknowledged", async () => {
    seedDependencies.query.mockImplementation(async (sql: string) => {
      if (sql === "COMMIT") throw new Error("connection lost");
      return { rows: [] };
    });

    await import("../src/seed.ts");

    expect(seedDependencies.query.mock.calls).toEqual([["BEGIN"], ["COMMIT"]]);
    expect(seedDependencies.reportState).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Seed commit was not acknowledged."));
    expect(seedDependencies.release).toHaveBeenCalledOnce();
    expect(seedDependencies.end).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });
});
