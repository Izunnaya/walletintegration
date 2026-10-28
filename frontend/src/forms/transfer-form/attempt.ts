import { z } from "zod";
import type { SendTransferRequest } from "@/api/contracts";
import { databaseIdSchema } from "@/lib/validation";

const attemptSchema = z.object({
  sourceWalletId: databaseIdSchema,
  destinationWalletId: databaseIdSchema,
  amountMinor: z
    .string()
    .regex(/^\d+$/)
    .transform((value) => BigInt(value))
    .pipe(z.bigint().positive().max(1_000_000_000n))
    .transform(String),
  idempotencyKey: z.string().uuid(),
  phase: z.enum(["review", "unconfirmed", "rejected"]),
  retryAt: z.number().nonnegative(),
});
export type TransferAttempt = z.infer<typeof attemptSchema>;

export function transferDetails(attempt: TransferAttempt): SendTransferRequest {
  return {
    sourceWalletId: attempt.sourceWalletId,
    destinationWalletId: attempt.destinationWalletId,
    amountMinor: attempt.amountMinor,
    idempotencyKey: attempt.idempotencyKey,
  };
}
export function sameTransfer(
  attempt: TransferAttempt,
  sourceWalletId: string,
  destinationWalletId: string,
  amountMinor: string,
) {
  return (
    attempt.sourceWalletId === sourceWalletId &&
    attempt.destinationWalletId === destinationWalletId &&
    attempt.amountMinor === amountMinor
  );
}
export function readAttempt(
  userId: string | undefined,
): TransferAttempt | null {
  if (!userId) return null;
  try {
    return attemptSchema.parse(
      JSON.parse(sessionStorage.getItem(`wallet.transfer:${userId}`) ?? "null"),
    );
  } catch {
    return null;
  }
}
export function saveAttempt(userId: string, attempt: TransferAttempt | null) {
  if (attempt)
    sessionStorage.setItem(
      `wallet.transfer:${userId}`,
      JSON.stringify(attempt),
    );
  else sessionStorage.removeItem(`wallet.transfer:${userId}`);
}
