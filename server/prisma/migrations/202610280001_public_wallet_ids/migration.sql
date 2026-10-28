BEGIN;

-- Public identifiers do not change any ledger or transfer foreign keys.
-- The default generates a distinct ID for each existing and future wallet.
-- IF NOT EXISTS allows deployment to adopt this additive change if already applied.
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL
  DEFAULT ('wlt_' || replace(gen_random_uuid()::text, '-', ''));
CREATE UNIQUE INDEX IF NOT EXISTS wallets_public_id_key ON wallets(public_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wallets'::regclass AND conname = 'wallets_public_id_format') THEN
    ALTER TABLE wallets ADD CONSTRAINT wallets_public_id_format
      CHECK (public_id ~ '^wlt_[0-9a-f]{32}$');
  END IF;
END $$;

COMMIT;
