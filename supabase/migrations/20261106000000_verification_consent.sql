-- Explicit preflight consent is stored with the mission so it cannot be lost on restart.
ALTER TABLE missions ADD COLUMN IF NOT EXISTS skip_qa boolean NOT NULL DEFAULT false;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS skip_review boolean NOT NULL DEFAULT false;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS verification_wait_stage text CHECK (verification_wait_stage IN ('QA check', 'Final review'));
NOTIFY pgrst, 'reload schema';
