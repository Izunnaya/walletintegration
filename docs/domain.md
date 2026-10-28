# The domain

What a user, wallet, transfer and ledger entry are, and the rules on money. Read this before
touching a figure.

## Glossary

| Term | Means here |
| --- | --- |
| Invariant | A rule that holds no matter what fails |
| Minor units (kobo) | Money as a whole number of kobo. `"150000"` is NGN 1,500 |
| Wallet | One per user, one currency (NGN), balance in kobo |
| System wallet | The single wallet allowed to go negative. Funds demo balances. Nothing can reach it |
| Transfer | A movement of money that happened. Only successes are stored |
| Ledger entry | One signed immutable line belonging to a transfer and a wallet |
| Balance vs ledger | The balance is the running total. The ledger is the proof behind it |
| Idempotency key | A client-supplied id naming one intended transfer |
| Fingerprint | A hash of the normalized details stored with the key, so the same key with different details is caught |
| Reconciliation | Checking that every balance equals the sum of its ledger entries |
| Row lock | `SELECT ... FOR UPDATE`. While one transaction holds a row, others wait |
| Fail closed | If a safety check cannot run, treat it as a refusal |

## The invariants

1. Customer wallet balances never go negative.
2. A successful transfer debits and credits the same amount in the same currency.
3. The transfer, both ledger entries, both balance updates and the idempotency result commit
   together or not at all.
4. Retrying an operation cannot move money twice.
5. A user can transfer only from a wallet they own.
6. A user can read only wallets and transfers they are party to.
7. Account restrictions are checked under row locks, inside the transfer transaction.
8. Every balance change has matching immutable ledger entries.
9. Financial records are never deleted or rewritten. Corrections are new compensating entries.
10. A timeout does not mean a transfer failed.

Every design decision traces back to one of these.

## Money

Amounts are whole kobo. Parsed and calculated as `bigint`, stored as `BIGINT`, serialized as
strings. No amount passes through a JavaScript `number`. See [ADR 1](decisions.md).

A request supplies `amountMinor` as a positive integer string. Rejected on sight: zero,
negatives, decimals, non-numeric values, anything above 1,000,000,000 kobo, a currency
mismatch, and a transfer where source and destination are the same wallet.

Naming carries the unit. `amountMinor`, `senderBalanceMinor`, never `amount` or `balance` on
their own, so a mixed-unit mistake is visible where it is written.

`src/domain/money.ts` defines the amount and currency schemas. The amount schema trims
whitespace, validates digits, converts to `bigint`, and checks the sign and the limit. Callers
use `safeParse` and the parsed `bigint` on success.

Transfer policy is a sequence of explicit decisions over supplied state. Ownership is checked
before restrictions or funds. The calling transaction must obtain that state under row locks.
Schema validation does not replace the locks or the business decisions.

## Wallets and accounts

Each user has exactly one NGN wallet, created with the user, starting at zero. There is no
account deletion.

A wallet has two identifiers. The numeric primary key is what every ledger and transfer row
references. The public id, `wlt_` followed by 32 hex characters, is what a screen displays and
a user copies. Transfers accept either. See [ADR 21](decisions.md).

A user can be stopped two ways. Both stop them sending and receiving:

- **Blocked.** Set by an admin, reversible by an admin.
- **Blacklisted.** Matched by email against `blacklist_entries`. Checked at registration, so a
  blacklisted email cannot register, and again inside every transfer transaction for both
  parties.

Unblocking does not lift a blacklist. They are separate restrictions and either is enough to
refuse.

The blacklist check fails closed. If it cannot run, it counts as a refusal.

## The system wallet

One wallet carries `is_system = TRUE` and is the only one the schema permits to go negative:

```sql
is_system BOOLEAN NOT NULL DEFAULT FALSE,
balance   BIGINT  NOT NULL DEFAULT 0,
CHECK (balance >= 0 OR is_system = TRUE)
```

It exists so demo balances arrive honestly. The seed moves money out of it through real
transfers with real ledger entries rather than writing balances into customer wallets. No
customer balance exists without history behind it.

It is fenced on every side. No endpoint reads `is_system` from a request. Nothing can create or
change it. Registration always creates customer wallets. A customer transfer naming it on
either side is rejected. Only the seed uses it.

`wallets_single_system` enforces that there is one. It is also what stops a customer wallet
being relabeled to inherit the negative-balance exemption. See [ADR 9](decisions.md).

