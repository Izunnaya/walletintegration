# The domain

What a user, wallet, transfer and ledger entry are, and the rules on money. The
build spec is the source; this is the working version a developer reads before
touching a figure.

---

## Glossary

| Term | What it means here |
| --- | --- |
| **Invariant** | A rule that holds no matter what fails. The nine below are the ones the whole design exists to keep |
| **Minor units (kobo)** | Money as a whole number of kobo. `"150000"` is NGN 1,500 |
| **Wallet** | One per user, one currency (NGN), with a balance in kobo |
| **System wallet** | The single wallet allowed to go negative. It funds demo balances and nothing can reach it |
| **Transfer** | A movement of money that happened. Only successes are stored |
| **Ledger entry** | One signed, immutable line belonging to a transfer and a wallet. A debit and a credit per transfer |
| **Balance vs ledger** | The balance is the running total; the ledger is the proof behind it |
| **Idempotency key** | A client-supplied ID naming one intended transfer, so a repeat is recognised rather than re-executed |
| **Fingerprint** | A hash of the normalised transfer details stored with the key, so the same key with different details is caught |
| **Reconciliation** | Checking that every balance equals the sum of its ledger entries |
| **Row lock** | `SELECT ... FOR UPDATE`. While one transaction holds a row, others wait |
| **Fail closed** | If a safety check cannot run, treat it as a refusal |

---

## The invariants

1. Customer wallet balances never go negative.
2. A successful transfer debits and credits exactly the same amount in the same
   currency.
3. The transfer, both ledger entries, both balance updates and the idempotency
   result commit together or not at all.
4. Retrying the same operation cannot move money twice.
5. A user can only transfer from a wallet they own.
6. Users can only view wallets and transfers they are authorised to see.
7. Account restrictions are checked under database locks, inside the transfer
   transaction.
8. Every balance change has matching immutable ledger entries.
9. Financial records are never deleted or rewritten. Corrections are new
   compensating entries.
10. A timeout does not mean a transfer failed.

Every design decision traces back to one of these. When a choice looks
over-careful, the question to ask is which invariant it protects.

---

## Money

Amounts are whole kobo, parsed and calculated as `bigint`, stored as `BIGINT`,
and serialised to JSON as strings. No amount passes through a JavaScript
`number` — see [Q1](../DECISIONS.md).

A request supplies `amountMinor` as a positive integer string. Rejected on sight:
zero, negatives, decimals, anything non-numeric, anything above the maximum
(**Q16**, open), a currency mismatch, and a transfer where source and destination
are the same wallet.

Naming carries the unit. `amountMinor`, `senderBalanceMinor` — never `amount` or
`balance` on their own, so a mixed-unit mistake is visible where it is written.

---

## Wallets and accounts

Each user has exactly one NGN wallet, created with the user and starting at zero.
There is no account deletion.

A user can be stopped two ways, and both stop them **sending and receiving**:

- **Blocked** — set by an admin, reversible by an admin.
- **Blacklisted** — matched by email (**Q18**, open) against `blacklist_entries`.
  Checked at registration, so a blacklisted email cannot register at all, and
  again inside every transfer transaction for both parties.

Unblocking does not lift a blacklist. They are separate restrictions and either
one is enough to refuse.

The blacklist check fails closed. If it cannot run, it counts as a refusal, never
a pass.

---

## The system wallet

One wallet carries `is_system = TRUE` and is the only one the schema permits to
go negative:

```sql
is_system BOOLEAN NOT NULL DEFAULT FALSE,
balance   BIGINT  NOT NULL DEFAULT 0,
CHECK (balance >= 0 OR is_system = TRUE)
```

It exists so demo balances arrive honestly: the seed moves money out of it
through real transfers with real ledger entries, rather than writing balances
into customer wallets directly. No customer balance exists without history behind
it.

It is fenced on every side. No endpoint reads `is_system` from a request, none can
create or change it, registration always creates customer wallets, and a customer
transfer naming it on either side is rejected. Only the seed uses it. See
[Q12](../DECISIONS.md).

---

## Transfers

A transfer moves an amount from one wallet to another inside one transaction. The
order inside that transaction is fixed:

1. Claim the idempotency key.
2. Lock the user rows, in sorted id order.
3. Lock the wallet rows, in sorted id order.
4. Validate: ownership, blocked, blacklisted, wallet exists, currency matches,
   neither side is the system wallet, funds sufficient.
