# Open questions

Questions raised while building, numbered in one sequence with
[DECISIONS.md](DECISIONS.md) — a question keeps its number when it is answered
and moves there, with the reasoning that settled it.

Each entry says what is being asked, why it matters, what the options cost, and
what it blocks. Nothing here is decided. Where a recommendation appears it is
marked as one.

The build spec's own instruction is to make the simplest call, record it, and
keep going. These are the ones where the simplest call is not obvious, or where
guessing would be expensive to undo.

---

## Q15 — How do the transfer integration tests reach the app?

**The gap.** `index.ts` calls `app.listen` when it is imported, so nothing can
import the app without starting a server on the configured port (**Q2**). That
was affordable for a liveness endpoint. It is not affordable for the transfer:
the build spec's definition of done requires integration tests against real
PostgreSQL for concurrent overspending, concurrent duplicate idempotency keys,
mismatched fingerprints, opposite-direction transfers, rollback after the first
balance update, and the block-versus-transfer race.

Those tests have to run many requests at once against one wallet. Doing that
through HTTP needs an importable app; doing it another way means not testing
through HTTP at all.

**The options.**

- **Export the app from `index.ts` and guard the listen.** One file still, with
  `app` exported and `app.listen` behind a check that the module is the entry
  point. Tests import `app` and drive it with `supertest`. Costs one line of
  guard that needs explaining, which is the thing **Q2** was avoiding.
- **Split `app.ts` back out.** Reverses **Q2**. Tests become ordinary, and the
  explanation is the conventional one. Costs the simplicity that was chosen
  deliberately.
- **Test the transfer service directly, not over HTTP.** The concurrency that
  matters is in the database transaction, not in Express. A test can call the
  transfer function concurrently against a test database and assert on balances,
  ledger rows and idempotency records. Costs coverage of the HTTP layer:
  authentication, ownership, the status codes and the error envelope would go
  untested.
- **Start the real server in a test setup file.** Keeps everything as it is.
  Costs a fixed port, flakiness when it is already in use, and a server that has
  to be torn down between files.

**Recommended:** test the transfer service directly for the concurrency
scenarios, because that is where the invariants live and a database-level test is
stronger evidence than an HTTP one; and accept that the HTTP layer is covered by
hand until the split is reconsidered. If HTTP coverage is wanted too, the first
option is the cheapest route to it.

**Blocks:** the transfer, and the claim that the invariants have been
demonstrated. **Depends on:** nothing — it can be decided now.

## Q16 — What is the maximum transfer amount?

**The gap.** The build spec says to reject amounts "above a defined maximum" but
does not define one. The current amount schema now enforces 1,000,000,000 kobo
(NGN 10,000,000), and unit tests cover the exact boundary. That implementation
predates the Zod cleanup; product confirmation remains open. It is incorrect to
say validation currently accepts arbitrary-size transfers.

The ceiling matters for a reason beyond policy: `BIGINT` tops out at
9,223,372,036,854,775,807 kobo. Arithmetic that approaches it would overflow in
Postgres, and a sum of ledger entries reaches it sooner than a single transfer
does.

**The options.**

- **A round product limit**, say NGN 10,000,000 (`"1000000000"` kobo) per
  transfer. Easy to explain, obviously safe, and the kind of cap a real wallet
  has. Arbitrary.
- **A technical limit only**, rejecting anything that could overflow a `BIGINT`
  sum. Defensible from first principles, no product judgement, but allows a
  single transfer of implausible size, which looks like an oversight.
- **Both**, with the product limit as the one that fires and the technical limit
  as the backstop in validation.

**Recommended:** both, with NGN 10,000,000 as the product limit, documented in
the README and named in the rejection message.

**Blocks:** final approval of the product cap before the transfer endpoint ships.
Validation and its unit tests already use the provisional cap.

## Q17 — Does registration reject or ignore privileged fields?

**The gap.** The build spec says a registration body containing `role`,
`blocked`, `balance` or `is_system` must be rejected *or* ignored, and that the
choice is documented. Neither is implemented, and the README currently says
"rejected" while nothing enforces it.

**The options.**

- **Reject with `400`.** A caller who sends `role: "admin"` learns that the field
  exists and is refused. Noisy but unambiguous, and it catches a client
  accidentally sending a whole user object.
- **Ignore silently.** The field is dropped and a customer is created. Simpler to
  implement — the handler reads only the fields it wants — and gives an attacker
  nothing, but a legitimate client with a buggy payload gets a success that did
  not do what it asked.

