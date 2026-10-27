-- One row per intended transfer, so a repeat is recognised instead of re-executed.
--
-- idempotency_unique_per_user_operation is what makes concurrent duplicates safe. The
-- second INSERT blocks on this index until the first transaction commits or rolls back,
-- so the database does the coordination rather than application code.
--
-- The row is written inside the transfer transaction, so a half-finished transfer is
-- never visible to another request. A rejection is committed here with no balance change.
--
-- response_body stores what the caller received, so a retry replays the original answer
-- byte for byte rather than recomputing it.

CREATE TABLE idempotency_records (
  id                   BIGSERIAL    PRIMARY KEY,
  user_id              BIGINT       NOT NULL REFERENCES users (id),
  operation            TEXT         NOT NULL,
  idempotency_key      TEXT         NOT NULL,
  request_fingerprint  TEXT         NOT NULL,
  status               TEXT         NOT NULL,
  response_status_code INTEGER      NOT NULL,
  response_body        JSONB        NOT NULL,
  transfer_id          BIGINT       REFERENCES transfers (id),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT idempotency_unique_per_user_operation
    UNIQUE (user_id, operation, idempotency_key),

  CONSTRAINT idempotency_status_valid CHECK (status IN ('succeeded', 'rejected')),

  CONSTRAINT idempotency_key_not_empty CHECK (btrim(idempotency_key) <> ''),

  -- A success must point at the transfer it created; a rejection moved no money, so it
  -- must not point at one.
  CONSTRAINT idempotency_transfer_matches_status CHECK (
    (status = 'succeeded' AND transfer_id IS NOT NULL) OR
    (status = 'rejected'  AND transfer_id IS NULL)
  )
);
