import { z } from "zod";

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["customer", "admin"]),
});
export const walletSchema = z.object({
  id: z.string(),
  currency: z.literal("NGN"),
  balanceMinor: z.string().regex(/^\d+$/),
});
export const sessionSchema = z.object({
  token: z.string().min(1),
  user: userSchema,
});
export const registrationSchema = z.object({
  user: userSchema,
  wallet: walletSchema,
});
export const transferSchema = z.object({
  id: z.string(),
  reference: z.string(),
  sourceWalletId: z.string(),
  destinationWalletId: z.string(),
  amountMinor: z.string().regex(/^\d+$/),
  currency: z.literal("NGN"),
  createdAt: z.string().datetime(),
});
export const historyTransferSchema = transferSchema.extend({
  direction: z.enum(["sent", "received"]),
});
export const transferPageSchema = z.object({
  transfers: z.array(historyTransferSchema),
  nextCursor: z.string().nullable(),
});
export const restrictionSchema = z.object({
  user: userSchema.extend({ isBlocked: z.boolean() }),
  changed: z.boolean(),
  note: z.string().optional(),
});
export const auditSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      action: z.enum(["block", "unblock"]),
      reason: z.string().nullable(),
      createdAt: z.string().datetime(),
      actor: z.object({ id: z.string(), email: z.string() }),
      affected: z.object({ id: z.string(), email: z.string() }),
    }),
  ),
});

export type User = z.infer<typeof userSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Wallet = z.infer<typeof walletSchema>;
export type Transfer = z.infer<typeof historyTransferSchema>;
export type SendTransferRequest = {
  sourceWalletId: string;
  destinationWalletId: string;
  amountMinor: string;
  idempotencyKey: string;
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly requestId?: string,
    readonly retryAfterSeconds?: number,
    readonly details: { field: string | null; message: string }[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}