**Recommended:** reject, because this is a privilege-escalation attempt or a
client bug, and both are worth surfacing. Ignoring makes the second one invisible.

**Blocks:** registration and its test.

## Q18 — Which identifier does the blacklist match on?

**The gap.** The build spec says the blacklist matches on email and that the
chosen identifier is documented. Email is the obvious choice and also the weakest
one: a blacklisted person registers again with one character changed, or with a
`+tag` suffix, or at a different domain.

The spec also says the check happens at registration *and* inside the transfer
transaction for both parties, so whatever the identifier is, it has to be
available at both points.

**The options.**

- **Normalised email only.** Trim and lowercase, the same rule used for login,
  uniqueness and matching. Consistent with everything else and trivially
  explainable. Evaded by `name+1@example.com`.
- **Normalised email, plus stripping `+tags` and dots for providers that ignore
  them.** Catches the easy evasion. Provider-specific rules that are wrong for
  some domains, and surprising when it blocks an address the user considers
  distinct.
- **Email plus a second identifier**, such as a phone number or BVN. Stronger,
  and out of scope: neither is collected.

**Recommended:** normalised email only, with the evasion stated as a known
limitation rather than left implied. The normalisation rule is already needed for
uniqueness, so there is one rule rather than two that can disagree.

**Blocks:** the blacklist seed, the registration check, and the transfer check.

## Q19 — What are the rate limit numbers?

**The gap.** The spec requires separate limits for auth, transfers and reads,
with transfers the tightest, per authenticated user plus per IP on auth. It gives
no numbers, and a number that is too low fails a reviewer testing concurrency —
which is exactly what this project asks a reviewer to do.

**The tension.** The concurrency tests fire dozens of simultaneous transfers at
one wallet. A transfer limit strict enough to look serious would reject them as
`429`, and a reviewer would read that as a broken demo rather than a working
limiter.

**The options.**

- **Generous limits** — say 100 transfers a minute per user — so a reviewer's
  burst passes. Demonstrates the mechanism without demonstrating restraint.
- **Realistic limits** with the README stating the numbers and how to raise them
  for testing. Honest, and asks the reviewer to read before testing.
- **Realistic limits, disabled by an environment variable.** The limiter is real
  and a reviewer can turn it off deliberately. One more configuration surface,
  and a switch that must never be off in deployment.

**Recommended:** realistic limits with the numbers in the README, and the
`Retry-After` header correct so a `429` is self-explaining when it does fire.

**Blocks:** rate limiting, and the instructions a reviewer follows.

## Q20 — Are the admin blacklist endpoints in scope?

**The gap.** `POST /admin/blacklist` and `DELETE /admin/blacklist/:id` are marked
optional in the build spec. The README currently defers them, so the blacklist is
seed-managed only.

If they are added, the spec requires them to be audited and to lock the affected
user rows the way block and unblock do — so they are not two small handlers, they
are two more operations inside the lock ordering of **Q9**.

**The options.**

- **Leave them out.** The blacklist is demonstrated by a seeded entry that
  refuses a registration. Less surface, less to get wrong.
- **Add them, audited and locking.** Completes the admin story and shows the lock
  ordering applied to a third operation. Costs the audit rows, the locks, and
  tests for a race between blacklisting and a transfer.

**Recommended:** leave them out until everything required is done and tested. They
are the cheapest thing to add afterwards and the most expensive to debug if added
while the transfer is still settling.

**Blocks:** nothing. It is additive either way.

## Q21 — Will the free Render database outlive the review window?

**The gap.** A free Render PostgreSQL database becomes inaccessible 30 days after
it is created, with a 14-day grace period before deletion that does not keep it
working. The build spec is explicit that a README warning does not satisfy "a
live URL we can hit".

Nothing is deployed yet, so the clock has not started. Once it does, the expiry
date is fixed and the review window may fall after it.

**The options.**

- **Create it, record both dates, and upgrade before submitting** if the window
  could reach the expiry. Costs money, on a date that has to be tracked.
- **Create it late**, as close to submission as the remaining work allows, to push
  the expiry out. Contradicts the spec's instruction to deploy early so
  configuration problems surface on day one.
- **Deploy early and recreate the database before submitting.** Keeps the early
  deployment and resets the clock, at the cost of re-running migrations and the
  seed, and of any demo data a reviewer created being gone.

**Recommended:** deploy early as the spec says, record the creation and expiry
dates in the README the day it is created, and decide on upgrading once the
submission date is known. The decision needs a date that does not exist yet.

**Blocks:** the deployment claim at submission. **Depends on:** when the review
window is.

