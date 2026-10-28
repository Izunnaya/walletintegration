# Architecture

How the server is put together, what each layer may do, and where the financial
code will attach.

The shape is routes, controllers, middleware and models, with `index.ts` setting
up and starting the app. It is deliberately the layout used in the earlier
projects here rather than anything novel — see [the superseded list](decisions.md) for the one
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

### `app.ts` — the middleware stack, and `index.ts` — start

`app.ts` builds the app and exports it without listening. `index.ts` loads the
environment, proves the database is reachable, and then listens. They are split
for one reason: the integration tests need an app to send requests to, and an
`index.ts` that listened on import would bind a port in every test file.

```ts
const app = express();

app.set("trust proxy", 1);

app.use(corsMiddleware);
app.use(attachRequestId);
app.use(httpLogger);
app.use(express.json());

app.use("/health", HealthRoute);
app.use("/auth", AuthRoute);
app.use("/wallets", WalletRoute);
app.use("/admin", AdminRoute);
app.use("/transfers", TransferRoute);

app.use(respondNotFound);
app.use(respondInternalError);
```

**The order is the behaviour**, not a style choice:

- `trust proxy` set to `1`, not `true`. Render puts one proxy in front, so without
  this `req.ip` is the proxy on every request and the IP-keyed auth limiter locks
  everyone out together. `true` would trust the whole chain and let a caller spoof
  `X-Forwarded-For` for a fresh bucket per request.
- `corsMiddleware` first, because a preflight `OPTIONS` carries no token and no
  body and has to be answered before anything would refuse it.
- `attachRequestId` **before** `express.json()`. A body that is not valid JSON
  fails inside the parser; with the ID assigned after it, that would be the one
  error a caller cannot quote an ID for — exactly when they most need one. This
  was the other way round once, and malformed JSON returned a 500 with no ID.
- `httpLogger` after the ID, so the automatic request line carries the same ID the
  caller got in `X-Request-Id`, and before the routes, so a request is logged even
  when it fails in the parser.
- `express.json()` before the routers, so a body exists to validate.
- Routers next.
- `respondNotFound` after the routers, because it only runs when nothing matched.
- `respondInternalError` last, because Express only routes errors to a middleware
  registered after everything else.

### `logger.ts` — configuration, not an abstraction

One `pino` instance, because `pino-http` attaches it to the request and the error
handler and the transfer service write to the same one. Callers use pino's own
methods; there is no wrapper. JSON when stdout is a pipe, pretty when it is a
terminal, the `Authorization` header redacted, and `/health` left unlogged.
`console.log` stays in the command-line tools, whose output a person reads. See
[ADR 16](decisions.md).

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

Contains the shared Prisma client, adapter configuration, and seed operations.
Model definitions and migrations live under server/prisma; generated code is ignored.

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

Node 22, Express 5, strict TypeScript, PostgreSQL, Prisma 7, Zod, dotenv, and
Vitest. Prisma's pg adapter owns the underlying connection pool. Models preserve
existing SQL table names and bigint money. Custom migration SQL preserves CHECK
constraints and the partial index; future row locks run through the transaction
client's parameterized raw-query API. See [ADR 10](decisions.md) and [the Prisma workflow](prisma.md).

Node runs source TypeScript in development. Client generation runs on install/build,
and compilation rewrites source imports to JavaScript for deployment. Generated
Prisma Client files are never edited or committed.
