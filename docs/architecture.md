# Architecture

How the server is put together, what each layer may do, and where the financial
code will attach.

The shape is routes, controllers, middleware and models, with `index.ts` setting
up and starting the app. It is deliberately the layout used in the earlier
projects here rather than anything novel — see [Q2](../DECISIONS.md) for the one
place that choice cost something.

---

## The layers

```
server/src/
  index.ts        loads .env, builds the app, mounts routers, listens
  routes/         one router per resource. Wiring only
  controllers/    one controller per resource. The work
  middleware/     cross-cutting concerns: request IDs, errors, auth, validation
  models/         the database and the records. Nothing here yet
```

A request travels in one direction: `index.ts` → middleware → router →
controller → model. Nothing travels back up. A model never imports a controller,
and nothing below `routes/` knows that HTTP exists except the controllers.

### `index.ts` — setup and start

```ts
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(attachRequestId);

app.use("/health", HealthRoute);

app.use(respondNotFound);
app.use(respondInternalError);

app.listen(PORT, () => {
  console.log(`Server started on localhost:${PORT}`);
});
```

**The order is the behaviour**, not a style choice:

- `express.json()` first, so a body exists to validate.
- `attachRequestId` before the routes, so every handler and every error response
  has an ID.
- Routers next.
- `respondNotFound` after the routers, because it only runs when nothing matched.
- `respondInternalError` last, because Express only routes errors to a middleware
  registered after everything else.

When the database arrives, `index.ts` gains one more responsibility: connect the
pool, then listen. Nothing else moves.

### `routes/` — wiring only

A route file names a path, lists the middleware it needs, and points at a
controller function. It holds no logic, no queries and no response building.

```ts
const router = express.Router();

router.get("/live", HealthController.getLiveness);

export default router;
```

Mounted under a prefix in `index.ts`, so `HealthRoute`'s `/live` answers on
`/health/live`.

**Middleware order inside a route is fixed**: authenticate, authorise, validate,
controller.

```ts
router.post("/", verifyToken, validateTransferRequest, TransferController.createTransfer);
```

That order is the security property. Authenticating after validating would spend
work on an unauthenticated request; validating after the controller would be too
late.

### `controllers/` — the work

Plain named functions, default-exported as an object at the bottom so a route
file reads `HealthController.getLiveness`.

A controller reads what it needs off the request, calls the rules, and sends a
response. It is `async` with a try/catch as soon as it touches the database. The
catch logs the real error and returns a safe message — and the error middleware
is still registered as a backstop for anything a catch misses.

A controller does **not** build SQL inline once `models/` exists, and does not
reach into another controller.

### `middleware/` — cross-cutting concerns

| File | Job | Status |
| --- | --- | --- |
| `requestId.ts` | A UUID per request, on `req.requestId` and `X-Request-Id` | Built |
| `errorHandler.ts` | `respondNotFound` and `respondInternalError` | Built |
| `auth.ts` | `verifyToken` (who are you), `requireRole` (are you allowed) | Not built |
| `validate.ts` | Request validation, one exported array per request type | Not built |

`requestId.ts` adds a property to the Express request, which TypeScript has to be
told about:

```ts
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}
```

That is the same pattern the earlier project uses for `req.userId`.

`errorHandler.ts` holds the two functions that make the error contract true
rather than aspirational. `respondInternalError` takes four arguments because
that is how Express recognises an error handler, and checks `res.headersSent`
because a response that has begun cannot be replaced.

### `models/` — the records

Empty today. It will hold the connection pool and the code that reads and writes
each record.

A model knows about storage and about the rules that make a record valid. It
knows nothing about HTTP: no request, no response, no status codes. That way the
same rule can be called from an endpoint, the seed script or the reconciliation
command, and can be tested without a server.

---

## Where the money logic will live

The transfer is the one piece that does not fit the pattern cleanly, and it is
worth saying why in advance.

