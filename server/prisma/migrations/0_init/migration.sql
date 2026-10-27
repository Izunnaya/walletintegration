BEGIN;

-- Identity. One row per person, customer or admin.
--
-- The email CHECK enforces the normalisation rule in the database rather than trusting
-- every call site to remember it. Registration, login, uniqueness and blacklist matching
-- all compare the same trimmed, lowercased value, so none of them can disagree.

CREATE TABLE users (
  id            BIGSERIAL    PRIMARY KEY,
  email         TEXT         NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  name          TEXT         NOT NULL,
  role          TEXT         NOT NULL DEFAULT 'customer',
  is_blocked    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT users_role_valid       CHECK (role IN ('customer', 'admin')),
  CONSTRAINT users_email_normalised CHECK (email = lower(btrim(email))),
  CONSTRAINT users_email_not_empty  CHECK (btrim(email) <> '')
);

-- One wallet per user per currency, holding a balance in whole kobo.
--
-- wallets_balance_non_negative is invariant 1, enforced by Postgres rather than by
-- application code. Even with a bug in the transfer, a customer balance cannot be stored
-- below zero. The system funding wallet is the single documented exception.
--
-- wallets_single_system allows exactly one system wallet to exist, ever. Without it the
-- exception in the balance CHECK would be an overdraft switch that any second system
-- wallet could reach.

CREATE TABLE wallets (
  id            BIGSERIAL    PRIMARY KEY,
  owner_id      BIGINT       NOT NULL REFERENCES users (id),
  currency      TEXT         NOT NULL DEFAULT 'NGN',
  balance_minor BIGINT       NOT NULL DEFAULT 0,
  is_system     BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT wallets_one_per_owner_currency  UNIQUE (owner_id, currency),
  CONSTRAINT wallets_currency_valid          CHECK (currency = 'NGN'),
  CONSTRAINT wallets_balance_non_negative    CHECK (balance_minor >= 0 OR is_system = TRUE)
);

CREATE UNIQUE INDEX wallets_single_system
  ON wallets (is_system)
  WHERE is_system = TRUE;

-- Money that actually moved. Rejections are never stored here; they live on the
-- idempotency record. Every row in this table is a real movement, so no query, total or
-- reconciliation has to remember to filter out attempts.
--
-- There is no status column and no pending state, for the same reason.

CREATE TABLE transfers (
  id                    BIGSERIAL    PRIMARY KEY,
  reference             TEXT         NOT NULL UNIQUE,
  source_wallet_id      BIGINT       NOT NULL REFERENCES wallets (id),
  destination_wallet_id BIGINT       NOT NULL REFERENCES wallets (id),
  amount_minor          BIGINT       NOT NULL,
  currency              TEXT         NOT NULL DEFAULT 'NGN',
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT transfers_amount_positive   CHECK (amount_minor > 0),
  CONSTRAINT transfers_distinct_wallets  CHECK (source_wallet_id <> destination_wallet_id),
  CONSTRAINT transfers_currency_valid    CHECK (currency = 'NGN')
);

-- GET /transfers lists the transfers a caller is a party to, newest first, so both
-- directions are indexed with the sort order built in.
CREATE INDEX transfers_source_created_at
  ON transfers (source_wallet_id, created_at DESC);

CREATE INDEX transfers_destination_created_at
  ON transfers (destination_wallet_id, created_at DESC);

-- The proof behind every balance. Two rows per transfer, equal and opposite.
--
-- ledger_one_per_transfer_type makes a third entry impossible: one debit slot and one
-- credit slot per transfer, enforced by a unique index rather than by convention.
--
-- ledger_sign_matches_type makes "the pair sums to zero" structural. A debit is stored
-- negative and a credit positive, so a wallet balance is the plain SUM of its entries and
-- a mis-signed row cannot be inserted at all.
--
-- Nothing updates or deletes a row here. A correction is a new compensating pair.

CREATE TABLE ledger_entries (
  id           BIGSERIAL    PRIMARY KEY,
  transfer_id  BIGINT       NOT NULL REFERENCES transfers (id),
  wallet_id    BIGINT       NOT NULL REFERENCES wallets (id),
  entry_type   TEXT         NOT NULL,
  amount_minor BIGINT       NOT NULL,
  currency     TEXT         NOT NULL DEFAULT 'NGN',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT ledger_entry_type_valid        CHECK (entry_type IN ('debit', 'credit')),
  CONSTRAINT ledger_one_per_transfer_type   UNIQUE (transfer_id, entry_type),
  CONSTRAINT ledger_currency_valid          CHECK (currency = 'NGN'),
  CONSTRAINT ledger_sign_matches_type       CHECK (
    (entry_type = 'debit'  AND amount_minor < 0) OR
    (entry_type = 'credit' AND amount_minor > 0)
  )
);

-- Reconciliation sums every entry per wallet.
CREATE INDEX ledger_entries_wallet_id
  ON ledger_entries (wallet_id);

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

-- Restricted emails, loaded by the seed script.
--
-- Checked at registration, so a blacklisted email cannot create an account, and again
-- inside every transfer transaction for both parties. The same normalised email rule as
-- users, enforced the same way, so the two tables cannot disagree about what an email is.

CREATE TABLE blacklist_entries (
  id         BIGSERIAL    PRIMARY KEY,
  email      TEXT         NOT NULL UNIQUE,
  reason     TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT blacklist_email_normalised CHECK (email = lower(btrim(email))),
  CONSTRAINT blacklist_email_not_empty  CHECK (btrim(email) <> '')
);

-- Who changed a restriction, when, and why. Insert only.
--
-- A restriction change and its audit row commit in the same transaction, so a block
-- cannot exist without a record of who made it.

CREATE TABLE admin_audit_entries (
  id               BIGSERIAL    PRIMARY KEY,
  actor_user_id    BIGINT       NOT NULL REFERENCES users (id),
  affected_user_id BIGINT       NOT NULL REFERENCES users (id),
  action           TEXT         NOT NULL,
  reason           TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT audit_action_valid CHECK (action IN ('block', 'unblock'))
);

CREATE INDEX admin_audit_affected_user
  ON admin_audit_entries (affected_user_id, created_at DESC);

COMMIT;
