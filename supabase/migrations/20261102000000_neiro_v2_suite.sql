-- Neiro v2: task isolation, optional safe-tool approvals, and cost / PR state.
ALTER TABLE missions ADD COLUMN IF NOT EXISTS auto_approve_safe_tools boolean NOT NULL DEFAULT false;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS pr_merged_at timestamptz;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(12, 6) NOT NULL DEFAULT 0;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS task_worktree_path text;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS task_branch text;
ALTER TABLE agent_token_usage ADD COLUMN IF NOT EXISTS cost_usd numeric(12, 6);

-- Claim an approval once across concurrent orchestrators. Failed claims remain
-- available for manual decisions; the server never silently retries them.
CREATE TABLE IF NOT EXISTS auto_approval_claims (
  run_id text NOT NULL,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, request_id)
);
ALTER TABLE auto_approval_claims ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
