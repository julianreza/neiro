-- Run in the Neiro project SQL Editor after the earlier migrations.
BEGIN;
-- Record future task completions without guessing when historical tasks finished.
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE OR REPLACE FUNCTION neiro_record_task_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.completed_at := CASE WHEN NEW.stage = 'Done' THEN now() ELSE NULL END;
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.completed_at := CASE WHEN NEW.stage = 'Done' THEN now() ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS neiro_task_completion ON mission_tasks;
CREATE TRIGGER neiro_task_completion BEFORE INSERT OR UPDATE OF stage ON mission_tasks
FOR EACH ROW EXECUTE FUNCTION neiro_record_task_completion();
CREATE INDEX IF NOT EXISTS mission_tasks_completed_at_idx ON mission_tasks (completed_at DESC) WHERE stage = 'Done';
NOTIFY pgrst, 'reload schema';
COMMIT;
