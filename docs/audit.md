# Code audit - 29 October 2026

Reviewed account creation, wallets, transfers, restrictions, authentication, validation,
rate limits, migrations, test setup and frontend API workflows.

## Fixed

| Priority | Issue | Change |
| --- | --- | --- |
| High | Database tests could run raw SQL against application tables | Require a test URL and scope both Prisma and direct SQL to the same test schema |
| High | An admin could lose access after middleware approved a request | Lock the admin and target, then recheck permission before writing |
| High | Ordinary database writes could rewrite financial history | Add triggers refusing updates and deletes on transfers and ledger entries |
| Medium | Two unknown public wallet IDs caused a server error | Return and save a wallet-not-found response; retries replay it |
| Medium | Seeding accepted weaker admin passwords than registration | Reuse the registration password schema before any seed writes |

The history migration adds protection without changing existing balances. Apply it
through the normal migration command when deploying this branch.

## Checked

Account and wallet creation is atomic. Blacklisted registration is rejected before
password hashing. Request schemas refuse unknown fields and normalize email addresses.
Passwords are hashed and never returned by the API.

Transfers check source ownership and both parties' restrictions. Ordered row locks
keep parallel balance changes consistent. The money, ledger entries and saved result
commit together. Duplicate keys replay the same result; changing details under a key
is refused. Retry paths preserve the key after an uncertain result.

The suite covers simultaneous sends, opposite-direction transfers, insufficient funds,
blocked and blacklisted parties, rollback after a debit, waiting duplicate requests,
rate limits, private history and admin audit writes.

The frontend uses typed response schemas, per-user query keys and saved transfer
attempts. Browser checks cover loading, errors, login, admin screens, session expiry,
rate limits and recovery after navigation or reload. Request IDs stay out of user alerts.

## Validation

- Backend typecheck and production build passed.
- All 262 backend tests passed across 26 suites on local PostgreSQL 18.
- Migration reruns, repeat seeding and baseline adoption preserved balances.
- Frontend production build and all 17 browser tests passed.
- Runtime dependency scans reported no vulnerabilities in either app.
- Comment cleanup preserves the generated JavaScript.

Database tests ran on a separate local PostgreSQL 18 instance. The hosted database
connection timed out before test setup. No production transfers or account changes
were made. Browser tests used intercepted API responses.

## Documentation

Shortened backend comments and rewrote the main guides in plain language. Added a
[frontend guide](frontend.md) covering screens, structure, API integration, sessions,
loading, errors, transfer recovery, testing and deployment.

## Still required before a wider production rollout

Verify proxy trust from ingress logs. Use a restricted application database role and
a separate migration role. Add a shared rate-limit store before running multiple
instances. Measure sustained traffic and large-history queries on staging.

The frontend development CLI still has a low-severity dependency advisory. Existing
tokens are not immediately revoked on password changes, and blocked users with a
valid token retain read access until expiry. See [known-limitations.md](known-limitations.md)
for the full boundaries and why local test results are not a production capacity claim.
