-- One task = one Hermes session. The coding run of a task opens a Hermes
-- session once and stores it here; a retry after a failed QA or review
-- reuses it, so the coding agent remembers its earlier attempt.
-- Idempotent: safe to run more than once.

ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS session_id TEXT;
