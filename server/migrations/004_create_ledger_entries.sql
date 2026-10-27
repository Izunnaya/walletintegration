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
