-- Token budgets and the notification feed.
-- Idempotent: safe to run more than once.

-- Max tokens all tasks of a mission may use (NULL = no limit).
ALTER TABLE missions ADD COLUMN IF NOT EXISTS token_budget INTEGER
  CHECK (token_budget IS NULL OR token_budget > 0);
-- Max tokens one agent may use inside one mission (NULL = no limit).
ALTER TABLE agents ADD COLUMN IF NOT EXISTS token_budget INTEGER
  CHECK (token_budget IS NULL OR token_budget > 0);

-- One row per announced event; dedupe_key keeps repeats out.
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  mission_id TEXT REFERENCES missions(id) ON DELETE CASCADE,
  task_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL UNIQUE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications (created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
