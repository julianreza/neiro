-- Reservations are never expired by time: a runtime can continue after a
-- Neiro process exits. Release requires the current owner's exact token.
CREATE TABLE IF NOT EXISTS workspace_reservations (
  resource_key text PRIMARY KEY,
  mission_id text NOT NULL,
  task_id text NOT NULL,
  owner_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspace_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE workspace_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE workspace_reservations TO service_role;

CREATE OR REPLACE FUNCTION claim_workspace_reservation(
  p_resource_key text, p_mission_id text, p_task_id text, p_owner_token text
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE claimed boolean;
BEGIN
  IF coalesce(p_resource_key, '') = '' OR coalesce(p_mission_id, '') = '' OR
     coalesce(p_task_id, '') = '' OR coalesce(p_owner_token, '') = '' THEN
    RAISE EXCEPTION 'Workspace reservation fields are required';
  END IF;
  INSERT INTO workspace_reservations (resource_key, mission_id, task_id, owner_token)
  VALUES (p_resource_key, p_mission_id, p_task_id, p_owner_token)
  ON CONFLICT (resource_key) DO NOTHING;
  SELECT EXISTS (
    SELECT 1 FROM workspace_reservations WHERE resource_key = p_resource_key
      AND mission_id = p_mission_id AND task_id = p_task_id AND owner_token = p_owner_token
  ) INTO claimed;
  RETURN claimed;
END;
$$;

CREATE OR REPLACE FUNCTION release_workspace_reservation(
  p_resource_key text, p_mission_id text, p_task_id text, p_owner_token text
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM workspace_reservations WHERE resource_key = p_resource_key
    AND mission_id = p_mission_id AND task_id = p_task_id AND owner_token = p_owner_token;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed = 1;
END;
$$;

REVOKE ALL ON FUNCTION claim_workspace_reservation(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_workspace_reservation(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_workspace_reservation(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION release_workspace_reservation(text, text, text, text) TO service_role;
