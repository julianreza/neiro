-- Mission workspaces run in an isolated git worktree on branch neiro/<mission>.
-- Also moves the starter agents to the new Hermes defaults (profile 'default',
-- empty model = use the Hermes profile's own model). These default changes live
-- here, not in the baseline, so the baseline stays a faithful first snapshot.
-- Idempotent: safe to run more than once.

ALTER TABLE missions ADD COLUMN IF NOT EXISTS base_branch TEXT;
-- Folder the agents work in (the worktree, or the plain folder when not git).
ALTER TABLE missions ADD COLUMN IF NOT EXISTS agent_workspace_path TEXT;
-- Set only for worktree missions; used to show the branch and to discard it.
ALTER TABLE missions ADD COLUMN IF NOT EXISTS work_branch TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS worktree_path TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS repo_root TEXT;

-- New agents default to the Hermes profile's own model.
ALTER TABLE agents ALTER COLUMN model SET DEFAULT '';
ALTER TABLE agents ALTER COLUMN profile SET DEFAULT 'default';

-- Move the shipped starter agents to profile 'default' + empty model, but only
-- while they still hold their original baseline values, so a user who already
-- re-pointed an agent at a specific profile/model is never overwritten.
UPDATE agents SET model = '', profile = 'default'
WHERE id = 'pm-orchestrator'  AND model = 'Claude Opus 4.6'   AND profile = 'coordinator';
UPDATE agents SET model = '', profile = 'default'
WHERE id = 'spec-writer'      AND model = 'Claude Sonnet 4.6' AND profile = 'product';
UPDATE agents SET model = '', profile = 'default'
WHERE id = 'backend-worker'   AND model = 'GPT-5.4'           AND profile = 'engineering';
UPDATE agents SET model = '', profile = 'default'
WHERE id = 'frontend-worker'  AND model = 'Claude Sonnet 4.6' AND profile = 'operations';
UPDATE agents SET model = '', profile = 'default'
WHERE id = 'qa-inspector'     AND model = 'GPT-5.4'           AND profile = 'quality';
UPDATE agents SET model = '', profile = 'default'
WHERE id = 'lead-reviewer'    AND model = 'Claude Opus 4.6'   AND profile = 'security';
