import { afterAll, beforeAll, expect, it } from "vitest";
import { Prisma } from "../src/generated/prisma/client.ts";
import { apiPrisma, apiSchema, prepareApiDatabase, closeApiDatabase, fundWallet } from "./apiDatabase.ts";

const namespace = Prisma.raw(`"${apiSchema}"`);

beforeAll(async () => {
  await prepareApiDatabase();
  const system = await apiPrisma.user.create({
    data: { email: "system@history.test", name: "System", passwordHash: "unused", wallets: { create: { isSystem: true } } },
    include: { wallets: true },
  });
  const customer = await apiPrisma.user.create({
    data: { email: "customer@history.test", name: "Customer", passwordHash: "unused", wallets: { create: {} } },
    include: { wallets: true },
  });
  await fundWallet(customer.wallets[0]!.id, system.wallets[0]!.id, 100n, "history-fixture");
});

afterAll(closeApiDatabase);

it.each(["transfers", "ledger_entries"])("refuses updates and deletes on %s", async (table) => {
  const target = Prisma.raw(table);
  for (const query of [
    Prisma.sql`UPDATE ${namespace}.${target} SET amount_minor = amount_minor + 1`,
    Prisma.sql`DELETE FROM ${namespace}.${target}`,
  ]) {
    await expect(apiPrisma.$executeRaw(query)).rejects.toThrow("Financial history cannot be changed or deleted.");
  }
  expect(await apiPrisma.transfer.count()).toBe(1);
  expect(await apiPrisma.ledgerEntry.count()).toBe(2);
  expect((await apiPrisma.wallet.findMany({ where: { isSystem: false } }))[0]?.balanceMinor).toBe(100n);
});
