import { randomBytes } from "node:crypto";
import { Prisma } from "../generated/prisma/client.ts";
import { hashPassword } from "./password.ts";

// The demo customers' password is published in the README, so it is reset on every run.
// Keeping it in step with the documentation is the whole point of a fixture account, and
// nothing of value is protected by it.
export const DEMO_CUSTOMER_PASSWORD = "demo-password-2026";

// The admin password is a real credential, so it is written once and never reset - the
// build spec is explicit about that, because a deployed admin password is changed
// deliberately and not by whoever runs the seed next. Locally it falls back to a documented
// default; in deployment SEED_ADMIN_PASSWORD is set in the environment.
export const DEFAULT_LOCAL_ADMIN_PASSWORD = "admin-password-2026";

function adminPassword(): string {
  return process.env.SEED_ADMIN_PASSWORD ?? DEFAULT_LOCAL_ADMIN_PASSWORD;
}

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

// resetPassword is false for the admin and the funding account, so rerunning the seed
// cannot change a credential that matters. It is true for the demo customers, whose
// password is published, so the database always matches the README.
async function ensureUser(
  client: Prisma.TransactionClient,
  email: string,
  name: string,
  role: string,
  passwordHash: string,
  resetPassword = false,
) {
  await client.user.createMany({
    data: { email, name, role, passwordHash },
    skipDuplicates: true,
  });

  if (resetPassword) {
    await client.user.update({ where: { email }, data: { passwordHash } });
  }

  return client.user.findUniqueOrThrow({ where: { email } });
}

async function ensureWallet(client: Prisma.TransactionClient, ownerId: bigint) {
  await client.wallet.createMany({ data: { ownerId }, skipDuplicates: true });
  return client.wallet.findUniqueOrThrow({
    where: { ownerId_currency: { ownerId, currency: "NGN" } },
  });
}

async function ensureSystemWallet(client: Prisma.TransactionClient) {
  // A random hash nobody holds the input to, so the wallet that is allowed to go negative
  // has no usable login. Only the seed ever moves money out of it.
  const unusableHash = await hashPassword(randomBytes(32).toString("hex"));
  const owner = await ensureUser(client, SYSTEM_OWNER_EMAIL, "System Funding", "admin", unusableHash);
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
  const admin = await ensureUser(
    client,
    ADMIN_EMAIL,
    "Wallet Admin",
    "admin",
    await hashPassword(adminPassword()),
  );
  await ensureWallet(client, admin.id);

  const demoCustomerHash = await hashPassword(DEMO_CUSTOMER_PASSWORD);
  const funded: string[] = [];
  for (const customer of DEMO_CUSTOMERS) {
    const user = await ensureUser(
      client,
      customer.email,
      customer.name,
      "customer",
      demoCustomerHash,
      true,
    );
    const wallet = await ensureWallet(client, user.id);
    const didFund = await fundWallet(client, systemWallet.id, wallet.id, customer);
    if (didFund) funded.push(customer.email);
  }
  await client.blacklistEntry.createMany({ data: BLACKLISTED, skipDuplicates: true });
  return { funded };
}
