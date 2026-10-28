-- Mission workspaces run in an isolated git worktree on branch neiro/<mission>.
-- Idempotent: safe to run more than once.

ALTER TABLE missions ADD COLUMN IF NOT EXISTS base_branch TEXT;
-- Folder the agents work in (the worktree, or the plain folder when not git).
ALTER TABLE missions ADD COLUMN IF NOT EXISTS agent_workspace_path TEXT;
-- Set only for worktree missions; used to show the branch and to discard it.
ALTER TABLE missions ADD COLUMN IF NOT EXISTS work_branch TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS worktree_path TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS repo_root TEXT;

-- Empty model = use the Hermes profile's own model.
ALTER TABLE agents ALTER COLUMN model SET DEFAULT '';
