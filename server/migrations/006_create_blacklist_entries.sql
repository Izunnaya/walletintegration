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
