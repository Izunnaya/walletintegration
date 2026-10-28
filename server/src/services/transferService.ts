import { randomUUID, randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma } from "../generated/prisma/client.ts";
import { prisma } from "../models/db.ts";
import { logger } from "../logger.ts";
import { lockTransferParties } from "../models/transferLocks.ts";
import { classifyTransactionError } from "../models/transactionErrors.ts";
import { checkTransferPolicy, fingerprintTransfer } from "../domain/transferPolicy.ts";
import type { TransferRejection } from "../domain/transferPolicy.ts";
import type { TransferRequest } from "../domain/transferRequest.ts";

const OPERATION = "POST /transfers";
const MAX_BIGINT = 9_223_372_036_854_775_807n;
const rejectionMessages: Record<TransferRejection, string> = {
  NOT_WALLET_OWNER: "The source wallet does not belong to you.",
  SAME_WALLET: "Source and destination wallets must differ.",
  SYSTEM_WALLET_NOT_TRANSFERABLE: "Transfers involving the system wallet are not allowed.",
  SENDER_BLOCKED: "The sending account is blocked.",
  SENDER_BLACKLISTED: "The sending account is blacklisted.",
  RECIPIENT_BLOCKED: "The receiving account is blocked.",
  RECIPIENT_BLACKLISTED: "The receiving account is blacklisted.",
  CURRENCY_MISMATCH: "Both wallets must use NGN.",
  INSUFFICIENT_FUNDS: "The sending wallet does not have enough funds.",
};

type TransferResult = { statusCode: number; body: Prisma.JsonObject };
function rejection(statusCode: number, code: string, message: string, requestId: string): TransferResult {
  return { statusCode, body: { error: { code, message, requestId } } };
}

