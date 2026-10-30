-- One row per finished task run: which agent spent how many tokens.
-- mission_tasks.tokens is a running total for the whole task, and its
-- agent_name is overwritten at every stage, so it cannot say who spent what.
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS agent_token_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Hermes run id; a run is recorded once even if the tick sees it twice.
  run_id TEXT NOT NULL UNIQUE,
  mission_id TEXT REFERENCES missions(id) ON DELETE CASCADE,
  task_id TEXT,
  agent_id TEXT,
  agent_name TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL,
  tokens INTEGER NOT NULL CHECK (tokens >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_token_usage_created_idx ON agent_token_usage (created_at DESC);

ALTER TABLE agent_token_usage ENABLE ROW LEVEL SECURITY;
