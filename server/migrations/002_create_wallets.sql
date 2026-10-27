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
