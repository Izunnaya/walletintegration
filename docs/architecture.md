# Architecture

How the server is put together and what each layer may do.

## The layers

```
server/src/
  app.ts          builds the app and its middleware stack, exports it unlistened
  index.ts        loads .env, proves the database is reachable, listens
  logger.ts       the pino instance and the pino-http options
  proxyConfig.ts  the validated trust-proxy hop count
  routes/         one router per resource. Wiring only
  controllers/    one controller per resource. The HTTP work
  services/       the transfer: transaction boundary, locks, idempotency, retries
  middleware/     request ids, auth, validation, CORS, rate limits, errors
  domain/         Zod schemas, money rules, transfer policy, fingerprint
  models/         Prisma client, locking reads, seed, reconciliation
```

A request travels one way: middleware, router, controller, service, model. Nothing travels
back up. A model never imports a controller. Nothing below `routes/` knows HTTP exists except
the controllers.

## app.ts and index.ts

`app.ts` builds the app and exports it without listening. `index.ts` loads the environment,
proves the database is reachable with `SELECT 1`, then listens.

They are split so integration tests can mount the app without binding a port.

```ts
const app = express();

app.set("trust proxy", trustedProxyHops);
app.disable("x-powered-by");
app.use(helmet());
app.use(noStore);
app.use(attachRequestId);
app.use(corsMiddleware);
app.use(httpLogger);
app.use(express.json({ limit: "16kb" }));

app.use("/health", HealthRoute);
app.use("/auth", AuthRoute);
app.use("/wallets", WalletRoute);
app.use("/admin", AdminRoute);
app.use("/transfers", TransferRoute);

app.use(respondNotFound);
app.use(respondInternalError);
```

The order is behavior, not style:

- `trust proxy` comes from `TRUST_PROXY_HOPS`. Express counts hops from the right, so the
  value must match the deployment. Too low and `req.ip` is the proxy, which buckets every
  caller together. `true` takes the leftmost entry, which the caller controls. See
  [known-limitations.md](known-limitations.md).
- `helmet` and `no-store` run before routing, so they cover `401`, `403`, `429` and unmatched
  routes too.
- `attachRequestId` before `express.json()`. A body that is not valid JSON fails inside the
  parser. With the id assigned after it, that would be the one error a caller cannot quote an
  id for. It was the other way round once and malformed JSON returned a `500` with no id.
- `corsMiddleware` before the routers. A preflight `OPTIONS` carries no token and no body, so
  it has to be answered before anything would refuse it. It sits after the request id so a
  preflight response carries one.
- `httpLogger` after the id, so the request line carries the same id the caller received, and
  before the routers, so a request is logged even when it fails in the parser.
- `express.json()` before the routers, so a body exists to validate. The 16 KB cap is well
  above the largest legitimate request.
- `respondNotFound` after the routers, because it only runs when nothing matched.
- `respondInternalError` last, because Express only routes errors to a handler registered
  after everything else.

## routes/

A route file names a path, lists its middleware and points at a controller function. No logic,
no queries, no response building.

```ts
router.post("/", verifyToken, transferLimiter, validateIdempotencyKey,
  validateTransferRequest, TransferController.sendTransfer);
```

Middleware order inside a route is fixed: authenticate, rate limit, authorize, validate,
controller.

The rate limit sits before the authorization query so an unauthorized caller cannot make the
service do database work by repeating a request it will refuse.

## controllers/

Named functions, default-exported as an object so a route reads
`TransferController.sendTransfer`.

A controller reads what it needs off the request, calls the rules, and maps the result to a
status code. It does not build SQL and does not reach into another controller.

## services/

`transferService.ts` is the one place that does not fit the layer pattern cleanly, and that is
deliberate.

A transfer owns a transaction boundary, a lock order, an idempotency claim and two balance
writes. Splitting that across a controller and a model would hide the transaction from the
code that depends on it.

So it is one function. It takes validated details and runs the steps in
[domain.md](domain.md) in order, readable top to bottom.

Two rules hold throughout:

- Every query in the transaction takes the same client, passed in explicitly. A helper that
  reaches for the root client runs outside the transaction and escapes the locks.
- Nothing hides a commit, a retry, a balance change or a lock. Those are the parts a reviewer
  has to find.

## middleware/

| File | Job |
| --- | --- |
| `requestId.ts` | A UUID per request, on `req.requestId` and `X-Request-Id` |
| `auth.ts` | `verifyToken` for identity, `requireRole` for permission |
| `validate.ts` | Zod validation, one exported middleware per request type |
| `cors.ts` | The origin allowlist and the headers a browser client needs |
| `rateLimit.ts` | Six quotas, keyed by caller, account or IP |
| `errorHandler.ts` | `respondNotFound` and `respondInternalError` |

`requestId.ts` adds a property to the Express request, which TypeScript has to be told about:

```ts
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}
```

`respondInternalError` takes four arguments because that is how Express recognizes an error
handler. It checks `res.headersSent`, because a response that has begun cannot be replaced. It
classifies the error: a client fault keeps its `4xx`, a transient database failure becomes
`503`, and only a genuine defect is a `500`.

`requireRole` reads the role and blocked flag from PostgreSQL rather than from the token. See
[ADR 15](decisions.md).

## domain/

Zod schemas and the pure rules. Amount parsing, request normalization, the fingerprint, and
whether a supplied balance and status permit a transfer. Data in, data out, testable without a
database.

A policy function can decide whether a supplied balance is sufficient. It cannot guarantee the
balance is current. Only the locked transaction can, which is why the service is what fetches
under lock.

## models/

The shared Prisma client, the locking reads, the seed and the reconciliation checks. Model
definitions and migrations live in `server/prisma`. Generated code is gitignored.

A model knows about storage and about what makes a record valid. It knows nothing about HTTP.
The same rule can be called from an endpoint, the seed or the reconciliation command.

The locking reads are raw SQL, because row-level lock clauses are not expressible through
Prisma's query builder. Every raw query qualifies its schema explicitly. See
[ADR 10](decisions.md).

## logger.ts

One `pino` instance, because `pino-http` attaches it to the request while the error handler and
the transfer service write to the same one. There is no wrapper; callers use pino's own
methods.

JSON when stdout is a pipe, pretty when it is a terminal. The `Authorization` header is
redacted. `/health` is not logged. Every request line carries `req.ip`, `remoteAddress` and the
raw `forwardedFor`, which is what makes proxy attribution diagnosable.

## What is deliberately absent

No dependency injection container, no generic repository, no service locator, no base
controller, no provider interface, no event bus, no state machine helper.

Each would add a layer whose only job is forwarding. A layer arrives when it has a concrete
job. The transfer service is the one case where that argument was made and accepted.
