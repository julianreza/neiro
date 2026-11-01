-- Terminal events take precedence even if they arrive after a newer activity event.
-- Keep the latest observed time and never let later events revive a terminal run.
CREATE OR REPLACE FUNCTION record_run_activity(p_run_id text, p_observed_at timestamptz, p_terminal boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER AS $$
  INSERT INTO run_activity (run_id, observed_at, terminal)
  VALUES (p_run_id, p_observed_at, p_terminal)
  ON CONFLICT (run_id) DO UPDATE
  SET observed_at = GREATEST(run_activity.observed_at, EXCLUDED.observed_at),
      terminal = run_activity.terminal OR EXCLUDED.terminal
  WHERE NOT run_activity.terminal
    AND (EXCLUDED.terminal OR EXCLUDED.observed_at >= run_activity.observed_at + interval '15 seconds');
$$;
NOTIFY pgrst, 'reload schema';
