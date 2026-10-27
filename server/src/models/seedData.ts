import { Prisma } from "../generated/prisma/client.ts";

const DEMO_PASSWORD_HASH = "$2b$10$seedonlyplaceholderhashreplacedbyauthwork000000000000";

type DemoCustomer = {
  email: string;
  name: string;
  fundingReference: string;
  fundingAmountMinor: bigint;
};

const SYSTEM_OWNER_EMAIL = "system@wallet.internal";
const ADMIN_EMAIL = "admin@wallet.internal";

const DEMO_CUSTOMERS: DemoCustomer[] = [
  { email: "ada@example.com", name: "Ada Okafor", fundingReference: "seed-fund-ada", fundingAmountMinor: 50000000n },
  { email: "bode@example.com", name: "Bode Adeyemi", fundingReference: "seed-fund-bode", fundingAmountMinor: 25000000n },
  { email: "chidi@example.com", name: "Chidi Nwosu", fundingReference: "seed-fund-chidi", fundingAmountMinor: 1000n },
];

const BLACKLISTED = [
  { email: "fraudster@example.com", reason: "Seeded to demonstrate registration being refused" },
];

// Never update existing users: rerunning the seed must not reset their password.
async function ensureUser(client: Prisma.TransactionClient, email: string, name: string, role: string) {
  await client.user.createMany({
    data: { email, name, role, passwordHash: DEMO_PASSWORD_HASH },
    skipDuplicates: true,
  });
  return client.user.findUniqueOrThrow({ where: { email } });
}

async function ensureWallet(client: Prisma.TransactionClient, ownerId: bigint) {
  await client.wallet.createMany({ data: { ownerId }, skipDuplicates: true });
  return client.wallet.findUniqueOrThrow({
    where: { ownerId_currency: { ownerId, currency: "NGN" } },
  });
}

async function ensureSystemWallet(client: Prisma.TransactionClient) {
  const owner = await ensureUser(client, SYSTEM_OWNER_EMAIL, "System Funding", "admin");
  const existing = await client.wallet.findFirst({ where: { isSystem: true } });
  if (existing) return existing;
  return client.wallet.create({ data: { ownerId: owner.id, isSystem: true } });
}

async function fundWallet(
  client: Prisma.TransactionClient,
  systemWalletId: bigint,
  walletId: bigint,
  customer: DemoCustomer,
) {
  const inserted = await client.transfer.createMany({
    data: {
      reference: customer.fundingReference,
      sourceWalletId: systemWalletId,
      destinationWalletId: walletId,
      amountMinor: customer.fundingAmountMinor,
    },
    skipDuplicates: true,
  });

  if (inserted.count === 0) return false;

  const transfer = await client.transfer.findUniqueOrThrow({
    where: { reference: customer.fundingReference },
  });
  await client.ledgerEntry.createMany({ data: [
    { transferId: transfer.id, walletId: systemWalletId, entryType: "debit", amountMinor: -customer.fundingAmountMinor },
    { transferId: transfer.id, walletId, entryType: "credit", amountMinor: customer.fundingAmountMinor },
  ] });
  await client.wallet.update({
    where: { id: systemWalletId },
    data: { balanceMinor: { decrement: customer.fundingAmountMinor }, updatedAt: new Date() },
  });
  await client.wallet.update({
    where: { id: walletId },
    data: { balanceMinor: { increment: customer.fundingAmountMinor }, updatedAt: new Date() },
  });
  return true;
}

export async function reportState(client: Prisma.TransactionClient, schema: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid report schema.");
  const namespace = Prisma.raw(`"${schema}"`);
  // A single query keeps balance and ledger observations in the same database snapshot.
  const wallets = await client.$queryRaw<{
    email: string;
    is_system: boolean;
    balance_minor: string;
    ledger_total: string;
  }[]>`
    SELECT u.email, w.is_system, w.balance_minor::text AS balance_minor,
           COALESCE(SUM(l.amount_minor), 0)::text AS ledger_total
      FROM ${namespace}.wallets w
      JOIN ${namespace}.users u ON u.id = w.owner_id
      LEFT JOIN ${namespace}.ledger_entries l ON l.wallet_id = w.id
     GROUP BY u.email, w.is_system, w.balance_minor
     ORDER BY w.is_system DESC, u.email
  `;

  console.log("wallet                          balance        ledger sum");
  for (const row of wallets) {
    const label = row.email.padEnd(30).slice(0, 30);
    console.log(
      `${label}  ${row.balance_minor.padStart(12)}  ${row.ledger_total.padStart(12)}` +
        (row.is_system ? "   (system)" : ""),
    );
  }
  const mismatched = wallets.filter((row) => row.balance_minor !== row.ledger_total);
  console.log(mismatched.length === 0
    ? "Every balance equals the sum of its ledger entries."
    : `MISMATCH on ${mismatched.length} wallet(s): a balance has no ledger history behind it.`);
}

// The caller owns the transaction; all writes use its Prisma transaction client.
export async function applySeed(client: Prisma.TransactionClient) {
  const systemWallet = await ensureSystemWallet(client);
  const admin = await ensureUser(client, ADMIN_EMAIL, "Wallet Admin", "admin");
  await ensureWallet(client, admin.id);

  const funded: string[] = [];
  for (const customer of DEMO_CUSTOMERS) {
    const user = await ensureUser(client, customer.email, customer.name, "customer");
    const wallet = await ensureWallet(client, user.id);
    const didFund = await fundWallet(client, systemWallet.id, wallet.id, customer);
    if (didFund) funded.push(customer.email);
  }
  await client.blacklistEntry.createMany({ data: BLACKLISTED, skipDuplicates: true });
  return { funded };
}