## Transfers

A transfer moves an amount between two wallets inside one transaction. The order is fixed:

1. Claim the idempotency key.
2. Lock the user rows, in sorted id order.
3. Lock the wallet rows, in sorted id order.
4. Validate: ownership, blocked, blacklisted, wallet exists, currency matches, neither side is
   the system wallet, funds sufficient.
5. On a business rejection, store it on the idempotency record and commit. No money moves.
6. Otherwise insert the transfer and its two ledger entries.
7. Update both balances.
8. Store the success on the idempotency record.
9. Commit, then respond.

Locks before reads, always. A balance read before a lock may already have changed. Users before
wallets, each in sorted id order, so two transfers in opposite directions acquire the same
locks consistently. See [ADR 3](decisions.md).

Only successful transfers are stored. A rejection lives on the idempotency record and in the
logs. See [ADR 8](decisions.md).

## Ledger entries

Every transfer produces exactly two: a debit on the source wallet and a credit on the
destination, equal in size, opposite in sign, same currency. The unique constraint on
`(transfer_id, entry_type)` makes a third impossible.

Entries are never updated or deleted. A correction is a new compensating pair, so the history
records that something was corrected rather than hiding it.

The balance column exists for fast reads. The ledger is what proves it. If they disagree, the
ledger is right.

## Idempotency

Every `POST /transfers` carries an `Idempotency-Key`. The key is unique per authenticated user,
operation and key, so one client's keys cannot collide with another's.

Stored with it is a fingerprint of the normalized details: source wallet, destination wallet,
currency, amount. Not the raw JSON, so the same intent formatted differently is the same
intent. The helper is `fingerprintTransfer`.

| Situation | Result |
| --- | --- |
| Same key, same details, earlier success | The stored success, replayed |
| Same key, same details, earlier rejection | The stored rejection, replayed |
| Same key, different details | `409`, nothing moves |
| Two concurrent requests, same key | The unique index coordinates them. One executes |
| The transaction rolled back | No key, no movement. Retrying with the same key runs it |
| The outcome is unknown to the client | Retry with the same key to find out |

A rejection is committed as the key's answer. Trying again after a top-up is a new intent and
needs a new key.

The record is written inside the transfer transaction, so nothing half-finished is visible. See
[ADR 4](decisions.md).

## Known outcome versus unknown outcome

The service never reports a failure when all it knows is that it lost the answer.

| Failure | What is true | What the client does |
| --- | --- | --- |
| Invalid input, unauthorized | Nothing happened | Fix and resend |
| Insufficient funds, restricted account | Rejected, committed as the key's result | New intent, new key |
| Crash before commit | Rolled back | Retry with the same key |
| Crash after commit, before the response | The transfer happened | Retry with the same key. Gets the original result |
| Connection lost during commit | Unknown | Retry with the same key |
| Duplicate waiting on a held key | Pending | Retryable response. Reuse the key |
| Deadlock or serialization error | Rolled back | Bounded retry of the transaction, up to 3 times |
| Database unreachable before any work | Nothing happened | `503`, retry |

"Retry with the same key" is the single instruction a client needs for every uncertain case,
and it is safe in all of them.

## Three kinds of record

Each answers a different question. Mixing them makes all three worse.

| Record | Answers | Lives in |
| --- | --- | --- |
| Financial ledger | Where did the money move? | `ledger_entries`, immutable |
| Operational log | Why did this request fail? | The pino request log, with the request id |
| Admin audit trail | Who changed a restriction, when and why? | `admin_audit_entries`, insert only |

No password and no token is ever logged.

## Reconciliation

`npm run reconcile` runs seven checks:

1. Every wallet balance equals the sum of its signed ledger entries.
2. Every transfer has exactly one debit and one credit.
3. Each pair sums to zero and matches its transfer's amount.
4. Entries match their transfer's wallets and currency.
5. No customer wallet is negative.
6. The system sums to zero overall.
7. Every stored idempotent answer matches the transfer it would replay.

All seven run in one read-only `REPEATABLE READ` transaction, so concurrent transfers cannot
make two checks disagree about a moment in time. The transfer's own isolation level is
unaffected.

A balanced ledger does not prove there are no duplicates. A transfer executed twice still
balances. Idempotency proves each intent ran once. Reconciliation proves the arithmetic holds.
Neither substitutes for the other.

What reconciliation cannot see is in [known-limitations.md](known-limitations.md).
