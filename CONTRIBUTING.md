# Working on this project

I use one branch per feature or fix, based on `main`, and keep commits small enough
to review on their own. Commits use the configured project author name and email.

I write commit messages that say what changed in plain language. Use a short prefix such
as `fix:`, `feat:`, `test:` or `docs:`. Add a body only when the reason is not clear.
For money changes, explain what commits together and what happens if the work fails.

Keep behavior changes separate from comment cleanup or file moves. Stage specific
paths so unrelated work does not enter a commit. Open a PR with the change, checks
run and any remaining limits.

## Code

- Routes connect middleware and controllers. Controllers handle HTTP.
- Keep transfer steps together in the service. Do not hide locks or balance changes.
- Use Zod schemas for input and infer types where practical.
- Keep calculations and policy functions pure.
- Use `bigint` for money and strings in JSON.
- Use the same transaction client for every write that must commit together.
- Lock users before wallets, each in ascending ID order.
- Qualify raw SQL with its schema.
- Correct financial history with new entries. Never edit or delete old entries.
- Comment on key rules and surprising choices. Do not narrate the code.
- Keep frontend code near its screen or workflow and use the installed libraries.

## Checks

From `server/`:

```sh
npm run typecheck
npm run build
npm run test:unit
npm run verify:prisma
```

Use a disposable development database for verification. The script creates a test
schema, runs migrations, tests and seed checks, then removes it. Direct `npm test`
runs require `TEST_DATABASE_URL` with a prepared `wallet_test_` schema. They refuse
application schemas. Never use production for test data.

From `frontend/`:

```sh
npm run typecheck
npm run build
npm test
```

Install a Playwright browser first, or use installed Edge with
`$env:PLAYWRIGHT_CHANNEL = 'msedge'` in PowerShell. Run targeted checks while working,
then the relevant full suite before pushing.

Read [the backend structure](docs/architecture.md), [the frontend guide](docs/frontend.md)
and the separate [server](docs/server-decisions.md) and
[frontend decisions](docs/frontend-decisions.md) before changing shared behavior.
