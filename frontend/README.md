# Wallet frontend

React and Vite screens for the wallet API. The structure follows the Restaurant
project: screens, workflow forms and resource API hooks.

## Start

```sh
npm ci
# Copy .env.example to .env.local and set VITE_API_BASE_URL.
npm run dev
```

Open http://localhost:3001. The default API is http://localhost:3000. Restart Vite
after changing the URL and allow the frontend origin in backend CORS.

## Check

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm test
```

On Windows, set `$env:PLAYWRIGHT_CHANNEL = 'msedge'` to use installed Edge.
Tests use a separate server and intercepted API responses; they do not send money
to the deployed service.

Read the [frontend guide](../docs/frontend.md) for the folder structure, screens,
API integration, sessions, transfer recovery, loading states and deployment.
The [API contract](../docs/api.md) explains the backend endpoints.
