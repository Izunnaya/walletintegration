# Project decisions

I keep server and frontend decisions separate because they explain different parts
of the project.

- [Server decisions](server-decisions.md): accounts, money, Prisma, locking,
  idempotency, restrictions, history, security and database tests.
- [Frontend decisions](frontend-decisions.md): screens, API hooks, forms, sessions,
  exact money handling, transfer recovery, loading and deployment.

Each guide explains the problem I was solving, the choice I made and the tradeoff.
The [backend structure](architecture.md) and [frontend guide](frontend.md) map those
choices to the code. [Deployment](deployment.md) explains how both applications run.
