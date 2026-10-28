# Known limitations

What this service does not do, or does not yet prove. Recorded so a reader can tell a known
boundary from an oversight, and so nobody has to rediscover one of these the hard way.

Each entry says what the limitation is, what it affects, and what closing it would take.

## Proxy attribution on the deployed service

**IP-based rate limits do not identify individual callers in production.**

Express counts `trust proxy` hops from the right, so the value has to match the number of
proxies actually in front of the service. `TRUST_PROXY_HOPS` defaults to `0`, which trusts no
forwarded header and makes `req.ip` the socket peer — on Render, that is the platform's edge
address rather than the caller's. Every caller therefore shares a bucket per edge address.

- **Not a spoofing risk.** At `0` hops, a forged `X-Forwarded-For` is ignored entirely. A
  caller cannot mint themselves a fresh allowance. This is verified by a test that sends 21
  requests with rotating forwarded addresses and expects them to share one bucket.
- **What is actually affected** is availability and granularity: one noisy client can consume
  the per-IP allowance that others would have used.
- **Login is still protected**, because the per-account limits are keyed on the email address
  rather than the IP, and are unaffected by hop count.

**To close it:** read the real forwarded chain from the ingress logs — the request log records
`ip`, `remoteAddress` and the raw `forwardedFor` on every line for exactly this purpose — then
set `TRUST_PROXY_HOPS` to the observed count and pin it with a test. The number is
deliberately not guessed: too low keys everyone to the proxy, and `true` would take the
leftmost entry, which the caller controls.

## Rate limit counters are per process

The limiter store is in memory. That is correct for a single instance and wrong for more than
one: each process would keep its own counts, so N instances would allow N times the limit, and
a restart forgets everything.

**To close it:** a shared store (Redis or PostgreSQL). Not needed while the service runs as a
single web service, and the trade-off is recorded rather than hidden.

## Immutability of committed financial rows is documented, not enforced

The contributing guide states that transfers and ledger entries are never updated or deleted.
Nothing in the database enforces it — there is no trigger and no revoked privilege — so a
process with write access can rewrite history.

Reconciliation detects inconsistency, not revision. Damage that keeps every invariant intact
is reported clean: an amount rewritten along with its ledger entries and both balances, a
transfer reversed in direction, or a transfer deleted with the balances unwound. These cases
are covered by tests that assert they pass, so the boundary is explicit.

**To close it:** `REVOKE UPDATE, DELETE` on the financial tables from the application role, or
a trigger that refuses them. Either makes the guarantee structural instead of procedural.

## Reconciliation proves consistency, not uniqueness

The checks confirm that balances match their ledger entries, that every transfer has exactly
one debit and one credit summing to zero, that entries sit on the right wallets, that no
customer wallet is negative, that the system sums to zero, and that a stored idempotent answer
still matches the transfer it would replay.

They cannot prove a transfer did not run twice. A duplicated transfer balances perfectly: two
transfers, four entries, every sum correct. Idempotency prevents that; reconciliation does not
check it.

## What the tests do not establish

- **Crash recovery.** Fault injection proves an application exception rolls back. It does not
  prove behaviour when the process dies mid-commit, or when the network drops during `COMMIT`.
- **Multi-instance behaviour.** Everything is verified against one process.
- **Sustained throughput.** The latency figures in the production audit include the measuring
  client's own network and say nothing about p99 under arbitrary load.
- **Deployed proxy attribution.** Covered above; needs the live ingress chain.

## Deliberately out of scope

- **Admin blacklist endpoints.** The blacklist is seeded and enforced at registration. There is
  no endpoint to manage it.
- **Reversals and refunds.** A transfer is final. Correcting one means a new transfer in the
  opposite direction.
- **Multiple currencies.** The schema carries a currency column and the service refuses a
  mismatch, but every wallet is NGN.
- **A blocked customer's read access.** `POST /transfers` re-reads the blocked flag under the
  row lock and refuses, and login refuses a blocked account. Existing tokens can still read
  their **own** wallet and history until they expire. Closing it means a database read on every
  authenticated read request, which has not been judged worth the cost.
