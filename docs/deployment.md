# Deployment

The API deploys to Render. The database is Neon. Both are free tiers. See
[ADR 19](decisions.md) for why the database is not Render PostgreSQL.

## Setup

1. **New > Web Service.** Connect the repository and pick the branch.

2. Render reads [`render.yaml`](../render.yaml) and fills in the rest. Confirm it matches:

   | Setting | Value |
   | --- | --- |
   | Root directory | `server` |
   | Build command | `npm ci --include=dev && npm run migrate && npm run build` |
   | Start command | `npm start` |
   | Health check path | `/health/ready` |

3. **Set the environment variables.** The secrets are marked `sync: false` in the blueprint, so
   Render asks for them instead of reading them from the repository.

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon > your project > Connect. Use the pooled connection string |
   | `JWT_SECRET` | Generate a fresh one. Do not reuse the local value |
   | `SEED_ADMIN_PASSWORD` | Your choice. Share with reviewers privately |
   | `CORS_ORIGINS` | Where the browser client is served from, comma-separated |
   | `TRUST_PROXY_HOPS` | The number of proxies in front of the service. Defaults to `0` |

   Generate the secret:

   ```sh
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   `TRUST_PROXY_HOPS` needs the real hop count from the ingress logs. Until it is set, IP-keyed
   rate limits bucket every caller together. See [known-limitations.md](known-limitations.md).

4. **Deploy.** Watch the build log for `prisma migrate deploy` applying `0_init`, then
   `server_listening`.

5. **Seed once, by hand.** The seed never runs on startup. Running it twice changes nothing.

   ```sh
   npm run seed
   ```

6. **Set the admin password.** The seed writes it once and never resets it.

   ```sh
   SEED_ADMIN_PASSWORD='...' npm run admin:password
   ```

   The database is Neon rather than Render-internal, so both commands run from anywhere with
   the connection string. The free plan has no shell.

## Verifying the deploy

```sh
curl -i https://<service>.onrender.com/health/live     # 200 {"status":"ok"}
curl -i https://<service>.onrender.com/health/ready    # 200 {"status":"ready"}
```

`live` answers while the database is unreachable. `ready` does not. A `503` from `ready` means
the process is fine and the database is not.

Then the full path:

```sh
curl -sX POST https://<service>.onrender.com/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"demo-password-2026"}'
```

## Expected behavior that looks wrong

The first request after a pause takes tens of seconds. Free web services sleep when idle.

`index.ts` runs `SELECT 1` before it listens. The process pays for the connection handshake
instead of the first user, and the service refuses to start if the database is unreachable
rather than accepting requests it cannot serve.

## Migrations

`npm run migrate` is `prisma migrate deploy`. It runs in the build command because the free
plan has no separate pre-deploy phase.

It applies pending migrations and nothing else. It never generates, never resets and never
touches data. A failed migration fails the build, so a broken schema change does not reach a
running service.

## The pooled endpoint

Neon's pooled endpoint is PgBouncer. It rejects startup parameters and shares session state
between clients.

The application uses the pooled endpoint and sets no startup parameters. The integration tests
use the direct endpoint, because they set `search_path`. See `server/tests/database.ts`.
