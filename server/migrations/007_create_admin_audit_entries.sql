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
