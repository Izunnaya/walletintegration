import { afterEach, expect, it, vi } from "vitest";
import type { Prisma } from "../src/generated/prisma/client.ts";
import { applySeed } from "../src/models/seedData.ts";

afterEach(() => vi.unstubAllEnvs());

it.each(["", "short", "            ", "a".repeat(73)])("rejects a weak admin password before touching the database", async (password) => {
  vi.stubEnv("SEED_ADMIN_PASSWORD", password);
  const client = {} as Prisma.TransactionClient;
  await expect(applySeed(client)).rejects.toThrow("registration password requirements");
});
