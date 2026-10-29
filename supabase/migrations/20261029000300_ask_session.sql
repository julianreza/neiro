-- One chat = one Hermes session. Each question stores the session it ran in:
-- the run id of the chat's first question.
-- Idempotent: safe to run more than once.

ALTER TABLE ask_questions ADD COLUMN IF NOT EXISTS session_id TEXT;
CREATE INDEX IF NOT EXISTS ask_questions_session_idx ON ask_questions (session_id, created_at);

-- Fill old questions: walk follow_up_of back to the chat's first question.
WITH RECURSIVE chain AS (
  SELECT id, id AS root FROM ask_questions WHERE follow_up_of IS NULL
  UNION ALL
  SELECT q.id, c.root
  FROM ask_questions q
  JOIN chain c ON q.follow_up_of = c.id
)
UPDATE ask_questions a
SET session_id = chain.root
FROM chain
WHERE a.id = chain.id AND a.session_id IS NULL;
