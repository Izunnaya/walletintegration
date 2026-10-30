# Deployment

I host the API on Render and deploy the Vite frontend separately on Vercel.
PostgreSQL runs on Neon. The API configuration is in [`render.yaml`](../render.yaml);
Vercel builds the frontend package from `frontend/`.

The API needs a running process and database credentials. The frontend build produces
static browser files. The [server](server-decisions.md#20-i-separate-startup-health-and-deployment-configuration)
and [frontend](frontend-decisions.md#13-i-deploy-the-frontend-as-static-files) decision
guides explain those responsibilities.

Live frontend: [walletintegration.vercel.app](https://walletintegration.vercel.app/).

Live API: [walletintegration-6t6r.onrender.com](https://walletintegration-6t6r.onrender.com/).

## API settings

Create or connect the API service in Render, using the repository and deployment
branch. When using a Blueprint, sync `render.yaml`; when setting up manually, use
the same values:

| Setting | Value |
| --- | --- |
| Service | `wallet-service`, Node web service |
| Root directory | `server` |
| Build | `npm ci --include=dev && npm run migrate && npm run build` |
| Start | `npm start` |
| Health check | `/health/ready` |

I install development dependencies during the build because TypeScript and the
Prisma CLI are build tools. Starting uses the compiled `dist/index.js`. Seeding is
an explicit operation, separate from startup and deployment.

Set these environment variables on the API:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Hosted PostgreSQL connection; the app can use the pooled endpoint |
| `JWT_SECRET` | Random signing secret, at least 32 characters |
| `SEED_ADMIN_PASSWORD` | Admin credential for initial seeding or deliberate password changes |
| `CORS_ORIGINS` | Actual frontend origins, separated by commas |
| `TRUST_PROXY_HOPS` | Proxy count verified from the deployed ingress logs |
| `LOG_LEVEL` | Normally `info` |

Secrets use `sync: false` in the blueprint, so their values stay in the hosting
environment. `TRUST_PROXY_HOPS` starts at zero until the proxy chain is verified.
This ignores forwarded headers, but behind a proxy it can group callers into the
same IP bucket. It should not be changed by guessing.

A signing secret can be generated locally with:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Frontend settings on Vercel

Import the repository in Vercel and select the branch containing the frontend.
Use these settings:

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variable | `VITE_API_BASE_URL=https://walletintegration-6t6r.onrender.com` |

The API URL must be set before the build because Vite includes it in the shipped
JavaScript. Changing it requires another build. Tokens, passwords and database
credentials must never be put in a `VITE_` variable.

I run the production build locally before deploying. The live frontend is
[walletintegration.vercel.app](https://walletintegration.vercel.app/). A successful
local build does not set Vercel's environment variables; the API URL must also be
configured for the deployment environment and followed by a new build.

React Router owns paths such as `/transfer` after loading. Direct visits and refreshes
also need the host to return `index.html`. Vercel's [Vite guide](https://vercel.com/docs/frameworks/frontend/vite)
covers SPA rewrites. `frontend/vercel.json` supplies the fallback in this project.
It is separate from whether `npm run build` succeeds.

## Connect the two services

Add the deployed frontend origin, `https://walletintegration.vercel.app`, to the API's
`CORS_ORIGINS` and redeploy the API. For example:

```text
CORS_ORIGINS=https://walletintegration.vercel.app
```

Use the actual assigned hostname, without a trailing slash. Scheme and port are
part of an origin. Add local development origins too only if that API should accept
them, using commas between entries.

This step is easy to miss because the UI can load and the API can answer while
the browser refuses to expose the response to the page. CORS controls that browser
access; it does not replace authentication or wallet ownership checks.

## Database migrations and demo data

`npm run migrate` applies pending committed SQL before the build starts the new
application. SQL can change schema or data, so I review migrations and back up
existing data before release. I do not reset the database to deploy a schema change.

The financial-history migration adds triggers rejecting updates and deletes on
transfers and ledger entries. Deployment should use a separate migration role;
the application role must not own tables, disable triggers or truncate history.
It only needs the permissions used by request handling.

For the demonstration database, run `npm run seed` explicitly once configuration
is set. A rerun preserves funding and the existing admin password, but resets public
demo customer passwords. To change the admin credential, set `SEED_ADMIN_PASSWORD`
and run `npm run admin:password` from `server/`.

The [Prisma guide](prisma.md) covers fresh setup, existing-schema adoption and isolated
verification. Demo accounts are for the project demonstration, not real funds.

## Verify a deployment

1. Check the build log for successful migrations and compilation, then the startup
   log for `database_ready` and `server_listening`.
2. Request `/health/live` and `/health/ready`. Liveness returns `{"status":"ok"}`;
   readiness returns `{"status":"ready"}` when the database query works.
3. Load the deployed frontend and sign in using a demo account. Confirm its wallet
   and history load through the real API origin.
4. Open `/transfer` and refresh it directly. Do the same for an accessible receipt.
   These check the static rewrite as well as client navigation.
5. Check the browser network panel for failed CORS requests or a localhost API URL
   accidentally included in the production bundle.

The frontend and API have separate loading behavior. Static page files can arrive
while the API is starting. `index.ts` warms its database connection before listening,
but cannot remove a hosting-platform wake-up delay. The UI shows a slow-request
notice and preserves an unresolved transfer rather than calling it failed.
