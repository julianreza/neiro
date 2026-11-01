-- Run in the Neiro project SQL Editor after the Neiro v2 migration.
BEGIN;
-- Additional Neiro v2 task integration and plan editing.
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS task_integration_pending boolean NOT NULL DEFAULT false;

-- The plan edit and approval share a row lock, so a task graph cannot change
-- after the mission has been approved. Validation exceptions roll back edits.
CREATE OR REPLACE FUNCTION neiro_edit_task_plan(p_mission_id text, p_action text, p_task_id text, p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE mission_status text;
BEGIN
  SELECT status INTO mission_status FROM missions WHERE id = p_mission_id FOR UPDATE;
  IF mission_status IS NULL THEN RAISE EXCEPTION 'Mission not found'; END IF;
  IF mission_status <> 'awaiting_plan_approval' THEN RAISE EXCEPTION 'Mission is not awaiting plan approval'; END IF;
  IF p_action NOT IN ('create', 'update', 'delete') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  IF p_action IN ('create', 'update') THEN
    IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR length(trim(coalesce(p_payload->>'title', ''))) NOT BETWEEN 1 AND 200 OR
       length(coalesce(p_payload->>'result', '')) > 8000 OR length(coalesce(p_payload->>'agent_name', '')) > 200 OR
       jsonb_typeof(p_payload->'depends') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'depends') > 100 OR
       EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'depends') value WHERE jsonb_typeof(value) <> 'string') THEN
      RAISE EXCEPTION 'Invalid task fields';
    END IF;
  END IF;
  IF p_action = 'create' THEN
    IF coalesce(p_payload->>'task_key', '') !~ '^[A-Za-z0-9_-]{1,64}$' OR
       (SELECT count(*) FROM mission_tasks WHERE mission_id = p_mission_id) >= 100 THEN
      RAISE EXCEPTION 'Invalid task key or task limit reached';
    END IF;
    INSERT INTO mission_tasks (id, mission_id, task_key, title, result, agent_name, stage, depends)
      VALUES (p_task_id, p_mission_id, p_payload->>'task_key', trim(p_payload->>'title'), p_payload->>'result', coalesce(p_payload->>'agent_name',''), 'Queued', p_payload->'depends');
  ELSIF p_action = 'update' THEN
    UPDATE mission_tasks SET title = trim(p_payload->>'title'), result = p_payload->>'result',
      agent_name = coalesce(p_payload->>'agent_name', ''), depends = p_payload->'depends', updated_at = now()
      WHERE mission_id = p_mission_id AND id = p_task_id AND stage = 'Queued';
    IF NOT FOUND THEN RAISE EXCEPTION 'Queued task not found'; END IF;
  ELSE
    DELETE FROM mission_tasks WHERE mission_id = p_mission_id AND id = p_task_id AND stage = 'Queued';
    IF NOT FOUND THEN RAISE EXCEPTION 'Queued task not found'; END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM mission_tasks t CROSS JOIN LATERAL jsonb_array_elements_text(t.depends) dep
    WHERE t.mission_id = p_mission_id AND NOT EXISTS (
      SELECT 1 FROM mission_tasks target WHERE target.mission_id = p_mission_id AND target.task_key = dep
    )
  ) THEN RAISE EXCEPTION 'Unknown task dependency'; END IF;
  IF EXISTS (
    WITH RECURSIVE edges AS (
      SELECT t.task_key AS origin, dep AS target FROM mission_tasks t
      CROSS JOIN LATERAL jsonb_array_elements_text(t.depends) dep WHERE t.mission_id = p_mission_id AND t.task_key IS NOT NULL
    ), paths(origin, target) AS (
      SELECT origin, target FROM edges
      UNION SELECT paths.origin, edges.target FROM paths JOIN edges ON edges.origin = paths.target
    ) SELECT 1 FROM paths WHERE origin = target
  ) THEN RAISE EXCEPTION 'Task dependencies contain a cycle'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION neiro_edit_task_plan(text, text, text, jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION neiro_edit_task_plan(text, text, text, jsonb) FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION neiro_edit_task_plan(text, text, text, jsonb) FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION neiro_edit_task_plan(text, text, text, jsonb) TO service_role; END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