async function executeTransfer(
  client: Prisma.TransactionClient, userId: bigint, key: string, request: TransferRequest, requestId: string,
): Promise<TransferResult> {
  await client.$executeRaw`SET LOCAL lock_timeout = '5s'`;
  const caller = await client.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!caller) return rejection(401, "UNAUTHENTICATED", "The account no longer exists.", requestId);

  // Resolve public aliases before hashing, so old numeric requests and new public IDs
  // have identical idempotency semantics. These IDs never change after creation.
  const publicIds = [request.sourceWalletId, request.destinationWalletId]
    .filter((id): id is string => typeof id === "string");
  if (publicIds.length > 0) {
    const matches = await client.wallet.findMany({
      where: { publicId: { in: publicIds } }, select: { id: true, publicId: true },
    });
    const resolve = (id: bigint | string) => matches.find((wallet) => wallet.publicId === id)?.id ?? id;
    request = { ...request, sourceWalletId: resolve(request.sourceWalletId), destinationWalletId: resolve(request.destinationWalletId) };
  }
  const fingerprint = fingerprintTransfer(request);
  const identity = { userId, operation: OPERATION, idempotencyKey: key };
  // This provisional rejection is uncommitted and always replaced before a successful commit.
  const claim = await client.idempotencyRecord.createMany({
    data: { ...identity, requestFingerprint: fingerprint, status: "rejected", responseStatusCode: 503, responseBody: {} },
    skipDuplicates: true,
  });
  if (claim.count === 0) {
    const saved = await client.idempotencyRecord.findUniqueOrThrow({
      where: { userId_operation_idempotencyKey: identity },
    });
    if (saved.requestFingerprint !== fingerprint) {
      return rejection(409, "IDEMPOTENCY_KEY_REUSED", "This key was already used for different transfer details.", requestId);
    }
    const body = saved.responseBody;
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid saved transfer response");
    return { statusCode: saved.responseStatusCode, body };
  }

  async function saveRejection(status: number, code: string, message: string) {
    const result = rejection(status, code, message, requestId);
    await client.idempotencyRecord.update({
      where: { userId_operation_idempotencyKey: identity },
      data: { status: "rejected", responseStatusCode: result.statusCode, responseBody: result.body },
    });
    return result;
  }

  const { users, wallets } = await lockTransferParties(client, [request.sourceWalletId, request.destinationWalletId].filter((id): id is bigint => typeof id === "bigint"));
  const source = wallets.find((wallet) => wallet.id === request.sourceWalletId);
  const destination = wallets.find((wallet) => wallet.id === request.destinationWalletId);
  if (!source) return saveRejection(404, "WALLET_NOT_FOUND", "The source wallet does not exist.");
  if (source.ownerId !== userId) return saveRejection(403, "NOT_WALLET_OWNER", rejectionMessages.NOT_WALLET_OWNER);
  if (!destination) return saveRejection(404, "WALLET_NOT_FOUND", "The destination wallet does not exist.");

  const sender = users.find((user) => user.id === source.ownerId);
  const recipient = users.find((user) => user.id === destination.ownerId);
  if (!sender || !recipient) throw new Error("Wallet ownership changed while acquiring locks");
  const blacklist = await client.blacklistEntry.findMany({
    where: { email: { in: [sender.email, recipient.email] } }, select: { email: true },
  });
  const policy = checkTransferPolicy({
    authenticatedUserId: userId, sourceWallet: source, destinationWallet: destination,
    amountMinor: request.amountMinor,
    sender: { userId: sender.id, isBlocked: sender.isBlocked, isBlacklisted: blacklist.some((entry) => entry.email === sender.email) },
    recipient: { userId: recipient.id, isBlocked: recipient.isBlocked, isBlacklisted: blacklist.some((entry) => entry.email === recipient.email) },
  });
  if (!policy.allowed) return saveRejection(422, policy.reason, rejectionMessages[policy.reason]);
  if (destination.balanceMinor + request.amountMinor > MAX_BIGINT) {
    return saveRejection(422, "BALANCE_LIMIT_EXCEEDED", "The receiving wallet cannot hold this amount.");
  }

  const transfer = await client.transfer.create({
    data: { ...request, sourceWalletId: source.id, destinationWalletId: destination.id, reference: randomUUID() },
  });
  await client.wallet.update({
    where: { id: source.id }, data: { balanceMinor: { decrement: request.amountMinor }, updatedAt: new Date() },
  });
  await client.wallet.update({
    where: { id: destination.id }, data: { balanceMinor: { increment: request.amountMinor }, updatedAt: new Date() },
  });
  await client.ledgerEntry.createMany({ data: [
    { transferId: transfer.id, walletId: source.id, entryType: "debit", amountMinor: -request.amountMinor, currency: request.currency },
    { transferId: transfer.id, walletId: destination.id, entryType: "credit", amountMinor: request.amountMinor, currency: request.currency },
  ] });
  const body = {
    transfer: {
      id: transfer.id.toString(), reference: transfer.reference,
      sourceWalletId: source.id.toString(), destinationWalletId: destination.id.toString(),
      sourceWalletPublicId: source.publicId, destinationWalletPublicId: destination.publicId,
      amountMinor: transfer.amountMinor.toString(), currency: transfer.currency, createdAt: transfer.createdAt.toISOString(),
    },
  };
  await client.idempotencyRecord.update({
    where: { userId_operation_idempotencyKey: identity },
    data: { status: "succeeded", transferId: transfer.id, responseStatusCode: 201, responseBody: body },
  });
  return { statusCode: 201, body };
}

export async function createTransfer(userId: bigint, key: string, request: TransferRequest, requestId: string): Promise<TransferResult> {
  // Retry only errors that establish a rollback. Never retry a possibly committed operation internally.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        (client) => executeTransfer(client, userId, key, request, requestId),
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5_000, timeout: 30_000 },
      );
    } catch (error) {
      const kind = classifyTransactionError(error);
      if (kind === "retry" && attempt < 3) {
        await delay(randomInt(25, 100) * (attempt + 1));
        continue;
      }
      if (kind === "retry" || kind === "unavailable") {
        logger.error({ requestId, err: error }, "transfer_unavailable");
        return rejection(503, "TRANSFER_UNAVAILABLE", "The transfer outcome could not be confirmed. Retry with the same Idempotency-Key.", requestId);
      }
      throw error;
    }
  }
}
