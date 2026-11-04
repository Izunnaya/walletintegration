# Production API audit - 28 October 2026

Target: https://walletintegration-6t6r.onrender.com

This audit sent 1066 bounded HTTP requests across three runs, with at most six
requests in flight. Two runs used two new customer accounts each and borrowed
20 kobo from the documented Ada demo wallet. Successful compensating transfers
returned all funds, both test balances ended at zero, and the funder's balance
matched its starting value in both runs. One additional zero-balance customer
was created for the final quota probe. Test accounts and immutable financial history
remain deliberately; no account, transfer or ledger record was deleted.

## Observed production behavior

| Check | Result |
| --- | --- |
| Six concurrent identical transfer requests | One transfer ID and exactly one kobo moved |
| Reused key, changed amount | 409 |
| Four simultaneous 15-kobo sends against 19 kobo | One success, three business rejections; no negative balance |
| Transfers in opposite directions | Both completed; total balance preserved |
| Source owned by someone else | 403 |
| Customer reading admin audit | 403 |
| Transfer history belonging to another customer | 404 |
| Transfer quota | 429 with Retry-After; another account retained its allowance |
| Read quota, tested with a fresh account | 429 within 18.2 seconds; shared across wallet/history reads; Retry-After 43 |
| Previously published admin password | 401; no admin token issued |
| Auth IP quota | Incorrect caller buckets: 32 invalid requests all returned 400 and remaining counts repeatedly increased |
| GET /transfers/9223372036854775808 | 500, reproducible |
| Authenticated response cache controls | Cache-Control absent |

The first two read-quota probes crossed a reset boundary. Those apparent failures
were a test-design error, not evidence of a broken read limiter. The final probe
used a fresh account and completed within a single window, proving the live read
quota works. The first two raw reports retain their failed assertions for honesty;
they must not be interpreted as confirmed read-limiter defects.

Only the deliberate out-of-range ID probes returned 500. Client-observed read
bursts (30 requests per run at concurrency six) had p50 434-758 ms, p95 792-981 ms,
and maximum 1,140-1,166 ms. Transfer samples, mixing original requests, duplicates,
rejections and compensating transfers, had p50 about 1.5 seconds and p95 about
2.1 seconds. These samples include this client's network latency and do not
establish maximum sustainable throughput or p99 latency at arbitrary load.

## Findings and code fixes

| Priority | Finding | Change | Verification scope |
| --- | --- | --- | --- |
| High | Auth caller-IP buckets depend on an incorrect hardcoded proxy count | Explicit TRUST_PROXY_HOPS, safe zero fallback on all deployments, with a startup warning on Render | Config tests pass; live proxy count still needs ingress-log evidence |
| High | Previously issued admin tokens retain power after demotion/blocking | Check current role and blocked state in PostgreSQL on every privileged request | Real database regression tests |
| Medium | Custom raw-IP keys allow IPv6 address rotation within an assigned subnet | Library ipKeyGenerator applies IPv6 /56 grouping | HTTP quota regression test |
| Medium | Password hashing could be targeted across many IPs for one email | Limit login attempts to 10/minute per normalized account, in addition to 20/minute per IP | HTTP cross-IP and normalization regression test |
| Medium | Database ID overflow returns 500 on history/admin paths | Reuse bounded Zod ID validation and answer 404 before querying | Real database history/admin tests |
| Medium | Sensitive responses can be retained by clients/intermediaries | Cache-Control: no-store plus Helmet security headers; remove X-Powered-By | HTTP header tests |
| Medium | Admin operations had no request quota | 30/minute per authenticated caller, before database authorization work | HTTP admin quota test |
| Low | Parser accepted much larger bodies than these APIs need | Explicit 16 KB JSON limit | 413 and malformed-JSON regression tests |
| Low | Preflight responses had no request ID | Assign request ID before CORS middleware | HTTP preflight test |

Transient admin failures now use the same database-error classifier as transfers,
so recognized adapter/connection failures receive retryable responses. Password
hash strength, financial atomicity, immutable history and ownership checks were
preserved. The owner-discovery query was combined with the ordered user-lock query, removing
one database round trip from new transfers. No response cache was introduced for
balances or restrictions.

Production dependency audit reported zero known advisories. This describes the
registry's current advisory results, not a guarantee against undisclosed defects.

## Deployment and remaining checks

These fixes are local code changes until deployed. The live URL was audited on
its existing deployment; it has not been claimed to run the new fixes.

1. Read one Render request log's remoteAddress, forwardedFor and ip fields to
   establish the actual proxy chain. Set TRUST_PROXY_HOPS to the verified count.
   Never set trust proxy to true, and do not choose a count from this report.
2. Deploy this branch using the existing npm ci --include=dev / migrate / build
   configuration. The updated blueprint supplies a safe zero default; existing services can
   deploy without adding a variable. Configure the verified count in Environment
   afterward to enable correct per-client IP quotas.
3. Re-run npm run audit:production from server/ with AUDIT_REPORT_PATH pointing
   to an output file. Expect new test customers and compensating ledger entries.
   Do not run repeatedly without inspecting failures and confirming funds return.
4. Check header changes, overflow rejection, and monotonic auth counters while
   trying fabricated X-Forwarded-For prefixes. Match response IDs to server logs.

In-memory quotas reset on process restart and are valid for one process only.
Multiple workers or replicas require a shared rate-limit store. A sleeping Render
service/Neon compute and client/database region separation can still affect cold
latency; no paid hosting change, region move or arbitrary pool-size increase was
performed. The audit does not simulate process crashes, COMMIT acknowledgement
loss or a distributed denial of service. Live ledger tables were not directly
inspected; the isolated PostgreSQL tests verify the ledger pair and rollback.

References: [Express proxy trust](https://expressjs.com/en/guide/behind-proxies/),
[rate-limit IPv6 keys](https://express-rate-limit.mintlify.app/reference/helpers),
[Helmet](https://helmetjs.github.io/).


Final verification: 105 unit/security tests and 71 distinct PostgreSQL API tests
passed across the targeted runs. This includes 20 concurrent duplicate transfers,
12 concurrent overspending attempts, both block/transfer orderings, admin quota
and stale-role checks. The optimized lock-query version passed all 16 transfer
tests. TypeScript checking, the production build and audit-script syntax check
passed. The production dependency audit reported zero known vulnerabilities.
Schema/seed/reconciliation suites were not rerun; no migration changed.
