# Current limits

I keep these boundaries explicit so the guarantees in the decision guides are not
read as promises the current implementation cannot make.

## Proxy configuration

`TRUST_PROXY_HOPS` must match the observed ingress chain. Its default, `0`, ignores
forwarded headers. Behind a proxy, that can put many people in one IP rate-limit
bucket, including login requests. I need to verify the deployed ingress chain from logs before changing it.

## Scaling and load

Rate-limit counters live in one process and reset on restart. Use a shared store
before adding replicas. Account ceilings can also be exhausted by a distributed
attacker; they are not a complete abuse-prevention system.

My concurrency tests exercise simultaneous transfers, duplicate keys, opposite
directions, restrictions, failures and retries. Passing those checks establishes
the tested accounting behavior; it does not establish sustained throughput or p99
latency. I still need staging measurements with the intended instance size,
database region and connection limits.

History uses bounded cursor pagination. Larger datasets still need query-plan and
index measurements; a small test database does not prove performance at scale.

## Database access

Triggers reject updates and deletes on financial history. They do not prevent a
database owner from disabling them, truncating tables or changing the schema.
Use a separate migration role and a restricted application role. Keep backups.
The migration adds triggers; hosted role permissions remain a deployment responsibility.

Reconciliation checks consistency, not independent evidence of the original history.
Two transfers under different keys may both balance correctly. Only replaying the
original key prevents a retry from becoming a second payment.

## Sessions and account restrictions

A blocked user cannot log in or transfer. An already-issued token can still read
that user's wallet and history until it expires. Password changes do not revoke
existing tokens. Tokens last one hour; immediate session revocation needs a backend
session or token-version design.

The browser keeps tokens and unresolved transfers in tab storage. JavaScript can
read that storage, and closing the tab loses local recovery data. The backend
history and idempotency records remain the source of truth.

## Blacklist and demo data

The blacklist is checked at registration and transfers, but there is no endpoint to
manage it. Direct database blacklist edits do not share the account locks used by
block/unblock. A future blacklist write path must coordinate those locks.

The seed creates public demo credentials and funding. Those accounts are for the
project demonstration, not real funds. Idempotency records currently have no expiry;
removing them would allow an old key to execute again.

## Dependency checks

The frontend's
shadcn development CLI has a low-severity deepmerge advisory, also reported through
its registry dependency. It is not shipped in the browser bundle. I have kept the CLI version rather than applying a major downgrade as an automated
fix; it needs a compatible dependency update.

## Test boundaries

Fault injection proves rollback and safe retries for the tested cases. It does not
cover every process crash or network failure during commit. Browser tests intercept
API requests; they do not verify the deployed backend. Local PostgreSQL tests do not substitute for verifying the deployed API and its
configuration.
