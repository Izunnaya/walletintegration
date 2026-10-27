import type { PoolClient } from "pg";

// The seed data and the steps that apply it. It takes a transaction client and never opens
// or commits a transaction of its own, so the caller owns the boundary: the script commits,
// and the test rolls back.
//
// Two rules shape everything here.
//
// First, no customer balance appears without ledger history behind it. Writing balances
// straight into wallets would break invariant 8 on the very rows a reviewer inspects first,
// so every demo naira arrives through a real transfer out of the system wallet, with its two
// ledger entries. The system wallet is the one wallet the schema lets go negative, which is
// exactly what makes it the honest source of demo money.
//
// Second, running this twice must not fund anyone twice. Each funding transfer carries a
// stable reference, and transfers has a unique index on it, so a second run conflicts and
// does nothing rather than adding money again.

type Client = PoolClient;

const DEMO_PASSWORD_HASH = "$2b$10$seedonlyplaceholderhashreplacedbyauthwork000000000000";

type DemoCustomer = {
  email: string;
  name: string;
  fundingReference: string;
  fundingAmountMinor: string;
};

const SYSTEM_OWNER_EMAIL = "system@wallet.internal";
const ADMIN_EMAIL = "admin@wallet.internal";

const DEMO_CUSTOMERS: DemoCustomer[] = [
  { email: "ada@example.com", name: "Ada Okafor", fundingReference: "seed-fund-ada", fundingAmountMinor: "50000000" },
  { email: "bode@example.com", name: "Bode Adeyemi", fundingReference: "seed-fund-bode", fundingAmountMinor: "25000000" },
  { email: "chidi@example.com", name: "Chidi Nwosu", fundingReference: "seed-fund-chidi", fundingAmountMinor: "1000" },
];

const BLACKLISTED = [
  { email: "fraudster@example.com", reason: "Seeded to demonstrate registration being refused" },
];



// ON CONFLICT DO NOTHING followed by a SELECT, rather than DO UPDATE: a second run must
// not rewrite a user. In particular it must not reset the admin password, which the build
// spec calls out, because a deployed admin credential is changed deliberately and not by
// whoever happens to run the seed next.
async function ensureUser(client: Client, email: string, name: string, role: string) {
  await client.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING`,
    [email, DEMO_PASSWORD_HASH, name, role],
  );

  const found = await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
    email,
  ]);

  const id = found.rows[0]?.id;
  if (!id) throw new Error(`Could not create or find the seeded user ${email}.`);
  return id;
}

async function ensureWallet(client: Client, ownerId: string) {
  await client.query(
    `INSERT INTO wallets (owner_id) VALUES ($1)
     ON CONFLICT (owner_id, currency) DO NOTHING`,
    [ownerId],
  );

  const found = await client.query<{ id: string }>(
    `SELECT id FROM wallets WHERE owner_id = $1 AND currency = 'NGN'`,
    [ownerId],
  );

  const id = found.rows[0]?.id;
  if (!id) throw new Error(`Could not create or find a wallet for user ${ownerId}.`);
  return id;
}

async function ensureSystemWallet(client: Client) {
  const ownerId = await ensureUser(client, SYSTEM_OWNER_EMAIL, "System Funding", "admin");

  // The partial unique index allows exactly one system wallet, so a second run cannot
  // create another even if this logic were wrong.
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM wallets WHERE is_system = TRUE`,
  );

  if (existing.rows[0]) return existing.rows[0].id;

  const created = await client.query<{ id: string }>(
    `INSERT INTO wallets (owner_id, is_system) VALUES ($1, TRUE) RETURNING id`,
    [ownerId],
  );

  return created.rows[0]!.id;
}

// Moves money the same way a real transfer does: one transfer row, two signed ledger
// entries, both balances updated. The stable reference is what makes a second run a no-op.
async function fundWallet(
  client: Client,
  systemWalletId: string,
  walletId: string,
  customer: DemoCustomer,
) {
  const transfer = await client.query<{ id: string }>(
    `INSERT INTO transfers (reference, source_wallet_id, destination_wallet_id, amount_minor)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (reference) DO NOTHING
     RETURNING id`,
    [customer.fundingReference, systemWalletId, walletId, customer.fundingAmountMinor],
  );

  // No row returned means the reference already existed, so this wallet was funded by an
  // earlier run. Returning here is what keeps the seed repeatable.
  const transferId = transfer.rows[0]?.id;
  if (!transferId) return false;

  await client.query(
    `INSERT INTO ledger_entries (transfer_id, wallet_id, entry_type, amount_minor)
     VALUES ($1, $2, 'debit', $4), ($1, $3, 'credit', $5)`,
    [
      transferId,
      systemWalletId,
      walletId,
      `-${customer.fundingAmountMinor}`,
      customer.fundingAmountMinor,
    ],
  );

  await client.query(
    `UPDATE wallets SET balance_minor = balance_minor - $2, updated_at = now() WHERE id = $1`,
    [systemWalletId, customer.fundingAmountMinor],
  );

  await client.query(
    `UPDATE wallets SET balance_minor = balance_minor + $2, updated_at = now() WHERE id = $1`,
    [walletId, customer.fundingAmountMinor],
  );

  return true;
}

// Printed so a reviewer can see the result without opening a SQL client, and so a second
// run visibly reports the same figures as the first.
export async function reportState(client: Client) {
  const wallets = await client.query<{
    email: string;
    is_system: boolean;
    balance_minor: string;
    ledger_total: string;
  }>(
    `SELECT u.email,
            w.is_system,
            w.balance_minor::text AS balance_minor,
            COALESCE(SUM(l.amount_minor), 0)::text AS ledger_total
       FROM wallets w
       JOIN users u ON u.id = w.owner_id
       LEFT JOIN ledger_entries l ON l.wallet_id = w.id
      GROUP BY u.email, w.is_system, w.balance_minor
      ORDER BY w.is_system DESC, u.email`,
  );

  console.log("");
  console.log("wallet                          balance        ledger sum");
  for (const row of wallets.rows) {
    const label = row.email.padEnd(30).slice(0, 30);
    console.log(
      `${label}  ${row.balance_minor.padStart(12)}  ${row.ledger_total.padStart(12)}` +
        (row.is_system ? "   (system)" : ""),
    );
  }

  // The seed is only honest if it balances. A mismatch here means a balance was written
  // without its ledger entries, which is invariant 8 broken at the source.
  const mismatched = wallets.rows.filter((row) => row.balance_minor !== row.ledger_total);
  console.log("");
  console.log(
    mismatched.length === 0
      ? "Every balance equals the sum of its ledger entries."
      : `MISMATCH on ${mismatched.length} wallet(s): a balance has no ledger history behind it.`,
  );
}



export async function applySeed(client: Client) {
  const systemWalletId = await ensureSystemWallet(client);
  const adminId = await ensureUser(client, ADMIN_EMAIL, "Wallet Admin", "admin");
  await ensureWallet(client, adminId);

  const funded: string[] = [];

  for (const customer of DEMO_CUSTOMERS) {
    const userId = await ensureUser(client, customer.email, customer.name, "customer");
    const walletId = await ensureWallet(client, userId);
    const didFund = await fundWallet(client, systemWalletId, walletId, customer);
    if (didFund) funded.push(customer.email);
  }

  for (const entry of BLACKLISTED) {
    await client.query(
      `INSERT INTO blacklist_entries (email, reason) VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING`,
      [entry.email, entry.reason],
    );
  }

  return { funded };
}
