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
