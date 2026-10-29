import { afterAll, expect, it } from "vitest";
import { pool, testPrisma } from "./database.ts";
import { testDatabaseUrl } from "./testDatabaseUrl.ts";

afterAll(async () => {
  await testPrisma.$disconnect();
  await pool.end();
});

it("runs Prisma and direct SQL inside the requested test schema", async () => {
  const expected = testDatabaseUrl(process.env.TEST_DATABASE_URL).searchParams.get("schema");
  const prismaResult = await testPrisma.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`;
  const directResult = await pool.query("SELECT current_schema() AS schema");
  expect(prismaResult[0]?.schema).toBe(expected);
  expect(directResult.rows[0]?.schema).toBe(expected);
});
