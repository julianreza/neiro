-- A dedicated agent for Ask mode, so questions no longer go to the orchestrator.
-- Idempotent: safe to run more than once.

INSERT INTO agents (id, name, role, stage, specialty, model, profile, prompt, url, enabled, active_run)
VALUES (
  'qa-answerer',
  'Oracle Q&A',
  'Q&A',
  'ask',
  'Answers questions about the project',
  '',
  'default',
  'Answer questions about the project quickly and accurately. Read only the files you need, name the files and lines behind your answer, and say plainly when you are not sure. Never change files.',
  '',
  true,
  false
)
ON CONFLICT (id) DO NOTHING;
