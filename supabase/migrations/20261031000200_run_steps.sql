-- The steps an agent run took (tool calls, reasoning), kept after the run
-- ends so the chat can show "Worked 2m · 14 steps" after a reload.
-- One row per run id: ask_questions.id, or mission_artifacts.run_id.
-- Written by the events proxy (app/api/hermes/runs/[runId]/events) when a
-- watched stream ends. Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS run_steps (
  run_id TEXT PRIMARY KEY,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  step_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE run_steps ENABLE ROW LEVEL SECURITY;
