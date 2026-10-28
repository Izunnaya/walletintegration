import { Prisma } from "../generated/prisma/client.ts";
import { databaseSchema } from "./db.ts";
import type { WalletState } from "../domain/transferPolicy.ts";

// Identifiers cannot be SQL parameters. This is configuration, never request input.
if (!/^[a-z_][a-z0-9_]*$/.test(databaseSchema)) throw new Error("Invalid database schema");
const namespace = Prisma.raw(`"${databaseSchema}"`);

export async function lockTransferParties(client: Prisma.TransactionClient, walletIds: bigint[]) {
  // The subquery discovers immutable owners in the same round trip that locks users.
  // NO KEY UPDATE blocks restrictions while remaining compatible with the claim's FK lock.
  const users = await client.$queryRaw<{ id: bigint; email: string; isBlocked: boolean }[]>`
    SELECT id, email, is_blocked AS "isBlocked" FROM ${namespace}.users
    WHERE id IN (
      SELECT owner_id FROM ${namespace}.wallets WHERE id IN (${Prisma.join(walletIds)})
    ) ORDER BY id FOR NO KEY UPDATE
  `;
  if (users.length === 0) return { users, wallets: [] };
  const wallets = await client.$queryRaw<WalletState[]>`
    SELECT id, owner_id AS "ownerId", currency, balance_minor AS "balanceMinor", is_system AS "isSystem"
    FROM ${namespace}.wallets WHERE id IN (${Prisma.join(walletIds)}) ORDER BY id FOR UPDATE
  `;
  return { users, wallets };
}

// The same row lock, on the same table, that lockTransferParties takes. Block and unblock go
// through this so a restriction change and a transfer involving that user serialise rather
// than interleave: whichever acquires the lock first decides.
//
// FOR NO KEY UPDATE for the same reason as above - FOR UPDATE would conflict with the
// FOR KEY SHARE that an idempotency record's foreign key takes.
export type RestrictedUser = {
  id: bigint;
  email: string;
  name: string;
  role: string;
  isBlocked: boolean;
};

export async function lockUserForRestriction(client: Prisma.TransactionClient, userId: bigint) {
  const rows = await client.$queryRaw<RestrictedUser[]>`
    SELECT id, email, name, role, is_blocked AS "isBlocked" FROM ${namespace}.users
    WHERE id = ${userId} FOR NO KEY UPDATE
  `;

  return rows[0] ?? null;
}