A transfer is one cohesive operation that owns a transaction boundary, a lock
order, an idempotency claim and two balance writes. That cannot be split across
a controller and a model without hiding the transaction from the code that
depends on it, and it cannot sit in a route handler without making the handler
the opposite of thin.

So it will be one function that takes the request's already-validated details and
a transaction client, and runs the nine steps in
[domain.md](domain.md#transfers) in order, top to bottom, readable as a list. The
controller authenticates, validates, calls it, and maps its result to a status
code.

Two rules that hold wherever it ends up living:

- **Every query in the transaction uses the same client**, passed in explicitly.
  A helper that reaches for a pool instead would run outside the transaction and
  silently escape the locks.
- **Nothing hides a commit, a retry, a balance change or a lock.** Those are the
  parts a reviewer has to be able to find, so they stay where they can be
  pointed at.

The pure parts come out: parsing an amount, normalising a request, building a
fingerprint, deciding whether a supplied balance and status permit a transfer.
Those are functions with data in and data out, testable without a database.

A policy function can decide whether a *supplied* balance is sufficient. It
cannot guarantee that balance is current. Only the locked transaction can, which
is why the two are separate and the service is what fetches under lock.

---

## What deliberately is not here

No dependency injection container, no generic repository, no service locator, no
base controller, no provider interface, no event bus, no state machine helper.

Each would add a layer whose only current job is forwarding. The build spec warns
against exactly this, and the cost is paid twice: once writing it, and again by
whoever has to explain it. A layer arrives when it has a concrete job — the
transfer is the one case where that argument has been made and accepted.

---

## Request flow, end to end

A `GET /health/live`:

1. `index.ts` has already loaded `.env`, built the app and called `listen`.
2. `attachRequestId` puts a UUID on `req.requestId` and in `X-Request-Id`.
3. The path matches `/health`, so `HealthRoute` takes it and matches `/live`.
4. `HealthController.getLiveness` responds `{"status":"ok"}`.

A `GET /nope`: steps 1 and 2, then no route matches, so Express reaches
`respondNotFound`, which returns `404` in the error format carrying the same ID
as the header.

A route that throws: steps 1 and 2, then the throw — or the rejected promise,
since Express 5 forwards those automatically — reaches `respondInternalError`,
which logs the real error with the request ID and returns `500` with a fixed
message.

---

## Build order

Stages, each on its own branch. The order is the build spec's: the risky core
goes early, and the tests that prove it go immediately after.

| Stage | Branch | Delivers |
| --- | --- | --- |
| 1 | `feature/project-foundation` | HTTP foundation, request IDs, the error contract — **done** |
| 2 | `feature/database-migrations` | Seven tables, every constraint |
| 3 | `feature/seed-data` | System wallet, funded demo customers, blacklist, admin |
| 4 | `feature/health-ready` | The pool and `/health/ready` |
| 5 | `feature/render-deploy` | Live, with migrations on deploy |
| 6 | `feature/auth` | Registration, login, JWT, authorisation |
| 7 | `feature/transfers` | The atomic idempotent transfer |
| 8 | `feature/transfer-history` | `GET /transfers` and `/transfers/:id` |
| 9 | `feature/admin-restrictions` | Block and unblock, audited |
| 10 | `feature/rate-limiting` | Per-user and per-IP limits |
| 11 | `feature/reconciliation` | `npm run reconcile` |

Stage 5 is early on purpose. Deployment problems should surface on day one, not
the night before submission.

---

## Stack

Node 22, Express 5, TypeScript 6 (strict), PostgreSQL. `dotenv` for
configuration. `pg` rather than an ORM, because the transfer needs explicit
locks ([Q13](../DECISIONS.md)).

Node runs the TypeScript directly in development, which is why imports carry the
real `.ts` extension and type-only imports must say `import type` — an unmarked
type import would make Node try to import a value Express does not export.
`npm run build` compiles to `dist/` for deployment.
