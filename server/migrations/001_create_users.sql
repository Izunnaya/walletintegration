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
