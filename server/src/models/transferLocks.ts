import { Prisma } from "../generated/prisma/client.ts";
import { databaseSchema } from "./db.ts";
import type { WalletState } from "../domain/transferPolicy.ts";

// Identifiers cannot be SQL parameters. This is configuration, never request input.
if (!/^[a-z_][a-z0-9_]*$/.test(databaseSchema)) throw new Error("Invalid database schema");
const namespace = Prisma.raw(`"${databaseSchema}"`);

export async function lockTransferParties(client: Prisma.TransactionClient, walletIds: bigint[]) {
  if (walletIds.length === 0) return { users: [], wallets: [] };
  // The subquery discovers immutable owners in the same round trip that locks users.
  // NO KEY UPDATE blocks restrictions while remaining compatible with the claim's FK lock.
  const users = await client.$queryRaw<{ id: bigint; email: string; isBlocked: boolean }[]>`
    SELECT id, email, is_blocked AS "isBlocked" FROM ${namespace}.users
    WHERE id IN (
      SELECT owner_id FROM ${namespace}.wallets WHERE id IN (${Prisma.join(walletIds)})
    ) ORDER BY id FOR NO KEY UPDATE
  `;
  if (users.length === 0) return { users, wallets: [] };
  const wallets = await client.$queryRaw<(WalletState & { publicId: string })[]>`
    SELECT id, public_id AS "publicId", owner_id AS "ownerId", currency, balance_minor AS "balanceMinor", is_system AS "isSystem"
    FROM ${namespace}.wallets WHERE id IN (${Prisma.join(walletIds)}) ORDER BY id FOR UPDATE
  `;
  return { users, wallets };
}

// Use the same ordered user locks as transfers so restrictions cannot race with money movement.
export type RestrictedUser = {
  id: bigint;
  email: string;
  name: string;
  role: string;
  isBlocked: boolean;
};

export async function lockUsersForRestriction(client: Prisma.TransactionClient, userIds: bigint[]) {
  const rows = await client.$queryRaw<RestrictedUser[]>`
    SELECT id, email, name, role, is_blocked AS "isBlocked" FROM ${namespace}.users
    WHERE id IN (${Prisma.join(userIds)}) ORDER BY id FOR NO KEY UPDATE
  `;

  return rows;
}
