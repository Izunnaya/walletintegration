# Known limitations

What the service does not do, and what the tests do not prove. Each entry says what is
affected and what closing it would take.

## Proxy attribution on the deployed service

IP-based rate limits do not identify individual callers in production.

Express counts `trust proxy` hops from the right, so the value must match the number of
proxies in front of the service. `TRUST_PROXY_HOPS` defaults to `0`, which trusts no forwarded
header and makes `req.ip` the socket peer. On Render that is the platform edge, not the caller.
All callers therefore share a bucket per edge address.

This is not a spoofing risk. At `0` hops a forged `X-Forwarded-For` is ignored, so a caller
cannot mint a fresh allowance. A test sends 21 requests with rotating forwarded addresses and
asserts they share one bucket.

What is affected is granularity. One noisy client can consume the per-IP allowance others
would have used.

Login is unaffected. The per-account limits key on the email address, not the IP.

To close it: read the forwarded chain from the ingress logs. The request log records `ip`,
`remoteAddress` and the raw `forwardedFor` on every line. Set `TRUST_PROXY_HOPS` to the
observed count and pin it with a test. Do not guess the number. Too low keys everyone to the
proxy. `true` takes the leftmost entry, which the caller controls.

## Rate limit counters are per process

The limiter store is in memory. That is correct for one instance and wrong for more than one.
N instances would allow N times the limit, and a restart forgets the counts.

To close it: a shared store in Redis or PostgreSQL. Not needed while the service runs as a
single web service.

## Immutability of financial rows is not enforced

`CONTRIBUTING.md` states that transfers and ledger entries are never updated or deleted.
Nothing in the database enforces it. There is no trigger and no revoked privilege, so a process
with write access can rewrite history.

Reconciliation detects inconsistency, not revision. Damage that keeps every invariant intact
is reported clean:

- An amount rewritten along with its ledger entries and both balances.
- A transfer reversed in direction.
- A transfer deleted with the balances unwound.

These cases are covered by tests that assert they pass, so the boundary is explicit rather than
assumed.

To close it: `REVOKE UPDATE, DELETE` on the financial tables from the application role, or a
trigger that refuses them.

## Reconciliation proves consistency, not uniqueness

The checks confirm that balances match their ledger entries, that every transfer has one debit
and one credit summing to zero, that entries sit on the right wallets, that no customer wallet
is negative, that the system sums to zero, and that a stored idempotent answer matches the
transfer it would replay.

They cannot prove a transfer did not run twice. A duplicated transfer balances perfectly: two
transfers, four entries, every sum correct. Idempotency prevents that. Reconciliation does not
check it.

## What the tests do not establish

- **Crash recovery.** Fault injection proves an application exception rolls back. It does not
  prove behavior when the process dies mid-commit or the network drops during `COMMIT`.
- **Multi-instance behavior.** Everything is verified against one process.
- **Sustained throughput.** No load testing. There are no p99 figures.
- **Deployed proxy attribution.** Covered above.

## Out of scope

- **Admin blacklist endpoints.** The blacklist is seeded and enforced at registration. There is
  no endpoint to manage it.
- **Reversals and refunds.** A transfer is final. Correcting one means a new transfer in the
  opposite direction.
- **Multiple currencies.** The schema carries a currency column and the service refuses a
  mismatch, but every wallet is NGN.
- **A blocked customer's read access.** `POST /transfers` re-reads the blocked flag under the
  row lock and refuses. Login refuses a blocked account. An existing token can still read its
  own wallet and history until it expires. Closing it costs a database read on every
  authenticated read.
