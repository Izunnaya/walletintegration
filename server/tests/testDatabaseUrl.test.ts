import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./testDatabaseUrl.ts";

describe("test database isolation", () => {
  it.each([undefined, "postgres://localhost/wallet", "postgres://localhost/wallet?schema=public", "postgres://localhost/wallet?schema=production"])("refuses an application database: %s", (input) => {
    expect(() => testDatabaseUrl(input)).toThrow();
  });

  it("scopes Prisma and raw SQL to the same test schema on a direct connection", () => {
    const url = testDatabaseUrl("postgres://example-pooler.test/wallet?schema=wallet_test_a&options=bad", "wallet_auth_test_b");
    expect(url.hostname).toBe("example.test");
    expect(url.searchParams.get("schema")).toBe("wallet_auth_test_b");
    expect(url.searchParams.get("options")).toBe("-c search_path=wallet_auth_test_b");
  });

  it("cannot override the test schema with public or SQL", () => {
    for (const schema of ["public", "wallet_test_a; DROP SCHEMA public CASCADE"]) {
      expect(() => testDatabaseUrl("postgres://localhost/wallet?schema=wallet_test_a", schema)).toThrow();
    }
  });
});