5. On a business rejection, store it on the idempotency record and commit. No
   money moves.
6. Otherwise insert the transfer and its two ledger entries.
7. Update both balances.
8. Store the success on the idempotency record.
9. Commit, then respond.

Locks before reads, always. A balance read before a lock is a balance that may
already have changed. Users before wallets, and each in sorted id order, so two
transfers in opposite directions cannot deadlock — see
[Q8 and Q9](../DECISIONS.md).

**Only successful transfers are stored.** A rejection lives on the idempotency
record and in the logs ([Q7](../DECISIONS.md)).

---

## Ledger entries

Every transfer produces exactly two: a debit on the source wallet and a credit on
the destination, equal in size and opposite in sign, in the same currency. The
unique constraint on `(transfer_id, entry_type)` makes a third entry impossible.

Entries are never updated or deleted. A correction is a new compensating pair,
so the history records that something was corrected rather than hiding it.

The balance column exists for fast reads; the ledger is what proves it. If they
ever disagree, the ledger is right.

---

## Idempotency

Every `POST /transfers` carries an `Idempotency-Key` header. The key is unique
per **authenticated user + operation + key**, so one client's keys cannot collide
with another's.

Stored with it is a fingerprint of the *normalised* details — source wallet,
destination wallet, currency, amount — not the raw JSON, so the same intent
formatted differently is still the same intent.

| Situation | Result |
| --- | --- |
| Same key, same details, earlier success | The stored success, replayed |
| Same key, same details, earlier rejection | The stored rejection, replayed |
| Same key, different details | `409`, nothing moves |
| Two concurrent requests, same key | The unique index coordinates them; one executes |
| The transaction rolled back | No key, no movement. Retrying with the same key runs it |
| The outcome is unknown to the client | Retry with the same key to find out |

A rejection is committed as the key's answer ([Q11](../DECISIONS.md)). Trying
again after a top-up is a new intent and needs a new key.

The record is written inside the transfer transaction, so nothing half-finished
is ever visible ([Q10](../DECISIONS.md)).

---

## Known outcome versus unknown outcome

This is the distinction the whole failure design rests on. The service never
reports a failure when all it knows is that it lost the answer.

| Failure | What is true | What the client does |
| --- | --- | --- |
| Invalid input, unauthorised | Nothing happened | Fix and resend |
| Insufficient funds, restricted account | Rejected, committed as the key's result | New intent, new key |
| Crash before commit | Rolled back | Retry with the same key |
| Crash after commit, before the response | The transfer happened | Retry with the same key; gets the original result |
| Connection lost during commit | Unknown | Retry with the same key |
| Duplicate waiting on a held key | Pending | Retryable response; reuse the key |
| Deadlock or serialisation error | Rolled back | Bounded retry of the whole transaction, up to 3 times |
| Database unreachable before any work | Nothing happened | `503`, retry |

"Retry with the same key" is the single instruction a client needs for every
uncertain case, and it is safe in all of them.

---

## Three kinds of record

Each answers a different question, and mixing them makes all three worse.

| Record | Answers | Where it lives |
| --- | --- | --- |
| Financial ledger | Where did the money move? | `ledger_entries`, immutable |
| Operational log | Why did this request fail? | `console.error` with the request ID |
| Admin audit trail | Who changed a restriction, when, and why? | `admin_audit_entries`, insert only |

No password and no token is ever logged.

---

## Reconciliation

`npm run reconcile` checks that the books are internally consistent:

- Every wallet balance equals the sum of its signed ledger entries.
- Every transfer has exactly one debit and one credit.
- Entries match their transfer's wallets, currency and amount, and sum to zero.
- No customer wallet is negative.
- Seed funding balances across the system wallet and the customers.

All of it runs in one read-only `REPEATABLE READ` transaction, so concurrent
transfers cannot make two separate checks disagree about a moment in time. The
transfer's own isolation level is unaffected.

**A balanced ledger does not prove there are no duplicates.** A transfer executed
twice still balances. Idempotency proves each intent ran once; reconciliation
proves the arithmetic holds. Both are needed and neither substitutes.

---

## Still open

**Q16** the maximum transfer amount, **Q17** whether registration rejects or
ignores privileged fields, **Q18** which identifier the blacklist matches on,
**Q19** the rate limit numbers, **Q20** whether admin blacklist endpoints are in
scope. See [OPEN-QUESTIONS.md](../OPEN-QUESTIONS.md).
