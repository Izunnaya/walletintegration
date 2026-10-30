# The API contract

I keep one API contract for both the server and frontend: the endpoints, response
shapes and status codes below. The [server decisions](server-decisions.md) explain
the rules behind the contract.

## Request ids

`X-Request-Id` is on every response. The server generates it. An inbound `X-Request-Id` is
ignored. The reason is covered under errors and logs in [the server decisions](server-decisions.md#15-i-keep-errors-consistent-and-logs-private).

Every error body repeats it as `error.requestId`. Quote that value in a report. It leads to the
log line for that request.

## A failure is always `error`

One shape, whatever went wrong:

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "The sending wallet does not have enough funds.",
    "requestId": "072ac170-44f7-4a0d-b8c6-68b6d2b24b77"
  }
}
```

`code` is stable and for the caller's logic. `message` is for a person. Neither carries an
exception message, a stack, a file path or a SQL fragment. An unexpected failure returns a
fixed message and nothing else.

## Status codes

| Code | Means |
| --- | --- |
| `200` | Done |
| `201` | Created |
| `400` | Malformed: a missing field, a negative amount, a non-integer `amountMinor` |
| `401` | No credentials, or they are invalid |
| `403` | Authenticated but not allowed |
| `404` | No such route, or no such record the caller may see |
| `409` | Email already registered, or an idempotency key reused with different details |
| `413` | The body is over 16 KB |
| `422` | Well-formed, and a business rule refuses it |
| `429` | Rate limited. Carries `Retry-After` |
| `500` | An unexpected failure. No detail in the body |
| `503` | Transient failure, or an unconfirmed transfer outcome. Carries `Retry-After` |

`400` means the request could never work: `amountMinor` is `"abc"`. `422` means the request is
fine and the answer is no: the amount is valid, the wallet cannot afford it. For a transfer rejected with
`422`, a later payment attempt needs a new key; the old key keeps its saved result.

`404` is returned for another user's record, not `403`. A transfer the caller is not party to is
indistinguishable from one that does not exist. `403` would confirm the id is real.

`503` on a transfer is not a failure. The outcome is unknown. Retry with the same idempotency
key, which resolves it either way.

## Endpoints

| Endpoint | Access |
| --- | --- |
| `GET /health/live` | Public |
| `GET /health/ready` | Public |
| `POST /auth/register` | Public |
| `POST /auth/login` | Public |
| `GET /wallets/me` | User |
| `POST /transfers` | User |
| `GET /transfers` | User |
| `GET /transfers/:id` | User |
| `POST /admin/users/:id/block` | Admin |
| `POST /admin/users/:id/unblock` | Admin |
| `GET /admin/audit` | Admin |

### GET /health/live

Whether the process is up. Touches nothing else, so it stays true while the database is
unreachable.

```
200 { "status": "ok" }
```

### GET /health/ready

Whether the database is reachable. `200` when a query succeeds, `503` when it does not. This is
what the Render health check points at.

Separate from liveness so a database outage is not reported as a dead process.

### POST /auth/register

Creates a user and their zero-balance NGN wallet in one transaction, so a user cannot exist
without a wallet.

```json
{ "email": "ada@example.com", "password": "...", "name": "Ada" }
```

The email is trimmed and lowercased before uniqueness and blacklist matching. The role is
always `customer`. A body containing `role`, `blocked`, `balance` or `is_system` is refused,
because the schemas are strict.

Passwords need at least 12 characters after trimming and at most 72 bytes. bcrypt ignores
anything past 72 bytes.

`201` with the user and wallet. `400` malformed, `409` email taken, `422` blacklisted.

### POST /auth/login

`200` with a JWT. `401` on bad credentials, with the same message whether the email is unknown
or the password is wrong.

### GET /wallets/me

The caller's own wallet. There is no endpoint for anyone else's. The wallet is found from the
token's user id, never from a parameter.

```json
{ "id": "7", "publicId": "wlt_9f2a4c1d8e3b47a6905c2d7f1b6e8a40", "currency": "NGN", "balanceMinor": "150000" }
```

`publicId` is a persisted `wlt_` prefix followed by 32 lowercase hex characters. Use it for
displaying and copying a wallet. `id` remains a decimal string for compatibility.

### POST /transfers

Requires an `Idempotency-Key` header.

```json
{
  "sourceWalletId": "7",
  "destinationWalletId": "12",
  "currency": "NGN",
  "amountMinor": "150000"
}
```

The sender comes from the token. `sourceWalletId` is checked for ownership under lock and never
grants it. A wallet id in a body is a claim, not an authorization.

`sourceWalletId` and `destinationWalletId` accept either a public id or a positive decimal
string within PostgreSQL `BIGINT` range. JSON numbers are rejected. A public id resolves to the
internal key before the fingerprint is calculated, so the same key sent with either
representation replays the same transfer rather than sending a second one.

`amountMinor` is a string of kobo. Currency must be `NGN`. Surrounding whitespace and leading
zeros normalize before the fingerprint is calculated.

`201`:

```json
{
  "transfer": {
    "id": "42",
    "reference": "a61ea75c-9580-43b0-a106-6c550e17c209",
    "sourceWalletId": "7",
    "destinationWalletId": "12",
    "sourceWalletPublicId": "wlt_9f2a4c1d8e3b47a6905c2d7f1b6e8a40",
    "destinationWalletPublicId": "wlt_1b7d3e6a0c9f42b8871e5a2d4c6f8b03",
    "amountMinor": "150000",
    "currency": "NGN",
    "createdAt": "2026-10-28T00:00:00.000Z"
  }
}
```

Failures: `400` malformed, `401` unauthenticated, `403` not the caller's wallet, `404` unknown
wallet, `409` key reused with different details, `422` a business refusal, `429` rate limited,
`503` unconfirmed.

Business refusals: `SAME_WALLET`, `SYSTEM_WALLET_NOT_TRANSFERABLE`, `SENDER_BLOCKED`,
`SENDER_BLACKLISTED`, `RECIPIENT_BLOCKED`, `RECIPIENT_BLACKLISTED`, `CURRENCY_MISMATCH`,
`INSUFFICIENT_FUNDS`, `BALANCE_LIMIT_EXCEEDED`. No transfer and no ledger entries are created.
After fixing a business refusal, use a new key.

A source owned by someone else returns `403 NOT_WALLET_OWNER` before recipient restrictions or
balances are disclosed.

### Idempotency

`Idempotency-Key` is 1 to 128 characters: letters, digits, `.`, `_`, `:` or `-`. Use a fresh
UUID per intended transfer.

Reuse the key on a network error, a `500` or a `503`. Do not generate a new key because a
response was lost.

A replay returns the saved status and body, including the original timestamp and reference. The
`X-Request-Id` header identifies the current HTTP request, not the original. JSONB does not
preserve key order, so byte-identical bodies are not guaranteed.

A response saved before public ids existed is replayed unchanged, so it will not carry the
public id fields. The migration and the backend have to be deployed before a client can rely
on them.

Changed details with the same key return `409 IDEMPOTENCY_KEY_REUSED`.

Known rejections (`403`, `404`, `422`) are saved against the key. Invalid headers, invalid
bodies and `401` are not. Keys are retained indefinitely.

### GET /transfers

Transfers the caller is party to, newest first. Keyset paginated with `limit` and `cursor`.
Never anyone else's.

`limit` is 1 to 100. An unknown query parameter is refused `400`.

### GET /transfers/:id

One transfer, if the caller sent or received it. `404` otherwise, including when the transfer
exists.

### POST /admin/users/:id/block and /unblock

Admin only. Requires a reason.

The restriction change and its audit row commit together, so there is no restriction without a
record of who made it and why. Both lock the affected user row in the same order a transfer
does, so blocking and transferring serialize rather than interleave. See
[the lock-order decision](server-decisions.md#6-i-lock-users-first-then-wallets-in-id-order).

Unblocking does not lift a blacklist. Blocking yourself is refused.

### GET /admin/audit

The admin action trail, newest first. Actor, affected user and reason.

## Out of scope

`POST /admin/blacklist` and `DELETE /admin/blacklist/:id` are optional in the build spec and
not implemented. See [known-limitations.md](known-limitations.md).
