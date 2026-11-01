-- Manual SQL Editor bundle for the mission workflow upgrade.
-- Requires earlier Neiro migrations creating projects and missions.
-- Running this in SQL Editor does not update Supabase migration history.
BEGIN;

-- 20261101000001_project_defaults.sql
-- Shared defaults affect only newly created missions.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS mission_defaults jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 20261101000002_run_activity.sql
-- Last observed event per run; a late event never rewinds its timestamp.
CREATE TABLE IF NOT EXISTS run_activity (
  run_id text PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  terminal boolean NOT NULL DEFAULT false
);
ALTER TABLE run_activity ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION record_run_activity(p_run_id text, p_observed_at timestamptz, p_terminal boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER AS $$
  INSERT INTO run_activity (run_id, observed_at, terminal)
  VALUES (p_run_id, p_observed_at, p_terminal)
  ON CONFLICT (run_id) DO UPDATE
  SET observed_at = EXCLUDED.observed_at, terminal = run_activity.terminal OR EXCLUDED.terminal
  WHERE EXCLUDED.observed_at > run_activity.observed_at
    AND NOT run_activity.terminal
    AND (EXCLUDED.terminal OR EXCLUDED.observed_at >= run_activity.observed_at + interval '15 seconds');
$$;

-- Historical rows retain NULL: their actual phase transition time is unknown.
ALTER TABLE missions ADD COLUMN IF NOT EXISTS phase_changed_at timestamptz;
CREATE OR REPLACE FUNCTION neiro_mission_phase_changed_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.phase IS DISTINCT FROM OLD.phase THEN
    NEW.phase_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS missions_phase_changed_at ON missions;
CREATE TRIGGER missions_phase_changed_at BEFORE INSERT OR UPDATE ON missions
  FOR EACH ROW EXECUTE FUNCTION neiro_mission_phase_changed_at();

-- 20261101000100_mission_completion.sql
-- Existing mission timestamps do not reliably prove when the mission finished.
ALTER TABLE missions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS missions_completed_at_idx ON missions (completed_at DESC) WHERE status = 'completed';

NOTIFY pgrst, 'reload schema';
COMMIT;
