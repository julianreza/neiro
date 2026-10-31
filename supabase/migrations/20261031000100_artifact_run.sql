-- Which run made a mission artifact, and when that run started.
-- Lets the task chat show each reply's own model, tokens and run time
-- (run_id joins agent_token_usage.run_id). Older rows stay null.
-- Idempotent: safe to run more than once.

ALTER TABLE mission_artifacts ADD COLUMN IF NOT EXISTS run_id TEXT;
ALTER TABLE mission_artifacts ADD COLUMN IF NOT EXISTS run_started_at TIMESTAMPTZ;
