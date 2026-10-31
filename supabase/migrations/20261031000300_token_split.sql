-- Token split per run: prompt (in), completion (out) and cache-read tokens,
-- shown under each reply as "29.8K tokens · 24.1K in · 5.7K out".
-- Null on rows from before this migration or runs that don't report it.
-- Idempotent: safe to run more than once.

ALTER TABLE agent_token_usage ADD COLUMN IF NOT EXISTS input_tokens INTEGER;
ALTER TABLE agent_token_usage ADD COLUMN IF NOT EXISTS output_tokens INTEGER;
ALTER TABLE agent_token_usage ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER;

ALTER TABLE ask_questions ADD COLUMN IF NOT EXISTS input_tokens INTEGER;
ALTER TABLE ask_questions ADD COLUMN IF NOT EXISTS output_tokens INTEGER;
ALTER TABLE ask_questions ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER;
