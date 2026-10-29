-- Questions asked in Ask mode, so their answers show in History.
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS ask_questions (
  -- The Hermes run id of the question.
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  -- Run id of the question this one follows up on (NULL = a new question).
  follow_up_of TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'stopped')),
  answer TEXT NOT NULL DEFAULT '',
  error TEXT,
  tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ask_questions_created_idx ON ask_questions (created_at DESC, id DESC);

ALTER TABLE ask_questions ENABLE ROW LEVEL SECURITY;
