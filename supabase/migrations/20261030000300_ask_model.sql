-- Which model and runtime (hermes / ohmypi) answered each chat or Ask
-- question. The agent's model can change later; this keeps what was used.
-- Rows from before this stay NULL: their runtime is read from the run id,
-- their model is unknown.
-- Idempotent: safe to run more than once.

ALTER TABLE ask_questions ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE ask_questions ADD COLUMN IF NOT EXISTS runtime TEXT;

NOTIFY pgrst, 'reload schema';
