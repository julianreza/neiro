-- Which model and runtime (hermes / ohmypi) each recorded run used, so the
-- Dashboard can split tokens per model. Rows from before this stay NULL and
-- fall back to the agent's current model.
-- Idempotent: safe to run more than once.

ALTER TABLE agent_token_usage ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE agent_token_usage ADD COLUMN IF NOT EXISTS runtime TEXT;

NOTIFY pgrst, 'reload schema';
