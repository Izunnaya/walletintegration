# Money and account rules

I model each customer with one NGN wallet. Registration creates the account and an empty wallet
in one transaction. Email addresses are trimmed and lowercased before uniqueness,
blacklist and login checks. A blacklisted address cannot register.

## Money

Amounts are whole kobo, stored and calculated as integers. JSON uses strings:
`"150000"` is NGN 1,500. The maximum transfer is NGN 10 million. Customer balances
cannot go negative. The receiving balance must fit PostgreSQL's `BIGINT` range.

The demo seed uses one system wallet to fund customers. Its negative balance equals
the money customers hold. The normal API cannot transfer to or from that wallet.

## Transfer flow

For a transfer of NGN 100, the source loses `10000` kobo and the destination gains
`10000`. The ledger records both sides. None of those writes should exist without
the others, so I perform the following steps in one transaction.


1. Resolve wallet IDs and claim the user's idempotency key.
2. If the key exists, compare the details and replay the saved answer or return `409`.
3. Lock users, then wallets, in ascending ID order.
4. Check ownership, restrictions, currency, funds and the receiving balance limit.
5. Save a business rejection without moving money, or write the transfer, both balance
   changes and its debit and credit.
6. Save the response with the same transaction, commit, then respond.

Two requests can target the same balance. I take the locks before reading that
balance so a waiting request sees the first transfer's committed result rather
than both spending the same starting funds.

One transaction contains the whole financial change. A thrown error rolls it back.
Deadlocks and serialization failures get bounded retries because PostgreSQL confirms
rollback. An uncertain outcome must be checked with the same request and key.

## Retries

| Situation | Result |
| --- | --- |
| Same user, key and details | Replay the saved answer |
| Same key with different details | `409`; no new movement |
| Concurrent calls using one key | One executes; others wait or retry |
| Known rejection, such as insufficient funds | Save and replay that rejection |
| Transaction rolled back | No movement or saved result from that attempt |
| Response lost or outcome uncertain | Retry the same details and key |

If a transfer times out after commit, retrying its original key returns the saved
receipt. If it rolled back, the retry can run it. That is why the same recovery
instruction works without guessing whether money moved.

A new key means a new payment. Idempotency does not stop a caller intentionally
sending the same amount twice with two different keys.

## Restrictions

Blocked or blacklisted users cannot send or receive. Unblocking does not remove a
blacklist entry. Transfers check these rules while holding user locks, so blocking
and transferring cannot change the same account at the same time.

I require admins to give a reason to block or unblock someone. The request locks the admin
and target account and checks current admin access before saving anything. The
change and audit entry commit together. Repeating an unchanged restriction writes
no extra audit entry.

The blacklist currently has no management endpoint. Direct database edits are an
operational action; they do not use the account-locking workflow.

## History and reconciliation

A transfer has exactly one debit and one credit of equal size. Database triggers
reject updates and deletes on transfers and ledger entries. Corrections are new
entries. Use a restricted application database role so it cannot disable those
protections or truncate tables.

`npm run reconcile` checks balances against ledger totals, debit/credit pairs,
amounts, wallet and currency assignments, negative customer balances, the system
total and saved transfer amounts and IDs. All checks share one read-only snapshot.

Reconciliation checks consistency. It cannot prove that a privileged database owner
never rewrote history, or that two different keys were not used for the same intended
payment. The reasons behind the design are in [server-decisions.md](server-decisions.md),
and the remaining boundaries are in [known-limitations.md](known-limitations.md).
