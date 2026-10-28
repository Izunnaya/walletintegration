# Deployment

The API deploys to Render; the database is Neon. Both are free tiers, and the split is
deliberate — see **Why Neon rather than Render PostgreSQL** below.

## What you do once, in the Render dashboard

1. **New → Web Service**, connect `Izunnaya/walletintegration`, pick the branch.
2. Render reads [`render.yaml`](../render.yaml) and fills in the root directory, build command,
   start command and health check path. Confirm they read:

   | Setting | Value |
   | --- | --- |
   | Root directory | `server` |
   | Build command | `npm ci && npm run migrate && npm run build` |
   | Start command | `npm start` |
   | Health check path | `/health/ready` |

3. **Set three environment variables.** They are marked `sync: false` in the blueprint, which
   means Render will not read them from the repository — it asks you, and they are never
   committed.

   | Variable | Where it comes from |
   | --- | --- |
   | `DATABASE_URL` | Neon → your project → Connect. Use the **pooled** connection string here |
   | `JWT_SECRET` | Generate a fresh one. **Do not reuse the local value** |
   | `SEED_ADMIN_PASSWORD` | Your choice. Shared with reviewers privately, never published |
   | `CORS_ORIGINS` | Where the browser client is served from, comma-separated. Omit until there is one |

   Generate the secret with:

   ```sh
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

4. **Deploy.** Watch the build log for `prisma migrate deploy` applying `0_init`, then
   `Server started`.

5. **Seed once, by hand.** Render's shell, or locally with `DATABASE_URL` pointed at the
   deployed database:

   ```sh
   npm run seed
   ```

   It is never run automatically on startup, and running it twice changes nothing.

## Checks that prove it is actually up

```sh
curl -i https://<service>.onrender.com/health/live     # 200 {"status":"ok"}
curl -i https://<service>.onrender.com/health/ready     # 200 {"status":"ready"}
```

`live` answers while the database is unreachable; `ready` does not. If `ready` returns `503` the
process is fine and the database is not, which is the distinction the health check exists to make.

Then the full path, with the seeded credentials:

```sh
curl -sX POST https://<service>.onrender.com/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"demo-password-2026"}'
```

## Things that will look like bugs and are not

**The first request after a pause is slow.** Free web services sleep when idle, and waking takes
tens of seconds. Say so in the submission rather than letting a reviewer discover it.

**`index.ts` runs `SELECT 1` before it listens.** That is deliberate: it means the process pays for
the connection handshake rather than the first user, and the service refuses to start at all if the
database is unreachable, instead of accepting requests it cannot serve.

## Why Neon rather than Render PostgreSQL

A free Render PostgreSQL database becomes inaccessible 30 days after creation, with a 14-day grace
period that does not keep it working. The build spec is explicit that a README warning does not
satisfy "a live URL we can hit", so that clock would have to be tracked and the database upgraded
before submission.

Neon's free tier does not expire that way, and Render connects to it over the network like any other
host. That removes the deadline entirely, which is why **Q21 is settled** rather than open.

One consequence worth knowing: the pooled Neon endpoint is PgBouncer, which rejects startup
parameters and shares session state between clients. The application uses the pooled endpoint and
does not set any; the integration tests use the direct endpoint, because they do. See
`server/tests/database.ts`.

## Migrations on deploy

`npm run migrate` is `prisma migrate deploy`, and it runs in the build command because the free plan
has no separate pre-deploy phase. It applies pending migrations and nothing else — it never
generates, never resets, and never touches data. A migration that fails fails the build, so a broken
schema change does not reach a running service.
