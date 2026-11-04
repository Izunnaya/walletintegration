-- Corrections are new transfers; existing financial records must stay intact.
CREATE OR REPLACE FUNCTION prevent_financial_history_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Financial history cannot be changed or deleted.'
    USING ERRCODE = '23514', CONSTRAINT = 'financial_history_immutable';
END;
$$;

DROP TRIGGER IF EXISTS transfers_immutable ON transfers;
CREATE TRIGGER transfers_immutable
BEFORE UPDATE OR DELETE ON transfers
FOR EACH ROW EXECUTE FUNCTION prevent_financial_history_change();

DROP TRIGGER IF EXISTS ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER ledger_entries_immutable
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_financial_history_change();
