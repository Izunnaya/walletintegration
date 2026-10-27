# models/

The records themselves: the tables, and the code that reads and writes them.
Nothing here yet — the seven tables arrive on `feature/database-migrations` and
the connection pool on `feature/health-ready`.

A model knows about storage and about the rules that make a record valid. It
knows nothing about HTTP: no request, no response, no status codes. That way the
same rule can be called from an endpoint, the seed script or the reconciliation
command, and can be tested without a server.

Two rules specific to this service, because money is involved:

- **Every query that runs inside a transaction takes the transaction client as an
  argument.** A function that reaches for the pool instead would run outside the
  transaction and silently escape its locks, which is the one bug this whole
  design exists to prevent.
- **Nothing here updates or deletes a financial row.** Transfers and ledger
  entries are append-only; a correction is a new compensating entry.

The invariants these tables enforce, and the constraints that enforce them, are
in `../../../docs/domain.md`.
